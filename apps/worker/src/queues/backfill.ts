import type { SealedEnvelope } from '@repo/crypto';
import {
	decrypt,
	decryptSessionKek,
	deriveKeys,
	encrypt,
	maskEntities,
	unwrapWrk,
} from '@repo/crypto';
import { accounts, and, db, eq, workspaces } from '@repo/db';
import { contacts } from '@repo/db';
import {
	getUnembeddedMemories,
	hasUserAiAnalysisConsent,
	listChats,
	updateChatLastSync,
	updateMemoryEmbedding,
	updateMessageSenderMetadataByTelegramIds,
	upsertChat,
	upsertMessages,
} from '@repo/db';
import { redactSensitive } from '@repo/shared';
import { Queue, Worker } from 'bullmq';
import { generateEmbedding } from '../ai/embeddings';
import { prefilterEntities } from '../ai/prefilter';
import { connectUser, sendToUser } from '../gramjs/thread';
import { withRLS } from '../middleware/rls';
import { scheduleAIPipeline } from '../queues/ai-flow';
import { broadcastUpdate } from '../realtime/broadcast';
import { connection } from '../redis';

// ---------------------------------------------------------------------------
// Job data types
// ---------------------------------------------------------------------------

export interface BackfillJobData {
	userId: string;
	workspaceId: string;
	enableAiProcessing?: boolean;
	/** Tier 3: specific chat to import (omit for all dialogs) */
	chatId?: string;
	/** Tier 3: start of date window (unix timestamp) */
	minDate?: number;
	/** Tier 3: end of date window (unix timestamp) */
	maxDate?: number;
}

/**
 * Job data for the embedding backfill worker.
 * Iterates memories missing embeddings and generates them in batches.
 *
 * SEC-028: NEVER pass the envelope in job payload — it is resolved from DB+KMS
 * inside the worker.
 */
export interface BackfillEmbeddingsJobData {
	workspaceId: string;
	userId: string;
	batchSize?: number;
}

/** GramJS dialog shape */
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

/** GramJS message shape */
interface GramJSMessage {
	id: number;
	text: string;
	date: number;
	senderId?: string;
	senderPeerId?: string;
	senderPeerType?: 'user' | 'chat' | 'channel';
	isOutgoing: boolean;
}

/** Delay between dialog fetches to avoid Telegram rate limits (ms) */
const INTER_DIALOG_DELAY = 2000;
/** Messages fetched per page */
const PAGE_SIZE = 100;

function assertStoredSessionUnwrapAllowedForBackfill(): void {
	if (process.env.NODE_ENV === 'test') return;
	if (process.env.TELEGRAM_ALLOW_SESSION_UNWRAP_OUTSIDE_IMPORTS?.trim() === 'true') return;
	throw new Error(
		'Stored Telegram session unwrap is restricted to history imports. Use the Telegram history import flow, or explicitly set TELEGRAM_ALLOW_SESSION_UNWRAP_OUTSIDE_IMPORTS=true for legacy backfill.',
	);
}

/** Look up Telegram session ciphertext and KEK blob */
async function getTelegramSession(
	userId: string,
): Promise<{ rawCiphertext: string; sessionKekEncrypted: Buffer } | null> {
	const result = await db
		.select({
			accessToken: accounts.accessToken,
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
		sessionKekEncrypted: result[0].sessionKekEncrypted,
	};
}

/** Ensure GramJS is connected with the user's stored session (per-user KEK) */
async function ensureGramJSConnected(userId: string, _envelope: SealedEnvelope): Promise<void> {
	assertStoredSessionUnwrapAllowedForBackfill();
	const account = await getTelegramSession(userId);
	if (!account) {
		throw new Error('No Telegram session found for user');
	}

	const kek = await decryptSessionKek(account.sessionKekEncrypted, userId);
	const sessionString = decrypt(account.rawCiphertext, kek);
	kek.fill(0);

	await connectUser(userId, sessionString);
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

/**
 * Backfill queue — Tier 2 (full history) + Tier 3 (date window import).
 * Low priority, concurrency 1, generous backoff to avoid Telegram bans.
 */
export const backfillQueue = new Queue<BackfillJobData>('backfill', {
	connection,
	prefix: '{ai-flow}',
	defaultJobOptions: {
		attempts: 3,
		backoff: { type: 'exponential', delay: 10000 },
		removeOnComplete: true,
		removeOnFail: { count: 25, age: 3600 },
	},
});

/**
 * Embedding backfill queue — processes memories missing embeddings in batches.
 * Queue name follows {ai-flow}:* prefix convention (CROSSSLOT prevention).
 */
export const embeddingBackfillQueue = new Queue<BackfillEmbeddingsJobData>('embedding-backfill', {
	connection,
	prefix: '{ai-flow}',
	defaultJobOptions: {
		attempts: 3,
		backoff: { type: 'exponential', delay: 5000 },
		removeOnComplete: true,
		removeOnFail: { count: 25, age: 3600 },
	},
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch all messages for a chat, paginating through history.
 * For date-window imports, minDate/maxDate constrain the fetch.
 */
async function fetchAllMessages(
	userId: string,
	peerId: string,
	options?: { minDate?: number; maxDate?: number },
): Promise<GramJSMessage[]> {
	const allMessages: GramJSMessage[] = [];
	let offsetId = 0;
	let hasMore = true;

	while (hasMore) {
		const result = await sendToUser<{
			type: string;
			messages: GramJSMessage[];
		}>(userId, {
			type: 'get-messages',
			peerId,
			limit: PAGE_SIZE,
			offsetId,
			minDate: options?.minDate ?? 0,
			maxDate: options?.maxDate ?? 0,
		});

		if (result.messages.length === 0) {
			hasMore = false;
			break;
		}

		allMessages.push(...result.messages);

		// GramJS returns messages newest-first; the last one has the smallest ID
		const lastMessage = result.messages[result.messages.length - 1];
		offsetId = lastMessage.id;

		// If we got fewer than PAGE_SIZE, we've reached the end
		if (result.messages.length < PAGE_SIZE) {
			hasMore = false;
		}

		// Rate-limit between pages
		await sleep(500);
	}

	return allMessages;
}

/**
 * Process messages for a single chat: map senders, insert, update lastSyncAt.
 */
async function processChat(
	workspaceId: string,
	chatDbId: string,
	rawMessages: GramJSMessage[],
	contactMap: Map<string, string>,
	envelope: SealedEnvelope,
): Promise<number> {
	if (rawMessages.length === 0) return 0;

	const messagesToInsert = rawMessages.map((m) => ({
		telegramMessageId: String(m.id),
		contactId: m.senderId ? (contactMap.get(m.senderId) ?? undefined) : undefined,
		telegramSenderId: m.senderPeerId ?? m.senderId,
		telegramSenderType: m.senderPeerType ?? (m.senderId ? ('user' as const) : undefined),
		text: m.text || undefined,
		isOutgoing: m.isOutgoing,
		sentAt: new Date(m.date * 1000),
	}));

	// Insert in batches of 500 to avoid hitting parameter limits
	let inserted = 0;
	for (let i = 0; i < messagesToInsert.length; i += 500) {
		const batch = messagesToInsert.slice(i, i + 500);
		inserted += await upsertMessages(workspaceId, chatDbId, batch, envelope);
		const metadataBatch = batch.flatMap((message) =>
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
		if (metadataBatch.length > 0) {
			await updateMessageSenderMetadataByTelegramIds(workspaceId, chatDbId, metadataBatch);
		}
	}

	await updateChatLastSync(workspaceId, chatDbId);
	return inserted;
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

/** Truncate UUID to first 8 chars for safe logging */
const short = (id: string) => id.slice(0, 8);

export const backfillWorker = new Worker<BackfillJobData>(
	'backfill',
	withRLS(async (job) => {
		const { userId, workspaceId, chatId, minDate, maxDate } = job.data;
		const enableAiProcessing = job.data.enableAiProcessing === true;
		const isDateWindow = minDate !== undefined || maxDate !== undefined;
		const jobType = isDateWindow ? 'Tier 3 date window' : 'Tier 2 full backfill';

		console.log(`[backfill] Starting ${jobType} for workspace=${short(workspaceId)}`);

		// Fetch envelope first — needed to decrypt the Telegram session
		const envelope = await getWorkspaceEnvelope(workspaceId);
		if (!envelope) {
			console.warn('[backfill] No workspace envelope, aborting');
			return;
		}

		// Ensure GramJS is connected with the user's Telegram session
		await ensureGramJSConnected(userId, envelope);

		const contactMap = await buildTelegramContactMap(workspaceId);

		// Tier 3: specific chat import
		if (chatId) {
			const existingChats = await listChats(workspaceId, envelope);
			const chat = existingChats.find((c) => c.id === chatId);
			if (!chat) {
				console.warn(`[backfill] Chat ${short(chatId)} not found, aborting`);
				return;
			}

			const rawMessages = await fetchAllMessages(userId, chat.telegramChatId, { minDate, maxDate });
			const inserted = await processChat(workspaceId, chat.id, rawMessages, contactMap, envelope);

			await broadcastUpdate(workspaceId, 'backfill-progress', {
				status: 'complete',
				chatId,
				messagesImported: inserted,
			});

			if (inserted > 0) {
				const { enqueueHealthScoringForWorkspace } = await import('./health-scoring-queue');
				await enqueueHealthScoringForWorkspace(workspaceId, {
					force: true,
					keyEnvelope: {
						encryptedWrk: envelope.encryptedWrk.toString('base64'),
						kmsContext: envelope.kmsContext,
						wrkVersion: envelope.wrkVersion,
					},
					reason: 'telegram_backfill_chat_completed',
				}).catch((err) => {
					console.warn('[backfill] Failed to queue health scoring:', redactSensitive(err));
				});
			}

			console.log(`[backfill] ${jobType} complete: ${inserted} messages for chat=${short(chatId)}`);
			return;
		}

		// Tier 2/3: all dialogs
		const dialogsResult = await sendToUser<{
			type: string;
			dialogs: GramJSDialog[];
		}>(userId, { type: 'get-dialogs', limit: 500 });

		const dialogs = dialogsResult.dialogs.filter((d) => !d.isBot);
		const totalDialogs = dialogs.length;
		let totalMessages = 0;
		let processedDialogs = 0;
		/** Collect messages per contact for AI pipeline */
		const contactMessagesMap = new Map<
			string,
			Array<{ role: string; content: string; timestamp: string }>
		>();

		console.log(`[backfill] Processing ${totalDialogs} dialogs`);

		for (const dialog of dialogs) {
			try {
				// Upsert chat
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

				if (!chat) continue;

				// Fetch messages (full history or date window)
				const rawMessages = await fetchAllMessages(userId, dialog.chatId, { minDate, maxDate });
				const inserted = await processChat(workspaceId, chat.id, rawMessages, contactMap, envelope);

				totalMessages += inserted;
				processedDialogs++;

				// Collect messages for AI pipeline (private chats with new messages only)
				if (inserted > 0 && dialog.type === 'private') {
					const peerContactId = contactMap.get(dialog.chatId);
					if (peerContactId) {
						const aiMessages = rawMessages
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
					}
				}

				// Broadcast progress
				await broadcastUpdate(workspaceId, 'backfill-progress', {
					status: 'in_progress',
					processedDialogs,
					totalDialogs,
					totalMessages,
					currentChat: short(dialog.chatId),
				});

				console.log(
					`[backfill] [${processedDialogs}/${totalDialogs}] chat=${short(dialog.chatId)}: ${inserted} new messages`,
				);

				// Rate-limit between dialogs
				await sleep(INTER_DIALOG_DELAY);
			} catch (err) {
				const error = err as Error;
				if (error.message.includes('FLOOD_WAIT') || error.message.includes('FloodWait')) {
					// Extract wait time from error if possible, otherwise default 60s
					const waitMatch = error.message.match(/(\d+)/);
					const waitSeconds = waitMatch ? Number.parseInt(waitMatch[1], 10) : 60;
					console.warn(`[backfill] Flood wait ${waitSeconds}s, skipping chat`);
					await sleep(waitSeconds * 1000);
					// Don't retry this dialog, continue with next
				} else {
					console.error('[backfill] Error on chat:', error.message);
				}
			}
		}

		// Trigger AI pipeline for contacts with new messages
		if (contactMessagesMap.size > 0 && enableAiProcessing) {
			try {
				const hasConsent = await hasUserAiAnalysisConsent(userId, workspaceId);
				if (!hasConsent) {
					console.log(
						`[backfill] AI processing requested but consent is not persisted for workspace=${short(workspaceId)}, skipping AI pipeline`,
					);
				} else {
					const wrk = await unwrapWrk(envelope);
					const keys = await deriveKeys(wrk, workspaceId, envelope.wrkVersion);
					const workspaceSalt = keys.bik.toString('hex');

					const keyEnvelope = {
						encryptedWrk: envelope.encryptedWrk.toString('base64'),
						kmsContext: envelope.kmsContext,
						wrkVersion: envelope.wrkVersion,
					};

					for (const [contactId, messages] of contactMessagesMap) {
						const encryptedMessages = messages.map((m) => ({
							role: m.role,
							content: encrypt(m.content, keys.dek),
							timestamp: m.timestamp,
						}));
						await scheduleAIPipeline(
							userId,
							contactId,
							workspaceId,
							keyEnvelope,
							encryptedMessages,
							workspaceSalt,
						);
						console.log(
							`[backfill] Scheduled AI pipeline for contact=${short(contactId)} (${messages.length} messages)`,
						);
					}
				}
			} catch (err) {
				console.error('[backfill] Failed to schedule AI pipeline:', redactSensitive(err));
			}
		}

		// Final broadcast
		await broadcastUpdate(workspaceId, 'backfill-progress', {
			status: 'complete',
			processedDialogs,
			totalDialogs,
			totalMessages,
		});

		if (totalMessages > 0) {
			const { enqueueHealthScoringForWorkspace } = await import('./health-scoring-queue');
			await enqueueHealthScoringForWorkspace(workspaceId, {
				force: true,
				keyEnvelope: {
					encryptedWrk: envelope.encryptedWrk.toString('base64'),
					kmsContext: envelope.kmsContext,
					wrkVersion: envelope.wrkVersion,
				},
				reason: 'telegram_backfill_completed',
			}).catch((err) => {
				console.warn('[backfill] Failed to queue health scoring:', redactSensitive(err));
			});
		}

		console.log(
			`[backfill] ${jobType} complete: ${totalMessages} messages across ${processedDialogs} dialogs`,
		);
	}),
	{
		connection,
		prefix: '{ai-flow}',
		concurrency: 1, // Only one backfill at a time per worker
	},
);

backfillWorker.on('completed', (job) => {
	console.log(`[backfill] Job ${job.id} completed`);
});

backfillWorker.on('failed', (job, err) => {
	console.error(`[backfill] Job ${job?.id} failed:`, redactSensitive(err));
});

// ---------------------------------------------------------------------------
// Embedding Backfill Worker
// ---------------------------------------------------------------------------

/**
 * Embedding backfill worker — generates embeddings for memories that were
 * created during sync/extraction but never had embeddings generated.
 *
 * Security compliance:
 * - SEC-028: Envelope resolved from DB+KMS inside worker, never in job payload.
 * - SEC-122: Entity-linked masking applied before every generateEmbedding() call.
 *
 * Processes in batches of batchSize (default 50) to avoid OpenAI rate limits.
 * Re-enqueues itself if more unembedded memories remain after the batch.
 */
export const embeddingBackfillWorker = new Worker<BackfillEmbeddingsJobData>(
	'embedding-backfill',
	withRLS(async (job) => {
		const { workspaceId, batchSize = 50 } = job.data;

		console.log(
			`[embedding-backfill] Starting batch for workspace=${short(workspaceId)}, batchSize=${batchSize}`,
		);

		// Step 1: Resolve envelope from DB+KMS — NEVER from job payload (SEC-028)
		const envelope = await getWorkspaceEnvelope(workspaceId);
		if (!envelope) {
			console.warn(
				`[embedding-backfill] No workspace envelope for ${short(workspaceId)}, aborting`,
			);
			return;
		}

		// Step 2: Derive workspace salt for entity-linked masking (SEC-122)
		const wrk = await unwrapWrk(envelope);
		const keys = await deriveKeys(wrk, workspaceId, envelope.wrkVersion);
		const workspaceSalt = keys.bik; // Buffer — HMAC salt for maskEntities()

		// Step 3: Fetch batch of unembedded memories (content decrypted via encryptedText custom type)
		const batch = await getUnembeddedMemories(workspaceId, envelope, batchSize);

		if (batch.length === 0) {
			console.log(
				`[embedding-backfill] No unembedded memories for workspace=${short(workspaceId)}`,
			);
			return;
		}

		console.log(
			`[embedding-backfill] Processing ${batch.length} memories for workspace=${short(workspaceId)}`,
		);

		let embedded = 0;
		let failed = 0;

		// Step 4: For each memory, mask + embed + store
		for (const memory of batch) {
			try {
				// SEC-122: Apply entity-linked masking BEFORE generating embedding
				const detectedEntities = prefilterEntities(memory.content);
				const { maskedText } = maskEntities(memory.content, workspaceSalt, detectedEntities);

				// Generate embedding from sanitized text — NEVER raw PII
				const embedding = await generateEmbedding(maskedText);

				// Persist embedding + content_sanitized
				await updateMemoryEmbedding(workspaceId, memory.id, memory.category, embedding, maskedText);

				embedded++;
			} catch (err) {
				failed++;
				console.error(
					`[embedding-backfill] Failed to embed memory=${short(memory.id)}:`,
					(err as Error).message,
				);
				// Continue processing remaining memories — don't abort the whole batch
			}
		}

		console.log(
			`[embedding-backfill] embedded ${embedded}/${batch.length} memories for workspace ${workspaceId} (${failed} failed)`,
		);

		// Step 5: If batch was full, re-enqueue to process the next batch
		if (batch.length === batchSize) {
			console.log(
				`[embedding-backfill] Batch full — re-enqueuing next batch for workspace=${short(workspaceId)}`,
			);
			await embeddingBackfillQueue.add('embedding-backfill', {
				workspaceId,
				userId: job.data.userId,
				batchSize,
			});
		}
	}),
	{
		connection,
		prefix: '{ai-flow}',
		concurrency: 1, // Serialize to respect OpenAI rate limits
	},
);

embeddingBackfillWorker.on('completed', (job) => {
	console.log(`[embedding-backfill] Job ${job.id} completed`);
});

embeddingBackfillWorker.on('failed', (job, err) => {
	console.error(`[embedding-backfill] Job ${job?.id} failed:`, redactSensitive(err));
});
