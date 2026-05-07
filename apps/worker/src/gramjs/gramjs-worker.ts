import { parentPort, workerData } from 'node:worker_threads';
import bigInt from 'big-integer';
import { TelegramClient } from 'telegram';
import { computeCheck } from 'telegram/Password';
import { StringSession } from 'telegram/sessions';
import { Api } from 'telegram/tl';

/**
 * GramJS Worker Thread (followup2).
 * Runs the MTProto client in a separate thread to prevent AES-IGE
 * blocking the main event loop (10-50ms per message).
 *
 * Communication with main thread via postMessage/onMessage.
 */

const { apiId, apiHash } = workerData as {
	apiId: number;
	apiHash: string;
	redisUrl: string;
};

// GramJS client — initialized without session, session set per-user on demand
let client: TelegramClient | null = null;

async function initClient(sessionString: string): Promise<void> {
	// Disconnect any existing client before creating a new one (SEC-010).
	// Prevents AUTH_KEY_DUPLICATED if connect is called twice on the same thread.
	if (client) {
		try {
			await client.disconnect();
		} catch {
			// Stale client — ignore disconnect errors
		}
		client = null;
	}

	const session = new StringSession(sessionString);

	client = new TelegramClient(session, apiId, apiHash, {
		connectionRetries: 5,
		retryDelay: 1000,
	});

	await client.connect();
	parentPort?.postMessage({ type: 'connected' });
}

async function handleMessage(msg: {
	type: string;
	id: string;
	[key: string]: unknown;
}): Promise<void> {
	try {
		switch (msg.type) {
			case 'connect': {
				await initClient((msg.sessionString as string) || '');
				parentPort?.postMessage({ type: 'ready', id: msg.id });
				break;
			}

			case 'send-code': {
				if (!client) {
					// Auto-connect with empty session for initial auth flow
					await initClient('');
				}
				// biome-ignore lint/style/noNonNullAssertion: client is guaranteed non-null after initClient above
				const result = await client!.sendCode({ apiId, apiHash }, msg.phone as string);
				parentPort?.postMessage({
					type: 'send-code-result',
					id: msg.id,
					phoneCodeHash: result.phoneCodeHash,
				});
				break;
			}

			case 'verify-code': {
				if (!client) throw new Error('Client not connected — run send-code first');
				try {
					const result = await client.invoke(
						new Api.auth.SignIn({
							phoneNumber: msg.phone as string,
							phoneCodeHash: msg.phoneCodeHash as string,
							phoneCode: msg.code as string,
						}),
					);

					// Extract user info from auth result
					const user = 'user' in result ? (result.user as { id: { toString(): string } }) : null;
					const session = client.session.save() as unknown as string;

					parentPort?.postMessage({
						type: 'verify-code-result',
						id: msg.id,
						telegramUserId: user?.id?.toString() ?? '',
						telegramSession: session,
					});
				} catch (err) {
					const error = err as Error;
					if (error.message.includes('SESSION_PASSWORD_NEEDED')) {
						// 2FA required — try with password if provided
						if (msg.password) {
							// Get the account password info from Telegram
							const accountPassword = await client.invoke(new Api.account.GetPassword());

							// Compute SRP check via GramJS Password module
							const srpCheck = await computeCheck(accountPassword, msg.password as string);

							const passwordResult = await client.invoke(
								new Api.auth.CheckPassword({
									password: srpCheck,
								}),
							);

							const user =
								'user' in passwordResult
									? (passwordResult.user as {
											id: { toString(): string };
										})
									: null;
							const session = client.session.save() as unknown as string;
							parentPort?.postMessage({
								type: 'verify-code-result',
								id: msg.id,
								telegramUserId: user?.id?.toString() ?? '',
								telegramSession: session,
							});
						} else {
							parentPort?.postMessage({
								type: 'error',
								id: msg.id,
								error: 'SESSION_PASSWORD_NEEDED',
							});
						}
					} else {
						throw err;
					}
				}
				break;
			}

			case 'get-contacts': {
				if (!client) throw new Error('Client not connected');
				const result = await client.invoke(new Api.contacts.GetContacts({ hash: bigInt(0) }));

				if ('users' in result) {
					const contacts = (
						result.users as Array<{
							id: { toString(): string };
							firstName?: string;
							lastName?: string;
							phone?: string;
						}>
					).map((u) => ({
						telegramId: u.id.toString(),
						firstName: u.firstName ?? '',
						lastName: u.lastName ?? '',
						phone: u.phone ?? '',
					}));
					parentPort?.postMessage({
						type: 'contacts-result',
						id: msg.id,
						contacts,
					});
				} else {
					parentPort?.postMessage({
						type: 'contacts-result',
						id: msg.id,
						contacts: [],
					});
				}
				break;
			}

			case 'get-dialogs': {
				if (!client) throw new Error('Client not connected');
				const dialogs = await client.invoke(
					new Api.messages.GetDialogs({
						offsetDate: 0,
						offsetId: 0,
						offsetPeer: new Api.InputPeerEmpty(),
						limit: (msg.limit as number) || 100,
						hash: bigInt(0),
					}),
				);

				if ('dialogs' in dialogs && 'chats' in dialogs && 'users' in dialogs) {
					const chatMap = new Map<
						string,
						{ title?: string; username?: string; participantCount?: number }
					>();
					for (const c of dialogs.chats as Array<{
						id: { toString(): string };
						title?: string;
						username?: string;
						participantsCount?: number;
					}>) {
						chatMap.set(c.id.toString(), {
							title: c.title,
							username: c.username,
							participantCount: c.participantsCount,
						});
					}
					const userMap = new Map<
						string,
						{
							firstName?: string;
							lastName?: string;
							username?: string;
							bot?: boolean;
						}
					>();
					for (const u of dialogs.users as Array<{
						id: { toString(): string };
						firstName?: string;
						lastName?: string;
						username?: string;
						bot?: boolean;
					}>) {
						userMap.set(u.id.toString(), {
							firstName: u.firstName,
							lastName: u.lastName,
							username: u.username,
							bot: u.bot,
						});
					}

					const formatted = (
						dialogs.dialogs as Array<{
							peer: {
								channelId?: { toString(): string };
								chatId?: { toString(): string };
								userId?: { toString(): string };
								className: string;
							};
							topMessage?: number;
							unreadCount?: number;
						}>
					).map((d) => {
						const peer = d.peer;
						let chatId = '';
						let type: 'private' | 'group' | 'supergroup' | 'channel' = 'private';
						let title: string | undefined;
						let firstName: string | undefined;
						let lastName: string | undefined;
						let username: string | undefined;
						let participantCount: number | undefined;
						let isBot = false;

						if (peer.className === 'PeerUser' && peer.userId) {
							chatId = peer.userId.toString();
							type = 'private';
							const user = userMap.get(chatId);
							firstName = user?.firstName;
							lastName = user?.lastName;
							title = [firstName, lastName].filter(Boolean).join(' ') || undefined;
							username = user?.username;
							isBot = user?.bot ?? false;
						} else if (peer.className === 'PeerChat' && peer.chatId) {
							chatId = peer.chatId.toString();
							type = 'group';
							const chat = chatMap.get(chatId);
							title = chat?.title;
							participantCount = chat?.participantCount;
						} else if (peer.className === 'PeerChannel' && peer.channelId) {
							chatId = peer.channelId.toString();
							const chat = chatMap.get(chatId);
							title = chat?.title;
							username = chat?.username;
							participantCount = chat?.participantCount;
							type = (chat?.participantCount ?? 0) > 0 ? 'supergroup' : 'channel';
						}

						return {
							chatId,
							type,
							title,
							firstName,
							lastName,
							username,
							participantCount,
							topMessage: d.topMessage ?? 0,
							unreadCount: d.unreadCount ?? 0,
							isBot,
						};
					});

					parentPort?.postMessage({
						type: 'dialogs-result',
						id: msg.id,
						dialogs: formatted,
					});
				} else {
					parentPort?.postMessage({
						type: 'dialogs-result',
						id: msg.id,
						dialogs: [],
					});
				}
				break;
			}

			case 'get-messages': {
				if (!client) throw new Error('Client not connected');

				// ASA-012: validate peerId is a numeric string before passing to GramJS
				const peerId = String(msg.peerId);
				if (!/^\d+$/.test(peerId)) {
					throw new Error(`Invalid peerId format: ${peerId}`);
				}

				const offsetId = (msg.offsetId as number) || 0;
				const minDate = (msg.minDate as number) || 0;
				const maxDate = (msg.maxDate as number) || 0;

				const historyResult = await client.invoke(
					new Api.messages.GetHistory({
						peer: peerId,
						limit: (msg.limit as number) || 50,
						offsetId,
						offsetDate: maxDate,
						addOffset: 0,
						maxId: 0,
						minId: 0,
						hash: bigInt(0),
					}),
				);

				if ('messages' in historyResult && 'users' in historyResult) {
					const meId = (await client.getMe()).id.toString();

					const formatted = (
						historyResult.messages as Array<{
							id: number;
							message?: string;
							date?: number;
							fromId?: {
								userId?: { toString(): string };
								className: string;
							};
							out?: boolean;
						}>
					)
						.filter((m) => {
							if (minDate && m.date && m.date < minDate) return false;
							return true;
						})
						.map((m) => {
							let senderId: string | undefined;
							if (m.fromId?.className === 'PeerUser' && m.fromId.userId) {
								senderId = m.fromId.userId.toString();
							}

							return {
								id: m.id,
								text: m.message ?? '',
								date: m.date ?? 0,
								senderId,
								isOutgoing: m.out ?? senderId === meId,
							};
						});

					parentPort?.postMessage({
						type: 'messages-result',
						id: msg.id,
						messages: formatted,
					});
				} else {
					parentPort?.postMessage({
						type: 'messages-result',
						id: msg.id,
						messages: [],
					});
				}
				break;
			}

			case 'send-message': {
				if (!client) throw new Error('Client not connected');
				const result = await client.sendMessage(msg.contactTelegramId as string, {
					message: msg.text as string,
				});
				parentPort?.postMessage({
					type: 'send-message-result',
					id: msg.id,
					messageId: result.id,
				});
				break;
			}

			case 'disconnect': {
				if (client) {
					await client.disconnect();
					client = null; // SEC-032: null ref so V8 can GC the session object + MTProto state
				}
				parentPort?.postMessage({ type: 'disconnected', id: msg.id });
				break;
			}

			case 'get-participants': {
				if (!client) throw new Error('Client not connected');

				const chatId = msg.chatId as string;
				const chatType = msg.chatType as string;
				const limit = (msg.limit as number) || 200;

				let participants: Array<{
					telegramId: string;
					firstName: string;
					lastName: string;
					username: string;
					isBot: boolean;
				}> = [];

				if (chatType === 'group') {
					// Regular groups: use messages.getFullChat
					const fullChat = await client.invoke(
						new Api.messages.GetFullChat({ chatId: bigInt(chatId) }),
					);
					if ('users' in fullChat) {
						participants = (
							fullChat.users as Array<{
								id: { toString(): string };
								firstName?: string;
								lastName?: string;
								username?: string;
								bot?: boolean;
							}>
						).map((u) => ({
							telegramId: u.id.toString(),
							firstName: u.firstName ?? '',
							lastName: u.lastName ?? '',
							username: u.username ?? '',
							isBot: u.bot ?? false,
						}));
					}
				} else if (chatType === 'supergroup') {
					// Supergroups/channels: use channels.getParticipants
					const result = await client.invoke(
						new Api.channels.GetParticipants({
							channel: chatId,
							filter: new Api.ChannelParticipantsRecent(),
							offset: 0,
							limit,
							hash: bigInt(0),
						}),
					);
					if ('users' in result) {
						participants = (
							result.users as Array<{
								id: { toString(): string };
								firstName?: string;
								lastName?: string;
								username?: string;
								bot?: boolean;
							}>
						).map((u) => ({
							telegramId: u.id.toString(),
							firstName: u.firstName ?? '',
							lastName: u.lastName ?? '',
							username: u.username ?? '',
							isBot: u.bot ?? false,
						}));
					}
				}

				parentPort?.postMessage({
					type: 'participants-result',
					id: msg.id,
					participants,
				});
				break;
			}

			default:
				parentPort?.postMessage({
					type: 'error',
					id: msg.id,
					error: `Unknown message type: ${msg.type}`,
				});
		}
	} catch (err) {
		const error = err as Error;
		// SEC-LOG-003: Sanitize error messages — GramJS errors may contain PII or internal state
		const safeMsg = error.message.replace(/\+?\d{7,15}/g, '[phone]');
		parentPort?.postMessage({
			type: 'error',
			id: msg.id,
			error: safeMsg,
		});
	}
}

// Catch unhandled errors so the thread doesn't silently crash with code 1
process.on('uncaughtException', (err) => {
	const safeMsg = err.message.replace(/\+?\d{7,15}/g, '[phone]');
	console.error('[gramjs-worker] Uncaught exception:', safeMsg);
	parentPort?.postMessage({ type: 'fatal-error', error: safeMsg });
	process.exit(1);
});
process.on('unhandledRejection', (reason) => {
	const raw = reason instanceof Error ? reason.message : String(reason);
	const safeMsg = raw.replace(/\+?\d{7,15}/g, '[phone]');
	console.error('[gramjs-worker] Unhandled rejection:', safeMsg);
	parentPort?.postMessage({ type: 'fatal-error', error: safeMsg });
	process.exit(1);
});

// Catch worker thread exit
process.on('exit', (code) => {
	console.log(`[gramjs-worker] Process exiting with code ${code}`);
});

// Listen for messages from main thread — guard async handler
parentPort?.on('message', (msg) => {
	handleMessage(msg).catch((err) => {
		const safeMsg = ((err as Error).message ?? '').replace(/\+?\d{7,15}/g, '[phone]');
		console.error('[gramjs-worker] Unhandled error in handleMessage:', safeMsg);
		parentPort?.postMessage({
			type: 'error',
			id: msg.id,
			error: safeMsg,
		});
	});
});

// Signal that the worker is loaded (but not connected yet)
parentPort?.postMessage({ type: 'loaded' });
