import type { SealedEnvelope } from '@repo/crypto';
import { deriveKeys, encrypt, unwrapWrk, withKeys } from '@repo/crypto';
import { and, chats, db, desc, eq, inArray, messages, sql, workspaces } from '@repo/db';
import { relationshipExtractionQueue } from './relationship-extraction';

export interface ConnectionReprocessInput {
	workspaceId: string;
	userId: string;
	batchSize?: number;
	contactLimit?: number;
	contactIds?: string[];
	sourceAccountId?: string;
	maxAgeDays?: number;
}

export interface ConnectionReprocessEstimate {
	workspaceId: string;
	contactLimit: number;
	batchSize: number;
	wouldProcessContacts: number;
	wouldProcessMessages: number;
	maxAgeDays?: number;
}

export interface ConnectionReprocessQueueResult {
	contactsProcessed: number;
	messagesQueued: number;
	batchSize: number;
	contactLimit: number;
	maxAgeDays?: number;
}

export function normalizeConnectionReprocessContactIds(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const ids = value
		.map((item) => (typeof item === 'string' ? item.trim() : ''))
		.filter((item) => item.length > 0);
	const unique = [...new Set(ids)].slice(0, 100);
	return unique.length > 0 ? unique : undefined;
}

export function normalizeConnectionReprocessMaxAgeDays(value: unknown): number | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return undefined;
	return Math.min(Math.max(Math.trunc(numeric), 1), 3650);
}

export function normalizeConnectionReprocessBatchSize(value: unknown): number {
	return Math.min(Math.max(Number(value ?? 200), 1), 200);
}

export function normalizeConnectionReprocessContactLimit(value: unknown): number {
	return Math.min(Math.max(Number(value ?? 25), 1), 100);
}

function normalizeConnectionReprocessInput(input: ConnectionReprocessInput) {
	return {
		...input,
		batchSize: normalizeConnectionReprocessBatchSize(input.batchSize),
		contactLimit: normalizeConnectionReprocessContactLimit(input.contactLimit),
		contactIds: normalizeConnectionReprocessContactIds(input.contactIds),
		maxAgeDays: normalizeConnectionReprocessMaxAgeDays(input.maxAgeDays),
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

async function getConnectionReprocessContactCandidates(input: {
	workspaceId: string;
	contactLimit: number;
	sourceAccountId?: string;
	contactIds?: string[];
	maxAgeDays?: number;
}): Promise<Array<{ id: string; messageCount: number }>> {
	const conditions = [
		eq(messages.workspaceId, input.workspaceId),
		sql`${messages.contactId} IS NOT NULL`,
		sql`${messages.text} IS NOT NULL`,
	];
	if (input.sourceAccountId) {
		conditions.push(eq(chats.sourceAccountId, input.sourceAccountId));
	}
	if (input.contactIds?.length) {
		conditions.push(inArray(messages.contactId, input.contactIds));
	}
	if (input.maxAgeDays) {
		conditions.push(sql`${messages.sentAt} >= now() - (${input.maxAgeDays} * interval '1 day')`);
	}

	const rows = await db
		.select({
			id: messages.contactId,
			messageCount: sql<number>`count(${messages.id})::int`,
			latestSentAt: sql<Date>`max(${messages.sentAt})`,
		})
		.from(messages)
		.innerJoin(chats, eq(chats.id, messages.chatId))
		.where(and(...conditions))
		.groupBy(messages.contactId)
		.orderBy(desc(sql`max(${messages.sentAt})`))
		.limit(input.contactLimit);

	return rows
		.filter((row): row is typeof row & { id: string } => typeof row.id === 'string')
		.map((row) => ({ id: row.id, messageCount: Number(row.messageCount ?? 0) }));
}

async function getConnectionReprocessMessages(input: {
	workspaceId: string;
	contactId: string;
	envelope: SealedEnvelope;
	limit: number;
	sourceAccountId?: string;
	maxAgeDays?: number;
}): Promise<Array<{ id: string; isOutgoing: boolean; sentAt: Date; text: string | null }>> {
	const conditions = [
		eq(messages.workspaceId, input.workspaceId),
		eq(messages.contactId, input.contactId),
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

export async function estimateConnectionReprocess(
	input: ConnectionReprocessInput,
): Promise<ConnectionReprocessEstimate> {
	const normalized = normalizeConnectionReprocessInput(input);
	const workspaceContacts = await getConnectionReprocessContactCandidates({
		workspaceId: normalized.workspaceId,
		contactLimit: normalized.contactLimit,
		sourceAccountId: normalized.sourceAccountId,
		contactIds: normalized.contactIds,
		maxAgeDays: normalized.maxAgeDays,
	});

	let wouldProcessContacts = 0;
	let wouldProcessMessages = 0;
	for (const contact of workspaceContacts) {
		const count = Math.min(contact.messageCount, normalized.batchSize);
		if (count === 0) continue;
		wouldProcessContacts++;
		wouldProcessMessages += count;
	}

	return {
		workspaceId: normalized.workspaceId,
		contactLimit: normalized.contactLimit,
		batchSize: normalized.batchSize,
		wouldProcessContacts,
		wouldProcessMessages,
		maxAgeDays: normalized.maxAgeDays,
	};
}

export async function queueConnectionReprocess(
	input: ConnectionReprocessInput,
): Promise<ConnectionReprocessQueueResult> {
	const normalized = normalizeConnectionReprocessInput(input);
	const workspaceContacts = await getConnectionReprocessContactCandidates({
		workspaceId: normalized.workspaceId,
		contactLimit: normalized.contactLimit,
		sourceAccountId: normalized.sourceAccountId,
		contactIds: normalized.contactIds,
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

	let contactsProcessed = 0;
	let messagesQueued = 0;

	for (const contact of workspaceContacts) {
		const msgs = await getConnectionReprocessMessages({
			workspaceId: normalized.workspaceId,
			contactId: contact.id,
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
				contactId: contact.id,
			}));

		if (encryptedMessages.length === 0) continue;

		await relationshipExtractionQueue.add(
			'extract-relationships',
			{
				workspaceId: normalized.workspaceId,
				userId: normalized.userId,
				...(normalized.sourceAccountId ? { sourceAccountId: normalized.sourceAccountId } : {}),
				contactId: contact.id,
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

		contactsProcessed++;
		messagesQueued += encryptedMessages.length;
	}

	return {
		contactsProcessed,
		messagesQueued,
		batchSize: normalized.batchSize,
		contactLimit: normalized.contactLimit,
		maxAgeDays: normalized.maxAgeDays,
	};
}
