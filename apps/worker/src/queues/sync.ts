import type { SealedEnvelope } from '@repo/crypto';
import { decrypt, decryptSessionKek, deriveKeys, encrypt, unwrapWrk } from '@repo/crypto';
import { accounts, and, db, eq, workspaces } from '@repo/db';
import {
	contacts,
	createContact,
	getActiveGoalsByType,
	getCalibration,
	getStaleContacts,
	updateContactRecency,
	updateGoalProgress,
} from '@repo/db';
import { updateChatLastSync, upsertChat, upsertMessages } from '@repo/db';
import { Queue, Worker } from 'bullmq';
import { connectUser, sendToUser } from '../gramjs/thread';
import { trackWorkerEvent as trackAnalyticsEvent } from '../lib/track';
import { withRLS } from '../middleware/rls';
import { broadcastSyncComplete, broadcastSyncProgress } from '../realtime/broadcast';
import { connection } from '../redis';
import { bufferMessage } from './message-buffer';

export interface SyncJobData {
	userId: string;
	workspaceId: string;
	contactIds?: string[];
	sourceAccountId?: string; // Telegram account ID being synced
}

function jobIdPart(value: string | undefined): string {
	return (value ?? 'primary').replace(/[^A-Za-z0-9_-]/g, '_');
}

function periodicSyncJobId(data: Pick<SyncJobData, 'workspaceId' | 'userId' | 'sourceAccountId'>) {
	return `periodic-${jobIdPart(data.workspaceId)}-${jobIdPart(data.userId)}-${jobIdPart(
		data.sourceAccountId,
	)}`;
}

/**
 * Look up the Telegram session raw ciphertext from the accounts table.
 * Runs OUTSIDE withKeys() context — accessToken returns raw ciphertext for KEK decrypt.
 */
async function getTelegramAccount(userId: string): Promise<{
	rawCiphertext: string;
	telegramUserId: string;
	sessionKekEncrypted: Buffer;
} | null> {
	const result = await db
		.select({
			accessToken: accounts.accessToken,
			accountId: accounts.accountId,
			sessionKekEncrypted: accounts.sessionKekEncrypted,
		})
		.from(accounts)
		.where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'telegram')))
		.limit(1);

	if (!result[0]?.accessToken) return null;
	if (!result[0].sessionKekEncrypted) {
		throw new Error(
			'Legacy TSK-encrypted session detected — run migrate-session-kek.ts or re-authenticate via /onboarding/telegram-link',
		);
	}
	return {
		rawCiphertext: result[0].accessToken,
		telegramUserId: result[0].accountId,
		sessionKekEncrypted: result[0].sessionKekEncrypted,
	};
}

/**
 * Ensure GramJS client is connected with the user's Telegram session.
 * Returns the user's Telegram ID for filtering self from participant lists.
 *
 * Decrypts session using per-user KMS KEK (sessionKekEncrypted).
 */
async function ensureGramJSConnected(userId: string, _envelope: SealedEnvelope): Promise<string> {
	const account = await getTelegramAccount(userId);
	if (!account) {
		throw new Error(
			'No Telegram session found for user — re-authenticate via /onboarding/telegram-link',
		);
	}

	const kek = await decryptSessionKek(account.sessionKekEncrypted, userId);
	const sessionString = decrypt(account.rawCiphertext, kek);
	kek.fill(0); // Zero plaintext key immediately

	await connectUser(userId, sessionString);

	return account.telegramUserId;
}

/** GramJS dialog shape returned by get-dialogs */
interface GramJSDialog {
	chatId: string;
	type: 'private' | 'group' | 'supergroup' | 'channel';
	title?: string;
	firstName?: string;
	lastName?: string;
	username?: string;
	participantCount?: number;
	topMessage: number;
	unreadCount: number;
	isBot: boolean;
}

/** GramJS message shape returned by get-messages */
interface GramJSMessage {
	id: number;
	text: string;
	date: number;
	senderId?: string;
	isOutgoing: boolean;
}

/** Max dialogs for Tier 1 quick sync */
const QUICK_SYNC_DIALOGS = 20;
/** Max messages per dialog for Tier 1 quick sync */
const QUICK_SYNC_MESSAGES = 50;
/** Max participants before we limit to last 50 messages (large groups) */
const LARGE_GROUP_THRESHOLD = 100;
/** Max group size for participant extraction — larger groups are too noisy */
const GROUP_PARTICIPANT_THRESHOLD = 50;

/**
 * Contact sync queue — syncs Telegram contacts and messages into the database.
 * Uses {ai-flow} hashtag to prevent CROSSSLOT errors (ERR-008).
 *
 * Concurrency: 1 — Telegram rate limits are strict (FLOOD_WAIT).
 * Rate limit: max 1 job per 2 seconds.
 */
export const syncQueue = new Queue<SyncJobData>('sync', {
	connection,
	prefix: '{ai-flow}',
	defaultJobOptions: {
		attempts: 3,
		backoff: { type: 'exponential', delay: 5000 },
		removeOnComplete: { count: 1000 },
		removeOnFail: { count: 5000 },
	},
});

/**
 * Fetch the workspace encryption envelope from the database.
 * Needed to encrypt messages via Drizzle custom types.
 */
async function getWorkspaceEnvelope(workspaceId: string): Promise<SealedEnvelope | null> {
	const result = await db
		.select({
			encryptedWrk: workspaces.encryptedWrk,
			kmsContext: workspaces.kmsContext,
			wrkVersion: workspaces.wrkVersion,
		})
		.from(workspaces)
		.where(eq(workspaces.id, workspaceId))
		.limit(1);

	if (result.length === 0) return null;

	const ws = result[0];
	const rawCtx = ws.kmsContext;
	const kmsContext: Record<string, string> =
		typeof rawCtx === 'string' ? JSON.parse(rawCtx) : (rawCtx as Record<string, string>);
	return {
		encryptedWrk: Buffer.from(ws.encryptedWrk, 'base64'),
		kmsContext,
		wrkVersion: ws.wrkVersion,
	};
}

/**
 * Build a map of telegramId -> contactId for sender resolution.
 * Only queries non-encrypted telegramId field, so no envelope needed.
 */
async function buildTelegramContactMap(workspaceId: string): Promise<Map<string, string>> {
	const rows = await db
		.select({ id: contacts.id, telegramId: contacts.telegramId })
		.from(contacts)
		.where(eq(contacts.workspaceId, workspaceId));

	const map = new Map<string, string>();
	for (const row of rows) {
		if (row.telegramId) {
			map.set(row.telegramId, row.id);
		}
	}
	return map;
}

/** Truncate UUID to first 8 chars for safe logging */
const short = (id: string) => id.slice(0, 8);

export const syncWorker = new Worker<SyncJobData>(
	'sync',
	withRLS(async (job) => {
		const { userId, workspaceId, contactIds } = job.data;
		const syncStartTime = Date.now();

		console.log(`[sync] Processing sync for user=${short(userId)} workspace=${short(workspaceId)}`);

		trackAnalyticsEvent(workspaceId, userId, 'sync.started', {
			is_full_sync: !contactIds,
		});

		// 0. Fetch workspace envelope first — needed to decrypt the Telegram session
		let envelope: Awaited<ReturnType<typeof getWorkspaceEnvelope>>;
		try {
			envelope = await getWorkspaceEnvelope(workspaceId);
		} catch (envErr) {
			const e = envErr as Error & { name?: string; code?: string };
			console.error(`[sync] getWorkspaceEnvelope failed: name=${e.name} code=${e.code}`);
			throw envErr;
		}
		if (!envelope) {
			console.warn('[sync] No workspace envelope found, skipping sync');
			await broadcastSyncComplete(workspaceId, {
				newMessages: 0,
				newContacts: 0,
			});
			return;
		}

		// 1. Ensure GramJS is connected with the user's Telegram session
		let myTelegramId: string;
		try {
			myTelegramId = await ensureGramJSConnected(userId, envelope);
		} catch (connErr) {
			const e = connErr as Error & { name?: string; code?: string };
			console.error(`[sync] ensureGramJSConnected failed: name=${e.name} code=${e.code}`);
			throw connErr;
		}
		const sourceAccountId = job.data.sourceAccountId ?? myTelegramId;
		console.log(`[sync] GramJS connected for user=${short(userId)}`);

		// 2. Fetch contacts from Telegram via GramJS Worker Thread
		const contactsResult = await sendToUser<{
			type: string;
			contacts: Array<{
				telegramId: string;
				firstName: string;
				lastName: string;
				phone: string;
			}>;
		}>(userId, { type: 'get-contacts' });

		let telegramContacts = contactsResult.contacts;

		// Filter to specific contacts if requested
		if (contactIds?.length) {
			telegramContacts = telegramContacts.filter((c) => contactIds.includes(c.telegramId));
			console.log(`[sync] Filtered to ${telegramContacts.length} specific contacts`);
		} else {
			console.log(`[sync] Full sync: ${telegramContacts.length} contacts`);
		}

		// 3. Build existing telegramId -> contactId map for dedup
		const contactMap = await buildTelegramContactMap(workspaceId);

		// 4. Upsert contacts into the database
		let newContactCount = 0;
		for (const tc of telegramContacts) {
			if (contactMap.has(tc.telegramId)) {
				// Already exists — skip (update logic can be added later)
				continue;
			}

			try {
				const created = await createContact(
					workspaceId,
					{
						firstName: tc.firstName || undefined,
						lastName: tc.lastName || undefined,
						phone: tc.phone || undefined,
						telegramId: tc.telegramId,
						sourceAccountId,
					},
					envelope,
				);

				if (created) {
					contactMap.set(tc.telegramId, created.id);
					newContactCount++;
					// Goal hook: increment network goals on new contact
					try {
						const networkGoals = await getActiveGoalsByType(
							workspaceId,
							'network',
							undefined,
							envelope,
						);
						for (const goal of networkGoals) {
							await updateGoalProgress(workspaceId, goal.id, 1, 'network');
						}
					} catch (err) {
						console.warn('[goal-hook] Failed to increment network goal', err);
					}
					console.log(`[sync] Created contact: ${short(created.id)}`);
				}
			} catch (err) {
				console.error('[sync] Failed to create contact:', (err as Error).message);
			}
		}

		console.log(
			`[sync] Contacts: ${newContactCount} new, ${telegramContacts.length - newContactCount} existing`,
		);

		// 5. Get dialogs from Telegram
		const dialogsResult = await sendToUser<{
			type: string;
			dialogs: GramJSDialog[];
		}>(userId, { type: 'get-dialogs', limit: 100 });

		// Sort by most recent activity (topMessage ID as proxy for recency)
		// Filter out bots, prioritize private chats
		const dialogs = dialogsResult.dialogs
			.filter((d) => !d.isBot)
			.sort((a, b) => {
				// Private chats first, then by topMessage descending
				if (a.type === 'private' && b.type !== 'private') return -1;
				if (a.type !== 'private' && b.type === 'private') return 1;
				return b.topMessage - a.topMessage;
			})
			.slice(0, QUICK_SYNC_DIALOGS);

		console.log(
			`[sync] Quick sync: ${dialogs.length} dialogs (from ${dialogsResult.dialogs.length} total)`,
		);

		// 6. Create contacts from private chat peers (people user has DM'd)
		const privatePeers = dialogsResult.dialogs.filter(
			(d) => d.type === 'private' && !d.isBot && d.chatId,
		);
		for (const peer of privatePeers) {
			if (contactMap.has(peer.chatId)) continue;

			try {
				const created = await createContact(
					workspaceId,
					{
						firstName: peer.firstName || undefined,
						lastName: peer.lastName || undefined,
						telegramId: peer.chatId,
						sourceAccountId,
					},
					envelope,
				);

				if (created) {
					contactMap.set(peer.chatId, created.id);
					newContactCount++;
					// Goal hook: increment network goals on new contact
					try {
						const networkGoals = await getActiveGoalsByType(
							workspaceId,
							'network',
							undefined,
							envelope,
						);
						for (const goal of networkGoals) {
							await updateGoalProgress(workspaceId, goal.id, 1, 'network');
						}
					} catch (err) {
						console.warn('[goal-hook] Failed to increment network goal', err);
					}
					console.log(`[sync] Created contact from DM peer: ${short(created.id)}`);
				}
			} catch (err) {
				console.error('[sync] Failed to create contact from DM peer:', (err as Error).message);
			}
		}

		// 7. Extract participants from small groups as contacts
		const smallGroups = dialogsResult.dialogs.filter(
			(d) =>
				(d.type === 'group' || d.type === 'supergroup') &&
				d.participantCount &&
				d.participantCount <= GROUP_PARTICIPANT_THRESHOLD,
		);

		for (const group of smallGroups) {
			try {
				const result = await sendToUser<{
					type: string;
					participants: Array<{
						telegramId: string;
						firstName: string;
						lastName: string;
						username: string;
						isBot: boolean;
					}>;
				}>(userId, {
					type: 'get-participants',
					chatId: group.chatId,
					chatType: group.type,
				});

				let groupNew = 0;
				for (const p of result.participants) {
					if (p.isBot || p.telegramId === myTelegramId || contactMap.has(p.telegramId)) {
						continue;
					}

					try {
						const created = await createContact(
							workspaceId,
							{
								firstName: p.firstName || undefined,
								lastName: p.lastName || undefined,
								telegramId: p.telegramId,
								sourceAccountId,
							},
							envelope,
						);

						if (created) {
							contactMap.set(p.telegramId, created.id);
							newContactCount++;
							groupNew++;
						}
					} catch (err) {
						console.error(
							'[sync] Failed to create contact from group participant:',
							(err as Error).message,
						);
					}
				}

				if (groupNew > 0) {
					console.log(
						`[sync] Group: ${groupNew} new contacts from ${result.participants.length} participants`,
					);
				}
			} catch (err) {
				console.error('[sync] Failed to get participants for group:', (err as Error).message);
			}
		}

		console.log(`[sync] Total contacts: ${newContactCount} new`);

		// Broadcast contact sync progress to onboarding UI
		broadcastSyncProgress(workspaceId, {
			contacts: newContactCount,
			messages: 0,
			stage: 'contacts',
		}).catch(() => {});

		let totalNewMessages = 0;
		/** Collect messages per contact for AI pipeline trigger */
		const contactMessagesMap = new Map<
			string,
			Array<{ role: string; content: string; timestamp: string }>
		>();

		for (const dialog of dialogs) {
			try {
				// a. Upsert the chat record
				const chat = await upsertChat(
					workspaceId,
					{
						telegramChatId: dialog.chatId,
						type: dialog.type,
						title: dialog.title,
						username: dialog.username,
						participantCount: dialog.participantCount,
					},
					envelope,
				);

				if (!chat) {
					console.warn('[sync] Failed to upsert chat');
					continue;
				}

				// b. Determine fetch parameters
				const limit =
					dialog.participantCount && dialog.participantCount > LARGE_GROUP_THRESHOLD
						? QUICK_SYNC_MESSAGES
						: QUICK_SYNC_MESSAGES;

				// If chat has been synced before, only fetch new messages.
				// Subtract 5s buffer to avoid missing messages at the sync boundary
				// (Telegram's GetHistory can lag behind real-time). Dedup via ON CONFLICT
				// DO NOTHING ensures the overlap is safe.
				const minDate = chat.lastSyncAt ? Math.floor(chat.lastSyncAt.getTime() / 1000) - 5 : 0;

				// c. Fetch messages from Telegram
				const messagesResult = await sendToUser<{
					type: string;
					messages: GramJSMessage[];
				}>(userId, {
					type: 'get-messages',
					peerId: dialog.chatId,
					limit,
					minDate,
				});

				if (messagesResult.messages.length === 0) {
					await updateChatLastSync(workspaceId, chat.id);
					continue;
				}

				// d. Map senders to contacts and prepare for insert
				const messagesToInsert = messagesResult.messages.map((m) => ({
					telegramMessageId: String(m.id),
					contactId: m.senderId ? (contactMap.get(m.senderId) ?? undefined) : undefined,
					text: m.text || undefined,
					isOutgoing: m.isOutgoing,
					sentAt: new Date(m.date * 1000),
				}));

				// e. Bulk insert messages via DAL (dedup via ON CONFLICT DO NOTHING)
				const inserted = await upsertMessages(workspaceId, chat.id, messagesToInsert, envelope);

				totalNewMessages += inserted;

				// Deal detection: run GC2 regex sieve on new messages, queue survivors
				if (inserted > 0) {
					try {
						const { detectDealSignals } = await import('../ai/deal-detection');
						const { dealDetectionQueue } = await import('./deal-detection');

						const dealMessages = messagesResult.messages.filter(
							(m) => m.text && detectDealSignals(m.text).passed,
						);

						if (dealMessages.length > 0) {
							const ddWrk = await unwrapWrk(envelope);
							const ddKeys = await deriveKeys(ddWrk, workspaceId, envelope.wrkVersion);
							const keyEnvelope = {
								encryptedWrk: envelope.encryptedWrk.toString('base64'),
								kmsContext: envelope.kmsContext,
								wrkVersion: envelope.wrkVersion,
							};

							for (const m of dealMessages) {
								const msgContactId = m.senderId
									? (contactMap.get(m.senderId) ?? undefined)
									: undefined;
								await dealDetectionQueue.add(
									'detect',
									{
										encryptedText: encrypt(m.text, ddKeys.dek),
										chatId: chat.id,
										sourceMessageId: String(m.id),
										workspaceId,
										contactId: msgContactId,
										keyEnvelope,
									},
									{ attempts: 2, backoff: { type: 'exponential', delay: 5000 } },
								);
							}

							console.log(
								`[sync] Queued ${dealMessages.length} message(s) for deal detection in chat=${short(chat.id)}`,
							);
						}
					} catch (err) {
						console.warn('[deal-detection] Failed to queue deal detection jobs', err);
					}
				}

				// f. Update chat.lastSyncAt
				await updateChatLastSync(workspaceId, chat.id);

				// g. Update inline recency counters (Feature 6)
				if (inserted > 0 && dialog.type === 'private') {
					const peerContactId = contactMap.get(dialog.chatId);
					if (peerContactId) {
						const latestSentAt = messagesToInsert.reduce(
							(max, m) => (m.sentAt > max ? m.sentAt : max),
							messagesToInsert[0]?.sentAt ?? new Date(0),
						);
						updateContactRecency(peerContactId, workspaceId, inserted, latestSentAt).catch((err) =>
							console.warn('[sync] updateContactRecency failed:', (err as Error).message),
						);

						// Track D: broadcast per-contact insight for sync feed narrative
						broadcastSyncProgress(workspaceId, {
							contacts: newContactCount,
							messages: totalNewMessages,
							stage: 'messages',
							contactProcessed: {
								name: dialog.firstName || dialog.title || 'Contact',
								lastMessageAt: latestSentAt.toISOString(),
								messageCount: inserted,
							},
						}).catch(() => {});

						const aiMessages = messagesResult.messages
							.filter((m) => m.text)
							.map((m) => ({
								role: m.isOutgoing ? 'user' : 'assistant',
								content: m.text,
								timestamp: new Date(m.date * 1000).toISOString(),
							}));
						if (aiMessages.length > 0) {
							const existing = contactMessagesMap.get(peerContactId) ?? [];
							existing.push(...aiMessages);
							contactMessagesMap.set(peerContactId, existing);
						}
						// Goal hook: increment relationship goals on outgoing message
						try {
							const relGoals = await getActiveGoalsByType(
								workspaceId,
								'relationship',
								peerContactId,
								envelope,
							);
							for (const goal of relGoals) {
								await updateGoalProgress(workspaceId, goal.id, 1, 'relationship');
							}
						} catch (err) {
							console.warn('[goal-hook] Failed to increment relationship goal', err);
						}

						// Follow-up plan auto-pause: if contact replied (incoming messages), pause active plans
						const hasIncoming = messagesResult.messages.some((m) => !m.isOutgoing);
						if (hasIncoming) {
							import('@repo/db')
								.then(({ autoPauseOnReply }) => autoPauseOnReply(workspaceId, peerContactId))
								.then((paused) => {
									if (paused.length > 0) {
										console.log(
											`[sync] Auto-paused ${paused.length} follow-up plans for contact=${short(peerContactId)}`,
										);
									}
								})
								.catch(() => {});
						}
					}
				}

				// Broadcast message progress to onboarding UI
				broadcastSyncProgress(workspaceId, {
					contacts: newContactCount,
					messages: totalNewMessages,
					stage: 'messages',
				}).catch(() => {});
			} catch (err) {
				const error = err as Error;
				// Handle Telegram flood wait — log and continue with next dialog
				if (error.message.includes('FLOOD_WAIT') || error.message.includes('FloodWait')) {
					console.warn('[sync] Flood wait, skipping chat');
					continue;
				}
				console.error('[sync] Error syncing chat:', error.message);
			}
		}

		// Track D: ghosting alert — surface stale contacts after 10+ contacts with recency data
		if (contactMap.size >= 10) {
			try {
				const staleContacts = await getStaleContacts(workspaceId, envelope, {
					staleDays: 30,
					limit: 3,
				});
				if (staleContacts.length > 0) {
					broadcastSyncProgress(workspaceId, {
						contacts: newContactCount,
						messages: totalNewMessages,
						stage: 'stale_contacts',
						staleContacts: staleContacts.map((c) => ({
							id: c.id,
							firstName: c.firstName,
							lastName: c.lastName,
							lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
							messageCount: c.messageCount,
						})),
					}).catch(() => {});
					trackAnalyticsEvent(workspaceId, userId, 'ghosting_alert.shown', {
						contact_count: staleContacts.length,
					});
				}
			} catch (err) {
				console.warn('[sync] getStaleContacts failed:', (err as Error).message);
			}
		}

		// 5. Fire-and-forget token detection on synced messages
		if (contactMessagesMap.size > 0) {
			(async () => {
				try {
					// Derive workspace salt for entity masking before sending text to LLM (SEC-102)
					const wrk = await unwrapWrk(envelope);
					const keys = await deriveKeys(wrk, workspaceId, envelope.wrkVersion);
					const salt = keys.bik;

					const { detectTokenMentions } = await import('../ai/token-detection');
					const { createTokenMention, incrementMentionCount } = await import('@repo/db');
					for (const [contactId, messages] of contactMessagesMap) {
						const text = messages.map((m) => m.content).join('\n');
						const mentions = await detectTokenMentions(text, salt);
						for (const mention of mentions) {
							await createTokenMention(workspaceId, {
								contactId,
								symbol: mention.symbol,
								name: mention.name,
								context: mention.context,
								confidence: mention.confidence,
							});
							await incrementMentionCount(workspaceId, mention.symbol).catch(() => {});
						}
						if (mentions.length > 0) {
							console.log(
								`[sync] Detected ${mentions.length} token mentions for contact=${short(contactId)}`,
							);
						}
					}
				} catch (err) {
					console.error('[sync] Token detection failed:', (err as Error).message);
				}
			})().catch(() => {});
		}

		// 6. Trigger AI pipeline for contacts with new messages
		if (contactMessagesMap.size > 0) {
			try {
				// Derive workspace masking salt from WRK via BIK (Blind Index Key)
				const wrk = await unwrapWrk(envelope);
				const keys = await deriveKeys(wrk, workspaceId, envelope.wrkVersion);
				const workspaceSalt = keys.bik.toString('hex');

				const keyEnvelope = {
					encryptedWrk: envelope.encryptedWrk.toString('base64'),
					kmsContext: envelope.kmsContext,
					wrkVersion: envelope.wrkVersion,
				};

				// Fetch user calibration for dynamic thresholds + priority ordering
				let commitmentSensitivity: 'everything' | 'specific' | 'tasks_only' | undefined;
				let priorityContactIds: Set<string> | undefined;
				try {
					const calibration = await getCalibration(userId, workspaceId, envelope);
					commitmentSensitivity = calibration?.commitmentSensitivity ?? undefined;
					if (calibration?.priorityContactIds?.length) {
						priorityContactIds = new Set(calibration.priorityContactIds);
					}
				} catch (err) {
					console.warn(
						'[sync] Failed to fetch calibration, using defaults:',
						(err as Error).message,
					);
				}

				// Feature 7: buffer priority contacts first — BullMQ processes in insertion order
				const orderedContacts = [...contactMessagesMap.entries()];
				if (priorityContactIds) {
					const priorityIds = priorityContactIds;
					orderedContacts.sort((a, b) => {
						const aPriority = priorityIds.has(a[0]) ? 0 : 1;
						const bPriority = priorityIds.has(b[0]) ? 0 : 1;
						return aPriority - bPriority;
					});
				}

				for (const [contactId, messages] of orderedContacts) {
					// Encrypt message content before placing in BullMQ payload (SEC-006)
					const encryptedMessages = messages.map((m) => ({
						role: m.role,
						content: encrypt(m.content, keys.dek),
						timestamp: m.timestamp,
					}));
					bufferMessage(
						userId,
						contactId,
						workspaceId,
						encryptedMessages,
						keyEnvelope,
						workspaceSalt,
						commitmentSensitivity,
					);
					console.log(
						`[sync] Buffered ${messages.length} messages for contact=${short(contactId)}`,
					);
				}
			} catch (err) {
				console.error('[sync] Failed to schedule AI pipeline:', (err as Error).message);
			}
		}

		// 6. Broadcast sync completion via Supabase Realtime
		await broadcastSyncComplete(workspaceId, {
			newMessages: totalNewMessages,
			newContacts: newContactCount,
		});

		// 7. Enqueue Tier 2 full backfill (imported dynamically to avoid circular deps)
		try {
			const { backfillQueue } = await import('./backfill');
			await backfillQueue.add('full-backfill', {
				userId,
				workspaceId,
			});
			console.log(`[sync] Enqueued Tier 2 full backfill for workspace=${short(workspaceId)}`);
		} catch (err) {
			console.error('[sync] Failed to enqueue backfill:', (err as Error).message);
		}

		// 8. Self-reschedule Tier 1 sync in 15 minutes
		// Uses BullMQ delay instead of repeat (DragonflyDB cmsgpack compat)
		await syncQueue.add(
			'periodic-sync',
			{ userId, workspaceId },
			{ delay: 15 * 60 * 1000, jobId: periodicSyncJobId(job.data) },
		);
		console.log(`[sync] Scheduled next sync in 15 minutes for workspace=${short(workspaceId)}`);

		trackAnalyticsEvent(workspaceId, userId, 'sync.completed', {
			duration_ms: Date.now() - syncStartTime,
			contacts_synced: newContactCount,
			messages_synced: totalNewMessages,
			dialogs_processed: dialogs.length,
		});

		console.log(
			`[sync] Tier 1 complete for user=${short(userId)}: ${newContactCount} new contacts, ${totalNewMessages} new messages`,
		);
	}),
	{
		connection,
		prefix: '{ai-flow}',
		concurrency: 1, // CRITICAL: 1 job at a time — Telegram rate limits
		limiter: {
			max: 1,
			duration: 2000, // Max 1 job every 2 seconds
		},
	},
);

syncWorker.on('completed', (job) => {
	console.log(`[sync] Job ${job.id} completed`);
});

syncWorker.on('failed', (job, err) => {
	console.error(`[sync] Job ${job?.id} failed:`, err.message || String(err), err.stack);

	if (job?.data) {
		trackAnalyticsEvent(job.data.workspaceId, job.data.userId, 'sync.failed', {
			error_type: err.message?.split(':')[0] || 'unknown',
			attempt: job.attemptsMade,
		});
	}

	// Resilience: if a sync job fails before self-rescheduling, re-enqueue
	// so the periodic chain doesn't break.
	if (job?.data) {
		syncQueue
			.add('periodic-sync', job.data, { delay: 15 * 60 * 1000, jobId: periodicSyncJobId(job.data) })
			.catch(() => {});
	}
});

/**
 * Bootstrap periodic sync for all workspaces on worker startup.
 * Queries workspace_members to find userId + workspaceId pairs,
 * then enqueues a sync job for each (with dedup via jobId).
 *
 * Uses short 5s delay so GramJS thread pool is ready before first sync.
 */
export async function schedulePeriodicSync(): Promise<void> {
	try {
		const dbMod = await import('@repo/db');
		const members = await dbMod.db
			.select({
				userId: dbMod.workspaceMembers.userId,
				workspaceId: dbMod.workspaceMembers.workspaceId,
			})
			.from(dbMod.workspaceMembers);

		for (const member of members) {
			await syncQueue.add(
				'periodic-sync',
				{ userId: member.userId, workspaceId: member.workspaceId },
				{
					delay: 5000,
					jobId: periodicSyncJobId({
						userId: member.userId,
						workspaceId: member.workspaceId,
					}),
				},
			);
		}

		console.log(`[sync] Bootstrapped periodic sync for ${members.length} workspace members`);
	} catch (err) {
		console.error('[sync] Failed to bootstrap periodic sync:', (err as Error).message);
	}
}
