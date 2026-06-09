import type { SealedEnvelope } from '@repo/crypto';
import { decrypt, decryptSessionKek, deriveKeys, encrypt, unwrapWrk } from '@repo/crypto';
import { accounts, and, db, eq, workspaces } from '@repo/db';
import {
	contacts,
	createContact,
	getActiveGoalsByType,
	getCalibration,
	getStaleContacts,
	updateContact,
	updateContactRecency,
	updateGoalProgress,
} from '@repo/db';
import {
	linkMessagesToContact,
	linkMessagesToContactsByTelegramIds,
	listMessageIdsByTelegramIds,
	updateChatLastSync,
	updateMessageSenderMetadataByTelegramIds,
	upsertChat,
	upsertMessages,
} from '@repo/db';
import { type TelegramSyncScope, redactSensitive, resolveTelegramSyncScope } from '@repo/shared';
import { Queue, Worker } from 'bullmq';
import { connectUser, sendToUser } from '../gramjs/thread';
import { trackWorkerEvent as trackAnalyticsEvent } from '../lib/track';
import { withRLS } from '../middleware/rls';
import { broadcastSyncComplete, broadcastSyncProgress } from '../realtime/broadcast';
import { connection } from '../redis';
import { isTelegramFullBackfillEnabled, isTelegramPeriodicSyncEnabled } from '../telegram-config';
import type { PipelineMessage } from './ai-flow';
import { bufferMessage } from './message-buffer';

export interface SyncJobData {
	userId: string;
	workspaceId: string;
	contactIds?: string[];
	sourceAccountId?: string; // Telegram account ID being synced
	syncScope?: TelegramSyncScope;
	enableAiProcessing?: boolean;
}

function jobIdPart(value: string | undefined): string {
	return (value ?? 'primary').replace(/[^A-Za-z0-9_-]/g, '_');
}

function periodicSyncJobId(data: Pick<SyncJobData, 'workspaceId' | 'userId' | 'sourceAccountId'>) {
	return `periodic-${jobIdPart(data.workspaceId)}-${jobIdPart(data.userId)}-${jobIdPart(
		data.sourceAccountId,
	)}`;
}

function assertStoredSessionUnwrapAllowedForSync(): void {
	if (process.env.NODE_ENV === 'test') return;
	if (process.env.TELEGRAM_ALLOW_SESSION_UNWRAP_OUTSIDE_IMPORTS?.trim() === 'true') return;
	throw new Error(
		'Stored Telegram session unwrap is restricted to history imports. Use the Telegram history import flow, or explicitly set TELEGRAM_ALLOW_SESSION_UNWRAP_OUTSIDE_IMPORTS=true for legacy sync.',
	);
}

/**
 * Look up the Telegram session raw ciphertext from the accounts table.
 * Runs OUTSIDE withKeys() context — accessToken returns raw ciphertext for KEK decrypt.
 */
async function getTelegramAccount(
	userId: string,
	sourceAccountId?: string,
): Promise<{
	rawCiphertext: string;
	telegramUserId: string;
	sessionKekEncrypted: Buffer;
} | null> {
	const conditions = [eq(accounts.userId, userId), eq(accounts.providerId, 'telegram')];
	if (sourceAccountId) conditions.push(eq(accounts.accountId, sourceAccountId));
	const result = await db
		.select({
			accessToken: accounts.accessToken,
			accountId: accounts.accountId,
			sessionKekEncrypted: accounts.sessionKekEncrypted,
		})
		.from(accounts)
		.where(and(...conditions))
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
async function ensureGramJSConnected(
	userId: string,
	_envelope: SealedEnvelope,
	sourceAccountId?: string,
): Promise<string> {
	assertStoredSessionUnwrapAllowedForSync();
	const account = await getTelegramAccount(userId, sourceAccountId);
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
	senderPeerId?: string;
	senderPeerType?: 'user' | 'chat' | 'channel';
	isOutgoing: boolean;
}

interface GramJSSenderUser {
	telegramId: string;
	firstName: string;
	lastName: string;
	username: string;
	isBot: boolean;
}

type CreateContactWithUsernameInput = Parameters<typeof createContact>[1] & {
	username?: string;
};

type UpdateContactWithUsernameInput = Parameters<typeof updateContact>[2] & {
	username?: string;
};

type SourcedPipelineMessage = PipelineMessage & {
	sourceMessageId: string;
	chatId: string;
};

interface GroupMessageBatch {
	chatId: string;
	chatType: 'group' | 'supergroup';
	messages: SourcedPipelineMessage[];
}

function isSourcedPipelineMessage(
	message: SourcedPipelineMessage | null,
): message is SourcedPipelineMessage {
	return message !== null;
}

function normalizeTelegramUsername(username: string | undefined): string | undefined {
	const trimmed = username?.trim();
	return trimmed || undefined;
}

function contactDalSupportsUsername(): boolean {
	return 'username' in contacts;
}

function withTelegramUsername<T extends object>(
	input: T,
	username: string | undefined,
): T & { username?: string } {
	const normalized = normalizeTelegramUsername(username);
	return normalized ? { ...input, username: normalized } : input;
}

async function updateExistingContactUsername(
	workspaceId: string,
	contactId: string,
	username: string | undefined,
	envelope: SealedEnvelope,
) {
	const normalized = normalizeTelegramUsername(username);
	if (!normalized || !contactDalSupportsUsername()) return;

	try {
		const input: UpdateContactWithUsernameInput = { username: normalized };
		await updateContact(workspaceId, contactId, input, envelope);
	} catch (err) {
		console.warn('[sync] Failed to update contact username:', (err as Error).message);
	}
}

async function createMissingSenderContacts(
	workspaceId: string,
	sourceAccountId: string,
	senderUsers: GramJSSenderUser[],
	senderIds: Set<string>,
	contactMap: Map<string, string>,
	envelope: SealedEnvelope,
): Promise<number> {
	let createdCount = 0;
	const uniqueUsers = new Map<string, GramJSSenderUser>();
	for (const user of senderUsers) {
		if (!user.telegramId || user.isBot || user.telegramId === sourceAccountId) continue;
		if (!senderIds.has(user.telegramId) || contactMap.has(user.telegramId)) continue;
		uniqueUsers.set(user.telegramId, user);
	}

	for (const user of uniqueUsers.values()) {
		try {
			const input: CreateContactWithUsernameInput = withTelegramUsername(
				{
					firstName: user.firstName || undefined,
					lastName: user.lastName || undefined,
					telegramId: user.telegramId,
					sourceAccountId,
				},
				user.username,
			);
			const created = await createContact(workspaceId, input, envelope);
			if (created) {
				contactMap.set(user.telegramId, created.id);
				createdCount++;
			}
		} catch (err) {
			console.warn('[sync] Failed to create contact from message sender:', redactSensitive(err));
		}
	}

	return createdCount;
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
		removeOnComplete: true,
		removeOnFail: { count: 50, age: 3600 },
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
		const syncScope = resolveTelegramSyncScope(job.data.syncScope);
		const enableAiProcessing = job.data.enableAiProcessing === true;
		const syncStartTime = Date.now();

		console.log(
			`[sync] Processing sync for user=${short(userId)} workspace=${short(workspaceId)} scope=${syncScope}`,
		);

		trackAnalyticsEvent(workspaceId, userId, 'sync.started', {
			is_full_sync: !contactIds,
			sync_scope: syncScope,
			ai_processing_enabled: enableAiProcessing,
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

		let aiConsentContextPromise: Promise<{
			granted: boolean;
			commitmentSensitivity?: 'everything' | 'specific' | 'tasks_only';
			priorityContactIds?: Set<string>;
		}> | null = null;
		const getAiConsentContext = () => {
			aiConsentContextPromise ??= (async () => {
				if (!enableAiProcessing) return { granted: false };
				try {
					const calibration = await getCalibration(userId, workspaceId, envelope);
					return {
						granted: calibration?.consentAiAnalysis === true,
						commitmentSensitivity: calibration?.commitmentSensitivity ?? undefined,
						priorityContactIds: calibration?.priorityContactIds?.length
							? new Set(calibration.priorityContactIds)
							: undefined,
					};
				} catch (err) {
					console.warn(
						'[sync] Failed to fetch calibration, skipping AI analysis:',
						redactSensitive(err),
					);
					return { granted: false };
				}
			})();
			return aiConsentContextPromise;
		};

		// 1. Ensure GramJS is connected with the user's Telegram session
		let myTelegramId: string;
		try {
			myTelegramId = await ensureGramJSConnected(userId, envelope, job.data.sourceAccountId);
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
				username?: string;
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
			const existingContactId = contactMap.get(tc.telegramId);
			if (existingContactId) {
				await updateExistingContactUsername(workspaceId, existingContactId, tc.username, envelope);
				continue;
			}

			try {
				const input: CreateContactWithUsernameInput = withTelegramUsername(
					{
						firstName: tc.firstName || undefined,
						lastName: tc.lastName || undefined,
						phone: tc.phone || undefined,
						telegramId: tc.telegramId,
						sourceAccountId,
					},
					tc.username,
				);
				const created = await createContact(workspaceId, input, envelope);

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

		if (syncScope === 'contacts_only') {
			broadcastSyncProgress(workspaceId, {
				contacts: newContactCount,
				messages: 0,
				stage: 'contacts',
			}).catch(() => {});

			await broadcastSyncComplete(workspaceId, {
				newMessages: 0,
				newContacts: newContactCount,
			});

			trackAnalyticsEvent(workspaceId, userId, 'sync.completed', {
				duration_ms: Date.now() - syncStartTime,
				contacts_synced: newContactCount,
				messages_synced: 0,
				dialogs_processed: 0,
				sync_scope: syncScope,
				ai_processing_enabled: false,
			});

			console.log(
				`[sync] Contacts-only sync complete for user=${short(userId)}: ${newContactCount} new contacts`,
			);
			return;
		}

		// 5. Get dialogs from Telegram
		const dialogsResult = await sendToUser<{
			type: string;
			dialogs: GramJSDialog[];
		}>(userId, { type: 'get-dialogs', limit: 100 });
		const includeGroupDialogs = syncScope === 'private_recent_with_groups';

		// Sort private chats by most recent activity. Group/channel import stays
		// off unless the user explicitly selected the group import scope.
		const dialogs = dialogsResult.dialogs
			.filter(
				(d) =>
					!d.isBot &&
					(d.type === 'private' ||
						(includeGroupDialogs && (d.type === 'group' || d.type === 'supergroup'))),
			)
			.sort((a, b) => {
				if (includeGroupDialogs) return b.topMessage - a.topMessage;
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
			const existingContactId = contactMap.get(peer.chatId);
			if (existingContactId) {
				await updateExistingContactUsername(
					workspaceId,
					existingContactId,
					peer.username,
					envelope,
				);
				continue;
			}

			try {
				const input: CreateContactWithUsernameInput = withTelegramUsername(
					{
						firstName: peer.firstName || undefined,
						lastName: peer.lastName || undefined,
						telegramId: peer.chatId,
						sourceAccountId,
					},
					peer.username,
				);
				const created = await createContact(workspaceId, input, envelope);

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

		// 7. Extract participants from small groups only when the user explicitly
		// selects group sync. Personal-account mode defaults to private chats.
		const smallGroups = includeGroupDialogs
			? dialogs.filter(
					(d) =>
						(d.type === 'group' || d.type === 'supergroup') &&
						d.participantCount &&
						d.participantCount <= GROUP_PARTICIPANT_THRESHOLD,
				)
			: [];

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
					if (p.isBot || p.telegramId === myTelegramId) {
						continue;
					}
					const existingContactId = contactMap.get(p.telegramId);
					if (existingContactId) {
						await updateExistingContactUsername(
							workspaceId,
							existingContactId,
							p.username,
							envelope,
						);
						continue;
					}

					try {
						const input: CreateContactWithUsernameInput = withTelegramUsername(
							{
								firstName: p.firstName || undefined,
								lastName: p.lastName || undefined,
								telegramId: p.telegramId,
								sourceAccountId,
							},
							p.username,
						);
						const created = await createContact(workspaceId, input, envelope);

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
		const contactMessagesMap = new Map<string, PipelineMessage[]>();
		const groupMessageBatches: GroupMessageBatch[] = [];

		for (const dialog of dialogs) {
			try {
				// a. Upsert the chat record
				const chat = await upsertChat(
					workspaceId,
					{
						telegramChatId: dialog.chatId,
						sourceAccountId,
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
					users?: GramJSSenderUser[];
				}>(userId, {
					type: 'get-messages',
					peerId: dialog.chatId,
					peerType: dialog.type,
					limit,
					minDate,
				});

				if (messagesResult.messages.length === 0) {
					await updateChatLastSync(workspaceId, chat.id);
					continue;
				}

				const senderIds = new Set(
					messagesResult.messages
						.map((message) => message.senderId)
						.filter((id): id is string => Boolean(id)),
				);
				if (senderIds.size > 0) {
					await createMissingSenderContacts(
						workspaceId,
						sourceAccountId,
						messagesResult.users ?? [],
						senderIds,
						contactMap,
						envelope,
					);
				}

				const peerContactId = dialog.type === 'private' ? contactMap.get(dialog.chatId) : undefined;

				// d. Map senders to contacts and prepare for insert. Telegram private-chat
				// history can omit fromId on outgoing/service-shaped messages; in that
				// case the dialog peer is still the contact this message belongs to.
				const messagesToInsert = messagesResult.messages.map((m) => ({
					telegramMessageId: String(m.id),
					contactId: (m.senderId ? contactMap.get(m.senderId) : undefined) ?? peerContactId,
					telegramSenderId: m.senderPeerId ?? m.senderId,
					telegramSenderType: m.senderPeerType ?? (m.senderId ? ('user' as const) : undefined),
					text: m.text || undefined,
					isOutgoing: m.isOutgoing,
					sentAt: new Date(m.date * 1000),
				}));
				const messageContactLinks = messagesToInsert.flatMap((message) =>
					message.contactId
						? [{ telegramMessageId: message.telegramMessageId, contactId: message.contactId }]
						: [],
				);
				const messageSenderMetadataLinks = messagesToInsert.flatMap((message) =>
					message.telegramSenderId && message.telegramSenderType
						? [
								{
									telegramMessageId: message.telegramMessageId,
									telegramSenderId: message.telegramSenderId,
									telegramSenderType: message.telegramSenderType,
								},
							]
						: [],
				);

				// e. Bulk insert messages via DAL (dedup via ON CONFLICT DO NOTHING)
				const inserted = await upsertMessages(workspaceId, chat.id, messagesToInsert, envelope);
				if (messageContactLinks.length > 0) {
					await linkMessagesToContactsByTelegramIds(workspaceId, chat.id, messageContactLinks);
				}
				if (messageSenderMetadataLinks.length > 0) {
					await updateMessageSenderMetadataByTelegramIds(
						workspaceId,
						chat.id,
						messageSenderMetadataLinks,
					);
				}
				if (peerContactId) {
					const linked = await linkMessagesToContact(workspaceId, chat.id, peerContactId);
					if (linked > 0) {
						console.log(
							`[sync] Linked ${linked} existing private message(s) to contact=${short(peerContactId)}`,
						);
					}
				}
				const messageIdentityRows = await listMessageIdsByTelegramIds(
					workspaceId,
					chat.id,
					messagesToInsert.map((m) => m.telegramMessageId),
				);
				const messageIdByTelegramId = new Map(
					messageIdentityRows.map((m) => [m.telegramMessageId, m.id]),
				);

				totalNewMessages += inserted;

				// Deal detection can enqueue downstream AI work, so it is opt-in for
				// personal Telegram accounts.
				const previousLastSyncAt = chat.lastSyncAt;
				const messagesForAiPipeline = previousLastSyncAt
					? messagesToInsert.filter((m) => m.sentAt > previousLastSyncAt)
					: messagesToInsert;
				const aiTelegramMessageIds = new Set(messagesForAiPipeline.map((m) => m.telegramMessageId));
				const sourceMessageIdByTelegramId = new Map(
					messageIdentityRows
						.filter((m) => aiTelegramMessageIds.has(m.telegramMessageId))
						.map((m) => [m.telegramMessageId, m.id]),
				);

				if (inserted > 0 && enableAiProcessing && (await getAiConsentContext()).granted) {
					try {
						const { detectDealSignals } = await import('../ai/deal-detection');
						const { dealDetectionQueue } = await import('./deal-detection');

						const dealMessages = messagesResult.messages.filter(
							(m) =>
								m.text &&
								aiTelegramMessageIds.has(String(m.id)) &&
								detectDealSignals(m.text).passed,
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
										userId,
										workspaceId,
										contactId: msgContactId,
										keyEnvelope,
									},
									{
										attempts: 2,
										backoff: { type: 'exponential', delay: 5000 },
										removeOnComplete: true,
										removeOnFail: { count: 25, age: 3600 },
									},
								);
							}

							console.log(
								`[sync] Queued ${dealMessages.length} message(s) for deal detection in chat=${short(chat.id)}`,
							);
						}
					} catch (err) {
						console.warn(
							'[deal-detection] Failed to queue deal detection jobs',
							redactSensitive(err),
						);
					}
				}

				// f. Update chat.lastSyncAt
				await updateChatLastSync(workspaceId, chat.id);

				// g. Update inline recency counters (Feature 6)
				if (inserted > 0 && dialog.type === 'private') {
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
							.filter((m) => m.text && aiTelegramMessageIds.has(String(m.id)))
							.map((m) => {
								const sourceMessageId = sourceMessageIdByTelegramId.get(String(m.id));
								const aiMessage: PipelineMessage = {
									id: messageIdByTelegramId.get(String(m.id)),
									role: m.isOutgoing ? 'user' : 'assistant',
									content: m.text,
									timestamp: new Date(m.date * 1000).toISOString(),
									sourceMessageId,
									chatId: chat.id,
									contactId: (m.senderId ? contactMap.get(m.senderId) : undefined) ?? peerContactId,
								};
								return aiMessage;
							});
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

				if (inserted > 0 && (dialog.type === 'group' || dialog.type === 'supergroup')) {
					const aiMessages = messagesResult.messages
						.filter((m) => m.text)
						.map((m) => {
							const sourceMessageId = sourceMessageIdByTelegramId.get(String(m.id));
							if (!sourceMessageId) return null;
							const aiMessage: SourcedPipelineMessage = {
								role: m.isOutgoing ? 'user' : 'assistant',
								content: m.text,
								timestamp: new Date(m.date * 1000).toISOString(),
								sourceMessageId,
								chatId: chat.id,
								contactId: m.senderId ? contactMap.get(m.senderId) : undefined,
							};
							return aiMessage;
						})
						.filter(isSourcedPipelineMessage);

					if (aiMessages.length > 0) {
						groupMessageBatches.push({
							chatId: chat.id,
							chatType: dialog.type,
							messages: aiMessages,
						});
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
				console.error('[sync] Error syncing chat:', redactSensitive(error.message));
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
		if (
			contactMessagesMap.size > 0 &&
			enableAiProcessing &&
			(await getAiConsentContext()).granted
		) {
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
					console.error('[sync] Token detection failed:', redactSensitive(err));
				}
			})().catch(() => {});
		}

		// 6. Trigger AI pipeline for contacts and intro extraction for group batches
		if ((contactMessagesMap.size > 0 || groupMessageBatches.length > 0) && enableAiProcessing) {
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

				const aiConsentContext = await getAiConsentContext();

				if (!aiConsentContext.granted) {
					console.log(
						`[sync] AI processing requested but consent is not persisted for workspace=${short(workspaceId)}, skipping AI pipeline`,
					);
				} else {
					// Feature 7: buffer priority contacts first — BullMQ processes in insertion order
					const orderedContacts = [...contactMessagesMap.entries()];
					if (aiConsentContext.priorityContactIds) {
						const priorityIds = aiConsentContext.priorityContactIds;
						orderedContacts.sort((a, b) => {
							const aPriority = priorityIds.has(a[0]) ? 0 : 1;
							const bPriority = priorityIds.has(b[0]) ? 0 : 1;
							return aPriority - bPriority;
						});
					}

					for (const [contactId, messages] of orderedContacts) {
						// Encrypt message content before placing in BullMQ payload (SEC-006)
						const encryptedMessages = messages.map((m) => ({
							id: m.id,
							role: m.role,
							content: encrypt(m.content, keys.dek),
							timestamp: m.timestamp,
							sourceMessageId: m.sourceMessageId,
							chatId: m.chatId,
							contactId: m.contactId,
						}));
						bufferMessage(
							userId,
							contactId,
							workspaceId,
							encryptedMessages,
							keyEnvelope,
							workspaceSalt,
							aiConsentContext.commitmentSensitivity,
							sourceAccountId,
						);
						console.log(
							`[sync] Buffered ${messages.length} messages for contact=${short(contactId)}`,
						);
					}

					if (groupMessageBatches.length > 0) {
						const { relationshipExtractionQueue } = await import('./relationship-extraction');

						for (const batch of groupMessageBatches) {
							const encryptedMessages = batch.messages.map((m) => ({
								role: m.role,
								content: encrypt(m.content, keys.dek),
								timestamp: m.timestamp,
								sourceMessageId: m.sourceMessageId,
								chatId: m.chatId,
								contactId: m.contactId,
							}));

							await relationshipExtractionQueue.add(
								'extract-relationships',
								{
									workspaceId,
									userId,
									sourceAccountId,
									chatId: batch.chatId,
									chatType: batch.chatType,
									messages: encryptedMessages,
									keyEnvelope,
									workspaceSalt,
								},
								{
									attempts: 2,
									backoff: { type: 'exponential', delay: 10000 },
									removeOnComplete: true,
									removeOnFail: { count: 50, age: 3600 },
								},
							);
							console.log(
								`[sync] Queued ${batch.messages.length} group messages for relationship extraction in chat=${short(batch.chatId)}`,
							);
						}
					}
				}
			} catch (err) {
				console.error('[sync] Failed to schedule AI pipeline:', redactSensitive(err));
			}
		}

		// 6. Broadcast sync completion via Supabase Realtime
		await broadcastSyncComplete(workspaceId, {
			newMessages: totalNewMessages,
			newContacts: newContactCount,
		});

		// 7. Full-history backfill is intentionally opt-in. A normal personal-account
		// connection should not start deep history import as a side effect of setup.
		if (isTelegramFullBackfillEnabled()) {
			try {
				const { backfillQueue } = await import('./backfill');
				await backfillQueue.add('full-backfill', {
					userId,
					workspaceId,
					enableAiProcessing,
				});
				console.log(`[sync] Enqueued Tier 2 full backfill for workspace=${short(workspaceId)}`);
			} catch (err) {
				console.error('[sync] Failed to enqueue backfill:', (err as Error).message);
			}
		}

		// 8. Recurring Telegram sync is also opt-in. Local-first personal mode runs
		// only the sync the user explicitly started.
		if (isTelegramPeriodicSyncEnabled()) {
			await syncQueue.add(
				'periodic-sync',
				{ userId, workspaceId, syncScope, enableAiProcessing },
				{ delay: 15 * 60 * 1000, jobId: periodicSyncJobId(job.data) },
			);
			console.log(`[sync] Scheduled next sync in 15 minutes for workspace=${short(workspaceId)}`);
		}

		trackAnalyticsEvent(workspaceId, userId, 'sync.completed', {
			duration_ms: Date.now() - syncStartTime,
			contacts_synced: newContactCount,
			messages_synced: totalNewMessages,
			dialogs_processed: dialogs.length,
			sync_scope: syncScope,
			ai_processing_enabled: enableAiProcessing,
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
	console.error(`[sync] Job ${job?.id} failed:`, redactSensitive(err));

	if (job?.data) {
		trackAnalyticsEvent(job.data.workspaceId, job.data.userId, 'sync.failed', {
			error_type: redactSensitive(err.message?.split(':')[0] || 'unknown'),
			attempt: job.attemptsMade,
		});
	}

	// Resilience for deployments that explicitly enable periodic Telegram sync.
	// Local personal-account mode must not retry in the background by default.
	if (job?.data && isTelegramPeriodicSyncEnabled()) {
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
	if (!isTelegramPeriodicSyncEnabled()) {
		console.log('[sync] Periodic Telegram sync disabled');
		return;
	}

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
				{ userId: member.userId, workspaceId: member.workspaceId, syncScope: 'contacts_only' },
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
