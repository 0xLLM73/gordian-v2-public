import type { SealedEnvelope } from '@repo/crypto';
import { deriveKeys, encrypt, unwrapWrk, withKeys } from '@repo/crypto';
import { and, chats, db, desc, eq, inArray, messages, sql, workspaces } from '@repo/db';
import { relationshipExtractionQueue } from './relationship-extraction';

export interface IntroductionReprocessInput {
	workspaceId: string;
	userId: string;
	batchSize?: number;
	chatLimit?: number;
	chatIds?: string[];
	sourceAccountId?: string;
	maxAgeDays?: number;
}

export interface IntroductionReprocessEstimate {
	workspaceId: string;
	chatLimit: number;
	batchSize: number;
	wouldProcessChats: number;
	wouldProcessMessages: number;
	maxAgeDays?: number;
}

export interface IntroductionReprocessQueueResult {
	chatsProcessed: number;
	messagesQueued: number;
	batchSize: number;
	chatLimit: number;
	maxAgeDays?: number;
}

type IntroChatType = 'group' | 'supergroup';

export function normalizeIntroductionReprocessChatIds(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const ids = value
		.map((item) => (typeof item === 'string' ? item.trim() : ''))
		.filter((item) => item.length > 0);
	const unique = [...new Set(ids)].slice(0, 100);
	return unique.length > 0 ? unique : undefined;
}

export function normalizeIntroductionReprocessMaxAgeDays(value: unknown): number | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return undefined;
	return Math.min(Math.max(Math.trunc(numeric), 1), 3650);
}

export function normalizeIntroductionReprocessBatchSize(value: unknown): number {
	return Math.min(Math.max(Number(value ?? 200), 1), 200);
}

export function normalizeIntroductionReprocessChatLimit(value: unknown): number {
	return Math.min(Math.max(Number(value ?? 25), 1), 100);
}

function normalizeIntroductionReprocessInput(input: IntroductionReprocessInput) {
	return {
		...input,
		batchSize: normalizeIntroductionReprocessBatchSize(input.batchSize),
		chatLimit: normalizeIntroductionReprocessChatLimit(input.chatLimit),
		chatIds: normalizeIntroductionReprocessChatIds(input.chatIds),
		maxAgeDays: normalizeIntroductionReprocessMaxAgeDays(input.maxAgeDays),
		sourceAccountId:
			typeof input.sourceAccountId === 'string' && input.sourceAccountId.trim().length > 0
				? input.sourceAccountId.trim()
				: undefined,
	};
}

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

	const ws = result[0];
	if (!ws) return null;
	const rawCtx = ws.kmsContext;
	const kmsContext: Record<string, string> =
		typeof rawCtx === 'string' ? JSON.parse(rawCtx) : (rawCtx as Record<string, string>);
	return {
		encryptedWrk: Buffer.from(ws.encryptedWrk, 'base64'),
		kmsContext,
		wrkVersion: ws.wrkVersion,
	};
}

async function getIntroductionReprocessChatCandidates(input: {
	workspaceId: string;
	chatLimit: number;
	sourceAccountId?: string;
	chatIds?: string[];
	maxAgeDays?: number;
}): Promise<Array<{ id: string; chatType: IntroChatType; messageCount: number }>> {
	const conditions = [
		eq(messages.workspaceId, input.workspaceId),
		sql`${messages.text} IS NOT NULL`,
		inArray(chats.type, ['group', 'supergroup']),
	];
	if (input.sourceAccountId) {
		conditions.push(eq(chats.sourceAccountId, input.sourceAccountId));
	}
	if (input.chatIds?.length) {
		conditions.push(inArray(messages.chatId, input.chatIds));
	}
	if (input.maxAgeDays) {
		conditions.push(sql`${messages.sentAt} >= now() - (${input.maxAgeDays} * interval '1 day')`);
	}

	const rows = await db
		.select({
			id: chats.id,
			chatType: chats.type,
			messageCount: sql<number>`count(${messages.id})::int`,
			latestSentAt: sql<Date>`max(${messages.sentAt})`,
		})
		.from(messages)
		.innerJoin(chats, eq(chats.id, messages.chatId))
		.where(and(...conditions))
		.groupBy(chats.id, chats.type)
		.orderBy(desc(sql`max(${messages.sentAt})`))
		.limit(input.chatLimit);

	return rows
		.filter(
			(row): row is typeof row & { id: string; chatType: IntroChatType } =>
				typeof row.id === 'string' && (row.chatType === 'group' || row.chatType === 'supergroup'),
		)
		.map((row) => ({
			id: row.id,
			chatType: row.chatType,
			messageCount: Number(row.messageCount ?? 0),
		}));
}

async function getIntroductionReprocessMessages(input: {
	workspaceId: string;
	chatId: string;
	envelope: SealedEnvelope;
	limit: number;
	sourceAccountId?: string;
	maxAgeDays?: number;
}): Promise<
	Array<{
		id: string;
		contactId: string | null;
		isOutgoing: boolean;
		sentAt: Date;
		text: string | null;
	}>
> {
	const conditions = [
		eq(messages.workspaceId, input.workspaceId),
		eq(messages.chatId, input.chatId),
		sql`${messages.text} IS NOT NULL`,
	];
	if (input.sourceAccountId) {
		conditions.push(eq(chats.sourceAccountId, input.sourceAccountId));
	}
	if (input.maxAgeDays) {
		conditions.push(sql`${messages.sentAt} >= now() - (${input.maxAgeDays} * interval '1 day')`);
	}

	return withKeys(input.envelope, async () => {
		return await db
			.select({
				id: messages.id,
				text: messages.text,
				contactId: messages.contactId,
				isOutgoing: messages.isOutgoing,
				sentAt: messages.sentAt,
			})
			.from(messages)
			.innerJoin(chats, eq(chats.id, messages.chatId))
			.where(and(...conditions))
			.orderBy(desc(messages.sentAt), desc(messages.id))
			.limit(input.limit);
	});
}

export async function estimateIntroductionReprocess(
	input: IntroductionReprocessInput,
): Promise<IntroductionReprocessEstimate> {
	const normalized = normalizeIntroductionReprocessInput(input);
	const workspaceChats = await getIntroductionReprocessChatCandidates({
		workspaceId: normalized.workspaceId,
		chatLimit: normalized.chatLimit,
		sourceAccountId: normalized.sourceAccountId,
		chatIds: normalized.chatIds,
		maxAgeDays: normalized.maxAgeDays,
	});

	let wouldProcessChats = 0;
	let wouldProcessMessages = 0;
	for (const chat of workspaceChats) {
		const count = Math.min(chat.messageCount, normalized.batchSize);
		if (count === 0) continue;
		wouldProcessChats++;
		wouldProcessMessages += count;
	}

	return {
		workspaceId: normalized.workspaceId,
		chatLimit: normalized.chatLimit,
		batchSize: normalized.batchSize,
		wouldProcessChats,
		wouldProcessMessages,
		maxAgeDays: normalized.maxAgeDays,
	};
}

export async function queueIntroductionReprocess(
	input: IntroductionReprocessInput,
): Promise<IntroductionReprocessQueueResult> {
	const normalized = normalizeIntroductionReprocessInput(input);
	const workspaceChats = await getIntroductionReprocessChatCandidates({
		workspaceId: normalized.workspaceId,
		chatLimit: normalized.chatLimit,
		sourceAccountId: normalized.sourceAccountId,
		chatIds: normalized.chatIds,
		maxAgeDays: normalized.maxAgeDays,
	});

	const envelope = await getWorkspaceEnvelope(normalized.workspaceId);
	if (!envelope) {
		throw new Error('Workspace envelope not found');
	}

	const wrk = await unwrapWrk(envelope);
	const keys = await deriveKeys(wrk, normalized.workspaceId, envelope.wrkVersion);
	const workspaceSalt = keys.bik.toString('hex');
	const keyEnvelope = {
		encryptedWrk: envelope.encryptedWrk.toString('base64'),
		kmsContext: envelope.kmsContext,
		wrkVersion: envelope.wrkVersion,
	};

	let chatsProcessed = 0;
	let messagesQueued = 0;

	for (const chat of workspaceChats) {
		const msgs = await getIntroductionReprocessMessages({
			workspaceId: normalized.workspaceId,
			chatId: chat.id,
			envelope,
			limit: normalized.batchSize,
			sourceAccountId: normalized.sourceAccountId,
			maxAgeDays: normalized.maxAgeDays,
		});

		const encryptedMessages = msgs
			.reverse()
			.filter((m): m is typeof m & { text: string } => Boolean(m.text))
			.map((m) => ({
				role: m.isOutgoing ? ('user' as const) : ('assistant' as const),
				content: encrypt(m.text, keys.dek),
				timestamp: m.sentAt.toISOString(),
				sourceMessageId: m.id,
				chatId: chat.id,
				contactId: m.contactId ?? undefined,
			}));

		if (encryptedMessages.length === 0) continue;

		await relationshipExtractionQueue.add(
			'extract-relationships',
			{
				workspaceId: normalized.workspaceId,
				userId: normalized.userId,
				...(normalized.sourceAccountId ? { sourceAccountId: normalized.sourceAccountId } : {}),
				chatId: chat.id,
				chatType: chat.chatType,
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

		chatsProcessed++;
		messagesQueued += encryptedMessages.length;
	}

	return {
		chatsProcessed,
		messagesQueued,
		batchSize: normalized.batchSize,
		chatLimit: normalized.chatLimit,
		maxAgeDays: normalized.maxAgeDays,
	};
}
