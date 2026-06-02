import { withKeys } from '@repo/crypto';
import type { SealedEnvelope } from '@repo/crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../client';
import { memories } from '../schema/memories';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LEGACY_MESSAGE_ID_KEYS = [
	'message_id',
	'sourceMessageId',
	'source_message_id',
	'telegramDbMessageId',
	'telegram_db_message_id',
] as const;

const LEGACY_MESSAGE_ID_ARRAY_KEYS = [
	'sourceMessageIds',
	'source_message_ids',
	'messageIds',
	'message_ids',
] as const;

const LEGACY_MESSAGE_OBJECT_ARRAY_KEYS = ['sourceMessages', 'source_messages', 'messages'] as const;

export interface CreateMemoryInput {
	contactId?: string;
	category: string;
	content: string;
	contentSanitized?: string;
	embedding?: number[];
	metadata?: Record<string, unknown>;
}

export interface HybridSearchResult {
	id: string;
	content: string;
	category: string;
	rrf_score: number;
	semantic_score: number;
	fts_rank: number;
}

export interface UnembeddedMemory {
	id: string;
	content: string;
	category: string;
}

export type MemoryMessageBackfillSkipReason =
	| 'already_has_message_id'
	| 'ambiguous'
	| 'no_deterministic_source'
	| 'no_matching_message';

export interface MemoryMessageBackfillOptions {
	workspaceId?: string;
	limit?: number;
	write?: boolean;
	now?: Date;
}

export interface MemoryMessageBackfillWorkspaceSummary {
	workspaceId: string;
	totalMemories: number;
	memoriesMissingMessageId: number;
	eligibleForBackfill: number;
	skippedAlreadyHasMessageId: number;
	skippedAmbiguous: number;
	skippedNoDeterministicSource: number;
	skippedNoMatchingMessage: number;
	updated: number;
	estimatedUnlockedEvidenceRows: number;
	estimatedUnlockedKnowledgeNodes: number;
}

export interface MemoryMessageBackfillContactSummary {
	workspaceId: string;
	contactId: string | null;
	totalMemories: number;
	memoriesMissingMessageId: number;
	eligibleForBackfill: number;
	skippedAmbiguous: number;
	skippedNoDeterministicSource: number;
	skippedNoMatchingMessage: number;
	updated: number;
}

export interface MemoryMessageBackfillCandidate {
	memoryId: string;
	workspaceId: string;
	contactId: string | null;
	category: string;
	messageId: string;
	sourceKey: string;
	estimatedUnlockedEvidenceRows: number;
	estimatedUnlockedKnowledgeNodes: number;
}

export interface MemoryMessageBackfillReport {
	mode: 'dry-run' | 'write';
	workspaceId: string | null;
	totalMemories: number;
	memoriesMissingMessageId: number;
	eligibleForBackfill: number;
	skippedAlreadyHasMessageId: number;
	skippedAmbiguous: number;
	skippedNoDeterministicSource: number;
	skippedNoMatchingMessage: number;
	updated: number;
	estimatedUnlockedEvidenceRows: number;
	estimatedUnlockedKnowledgeNodes: number;
	byWorkspace: MemoryMessageBackfillWorkspaceSummary[];
	byContact: MemoryMessageBackfillContactSummary[];
	candidates: MemoryMessageBackfillCandidate[];
	recommendedNextAction: string;
}

interface MemoryMessageBackfillRow {
	id: string;
	workspaceId: string;
	contactId: string | null;
	category: string;
	metadata: Record<string, unknown> | null;
	createdAt: Date | null;
}

interface ExtractedMessageIdCandidate {
	status: 'candidate';
	messageId: string;
	sourceKey: string;
}

interface ExtractedMessageIdSkip {
	status: MemoryMessageBackfillSkipReason;
}

type ExtractedMessageIdResult = ExtractedMessageIdCandidate | ExtractedMessageIdSkip;

function rowsFromExecute<T>(result: unknown): T[] {
	if (Array.isArray(result)) return result as T[];
	if (
		result &&
		typeof result === 'object' &&
		'rows' in result &&
		Array.isArray((result as { rows?: unknown }).rows)
	) {
		return (result as { rows: T[] }).rows;
	}
	return [];
}

function asString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function validUuid(value: unknown): string | null {
	const str = asString(value);
	return str && UUID_RE.test(str) ? str : null;
}

function messageIdFromObject(value: unknown): string | null {
	const obj = normalizeMetadata(value);
	return validUuid(obj.id) ?? validUuid(obj.messageId) ?? validUuid(obj.sourceMessageId);
}

export function mergeMemoryMessageBackfillMetadata(
	metadata: Record<string, unknown> | null | undefined,
	messageId: string,
	sourceKey: string,
	now: Date,
): Record<string, unknown> {
	return {
		...normalizeMetadata(metadata),
		messageId,
		messageIdBackfilledAt: now.toISOString(),
		messageIdBackfillSource: sourceKey,
	};
}

function extractMemoryMessageIdCandidate(metadataInput: unknown): ExtractedMessageIdResult {
	const metadata = normalizeMetadata(metadataInput);
	const existingMessageId = validUuid(metadata.messageId);
	if (existingMessageId) return { status: 'already_has_message_id' };
	if (
		metadata.messageId !== undefined &&
		metadata.messageId !== null &&
		metadata.messageId !== ''
	) {
		return { status: 'no_deterministic_source' };
	}

	const candidates: Array<{ messageId: string; sourceKey: string }> = [];
	const ambiguousSources = new Set<string>();

	for (const key of LEGACY_MESSAGE_ID_KEYS) {
		const messageId = validUuid(metadata[key]);
		if (messageId) candidates.push({ messageId, sourceKey: key });
	}

	for (const key of LEGACY_MESSAGE_ID_ARRAY_KEYS) {
		const value = metadata[key];
		if (!Array.isArray(value)) continue;
		const ids = [...new Set(value.map(validUuid).filter(Boolean) as string[])];
		if (ids.length === 1) {
			candidates.push({ messageId: ids[0] ?? '', sourceKey: key });
		} else if (ids.length > 1) {
			ambiguousSources.add(key);
		}
	}

	for (const key of LEGACY_MESSAGE_OBJECT_ARRAY_KEYS) {
		const value = metadata[key];
		if (!Array.isArray(value)) continue;
		const ids = [...new Set(value.map(messageIdFromObject).filter(Boolean) as string[])];
		if (ids.length === 1) {
			candidates.push({ messageId: ids[0] ?? '', sourceKey: key });
		} else if (ids.length > 1) {
			ambiguousSources.add(key);
		}
	}

	const distinct = [...new Set(candidates.map((candidate) => candidate.messageId))].filter(Boolean);
	if (distinct.length > 1 || ambiguousSources.size > 0) return { status: 'ambiguous' };
	if (distinct.length === 0) return { status: 'no_deterministic_source' };

	const candidate = candidates.find((item) => item.messageId === distinct[0]);
	if (!candidate) return { status: 'no_deterministic_source' };
	return { status: 'candidate', messageId: candidate.messageId, sourceKey: candidate.sourceKey };
}

function emptyWorkspaceSummary(workspaceId: string): MemoryMessageBackfillWorkspaceSummary {
	return {
		workspaceId,
		totalMemories: 0,
		memoriesMissingMessageId: 0,
		eligibleForBackfill: 0,
		skippedAlreadyHasMessageId: 0,
		skippedAmbiguous: 0,
		skippedNoDeterministicSource: 0,
		skippedNoMatchingMessage: 0,
		updated: 0,
		estimatedUnlockedEvidenceRows: 0,
		estimatedUnlockedKnowledgeNodes: 0,
	};
}

function emptyContactSummary(
	workspaceId: string,
	contactId: string | null,
): MemoryMessageBackfillContactSummary {
	return {
		workspaceId,
		contactId,
		totalMemories: 0,
		memoriesMissingMessageId: 0,
		eligibleForBackfill: 0,
		skippedAmbiguous: 0,
		skippedNoDeterministicSource: 0,
		skippedNoMatchingMessage: 0,
		updated: 0,
	};
}

function incrementSummary(
	summary: MemoryMessageBackfillWorkspaceSummary,
	status: ExtractedMessageIdResult['status'] | 'eligible',
) {
	summary.totalMemories += 1;
	if (status !== 'already_has_message_id') summary.memoriesMissingMessageId += 1;
	if (status === 'already_has_message_id') summary.skippedAlreadyHasMessageId += 1;
	if (status === 'ambiguous') summary.skippedAmbiguous += 1;
	if (status === 'no_deterministic_source') summary.skippedNoDeterministicSource += 1;
	if (status === 'no_matching_message') summary.skippedNoMatchingMessage += 1;
	if (status === 'eligible') summary.eligibleForBackfill += 1;
}

function incrementContactSummary(
	summary: MemoryMessageBackfillContactSummary,
	status: ExtractedMessageIdResult['status'] | 'eligible',
) {
	summary.totalMemories += 1;
	if (status !== 'already_has_message_id') summary.memoriesMissingMessageId += 1;
	if (status === 'ambiguous') summary.skippedAmbiguous += 1;
	if (status === 'no_deterministic_source') summary.skippedNoDeterministicSource += 1;
	if (status === 'no_matching_message') summary.skippedNoMatchingMessage += 1;
	if (status === 'eligible') summary.eligibleForBackfill += 1;
}

export async function createMemory(
	workspaceId: string,
	input: CreateMemoryInput,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		// Dedup guard: if content_sanitized matches an existing row for this
		// workspace + contact + category, skip the insert to prevent duplicates
		// from re-processing the same messages.
		if (input.contentSanitized && input.contactId) {
			const existing = await db.execute(sql`
				SELECT id FROM memories
				WHERE workspace_id = ${workspaceId}::uuid
					AND contact_id = ${input.contactId}::uuid
					AND category = ${input.category}::memory_category
					AND content_sanitized = ${input.contentSanitized}
				LIMIT 1
			`);
			if ((existing as unknown[]).length > 0) {
				return (existing as unknown as Array<{ id: string }>)[0];
			}
		}

		const result = await db
			.insert(memories)
			.values({
				workspaceId,
				contactId: input.contactId,
				category: input.category as (typeof memories.category.enumValues)[number],
				content: input.content,
				contentSanitized: input.contentSanitized,
				embedding: input.embedding,
				metadata: input.metadata ?? {},
			})
			.returning();
		return result[0] ?? null;
	});
}

export async function getMemoriesByContact(
	workspaceId: string,
	contactId: string,
	envelope: SealedEnvelope,
	options?: { category?: string; limit?: number; offset?: number },
) {
	const limit = options?.limit ?? 50;
	const offset = options?.offset ?? 0;

	return withKeys(envelope, async () => {
		const conditions = [eq(memories.workspaceId, workspaceId), eq(memories.contactId, contactId)];

		if (options?.category) {
			conditions.push(
				eq(memories.category, options.category as (typeof memories.category.enumValues)[number]),
			);
		}

		return await db
			.select()
			.from(memories)
			.where(and(...conditions))
			.limit(limit)
			.offset(offset)
			.orderBy(memories.createdAt);
	});
}

/**
 * Fetch memories that have no embedding yet, for backfill processing.
 * Content is decrypted transparently via the encryptedText custom type
 * when inside a withKeys() context.
 *
 * IMPORTANT: Must be called from inside a withKeys() context (or wraps one
 * internally) so the encryptedText custom type can decrypt content.
 */
export async function getUnembeddedMemories(
	workspaceId: string,
	envelope: SealedEnvelope,
	limit = 100,
): Promise<UnembeddedMemory[]> {
	return withKeys(envelope, async () => {
		const rows = await db
			.select({
				id: memories.id,
				content: memories.content,
				category: memories.category,
			})
			.from(memories)
			.where(and(eq(memories.workspaceId, workspaceId), isNull(memories.embedding)))
			.limit(limit)
			.orderBy(memories.createdAt);

		return rows.map((r) => ({
			id: r.id as string,
			content: r.content,
			category: r.category,
		}));
	});
}

/**
 * Hybrid search using the hybrid_search() SQL function.
 * Combines pgvector semantic search + PostgreSQL FTS via RRF.
 */
export async function hybridSearch(
	workspaceId: string,
	queryEmbedding: number[],
	queryText: string,
	options?: { category?: string; limit?: number },
): Promise<HybridSearchResult[]> {
	const limit = options?.limit ?? 10;
	const embeddingStr = `[${queryEmbedding.join(',')}]`;

	const result = await db.execute(sql`
		SELECT * FROM hybrid_search(
			${workspaceId}::uuid,
			${embeddingStr}::halfvec(512),
			${queryText},
			${options?.category ?? null}::memory_category,
			${limit}
		)
	`);

	return result as unknown as HybridSearchResult[];
}

/**
 * Text-only search fallback using PostgreSQL full-text search.
 * Used when no query embedding is available (e.g. embedding generation not wired up).
 */
export async function textSearch(
	workspaceId: string,
	queryText: string,
	options?: { category?: string; limit?: number },
): Promise<HybridSearchResult[]> {
	const limit = options?.limit ?? 10;

	const result = await db.execute(sql`
		SELECT
			m.id,
			m.content_sanitized AS content,
			m.category,
			ts_rank(to_tsvector('english', m.content_sanitized), plainto_tsquery('english', ${queryText}))::float AS rrf_score,
			0::float AS semantic_score,
			ts_rank(to_tsvector('english', m.content_sanitized), plainto_tsquery('english', ${queryText}))::float AS fts_rank
		FROM memories m
		WHERE m.workspace_id = ${workspaceId}::uuid
			AND m.content_sanitized IS NOT NULL
			AND to_tsvector('english', m.content_sanitized) @@ plainto_tsquery('english', ${queryText})
		ORDER BY fts_rank DESC
		LIMIT ${limit}
	`);

	return result as unknown as HybridSearchResult[];
}

export async function updateMemoryEmbedding(
	workspaceId: string,
	memoryId: string,
	category: string,
	embedding: number[],
	contentSanitized: string,
) {
	const embeddingStr = `[${embedding.join(',')}]`;

	await db.execute(sql`
		UPDATE memories
		SET embedding = ${embeddingStr}::halfvec(512),
			content_sanitized = ${contentSanitized},
			updated_at = NOW()
		WHERE id = ${memoryId}
		AND workspace_id = ${workspaceId}::uuid
		AND category = ${category}::memory_category
	`);
}

async function listMemoryMessageBackfillRows(
	opts: Pick<MemoryMessageBackfillOptions, 'workspaceId' | 'limit'>,
): Promise<MemoryMessageBackfillRow[]> {
	const workspaceFilter = opts.workspaceId
		? sql`AND workspace_id = ${opts.workspaceId}::uuid`
		: sql``;
	const limitClause =
		typeof opts.limit === 'number' && Number.isFinite(opts.limit) && opts.limit > 0
			? sql`LIMIT ${opts.limit}`
			: sql``;

	const result = await db.execute(sql`
		SELECT
			id::text AS id,
			workspace_id::text AS "workspaceId",
			contact_id::text AS "contactId",
			category::text AS category,
			metadata,
			created_at AS "createdAt"
		FROM memories
		WHERE true
			${workspaceFilter}
		ORDER BY created_at ASC
		${limitClause}
	`);

	return rowsFromExecute<Record<string, unknown>>(result).map((row) => ({
		id: asString(row.id) ?? '',
		workspaceId: asString(row.workspaceId) ?? '',
		contactId: asString(row.contactId),
		category: asString(row.category) ?? 'general',
		metadata: normalizeMetadata(row.metadata),
		createdAt: row.createdAt instanceof Date ? row.createdAt : null,
	}));
}

async function findExistingWorkspaceMessages(
	candidates: Array<{ workspaceId: string; messageId: string }>,
): Promise<Set<string>> {
	const messageIds = [...new Set(candidates.map((candidate) => candidate.messageId))];
	if (messageIds.length === 0) return new Set();

	const messageIdList = sql.join(
		messageIds.map((messageId) => sql`${messageId}::uuid`),
		sql`, `,
	);
	const result = await db.execute(sql`
		SELECT
			id::text AS id,
			workspace_id::text AS "workspaceId"
		FROM messages
		WHERE id IN (${messageIdList})
	`);

	return new Set(
		rowsFromExecute<Record<string, unknown>>(result).map(
			(row) => `${asString(row.workspaceId)}:${asString(row.id)}`,
		),
	);
}

async function findUnlockableKnowledgeEvidence(
	candidates: Array<{ workspaceId: string; messageId: string }>,
): Promise<Map<string, { evidenceRows: number; knowledgeNodeIds: Set<string> }>> {
	const messageIds = [...new Set(candidates.map((candidate) => candidate.messageId))];
	if (messageIds.length === 0) return new Map();

	const messageIdList = sql.join(
		messageIds.map((messageId) => sql`${messageId}::uuid`),
		sql`, `,
	);
	const result = await db.execute(sql`
		SELECT
			id::text AS "evidenceId",
			workspace_id::text AS "workspaceId",
			message_id::text AS "messageId",
			knowledge_node_id::text AS "knowledgeNodeId"
		FROM knowledge_evidence
		WHERE message_id IN (${messageIdList})
	`);

	const byWorkspaceMessage = new Map<
		string,
		{ evidenceRows: number; knowledgeNodeIds: Set<string> }
	>();
	for (const row of rowsFromExecute<Record<string, unknown>>(result)) {
		const workspaceId = asString(row.workspaceId);
		const messageId = asString(row.messageId);
		const knowledgeNodeId = asString(row.knowledgeNodeId);
		if (!workspaceId || !messageId || !knowledgeNodeId) continue;
		const key = `${workspaceId}:${messageId}`;
		const summary = byWorkspaceMessage.get(key) ?? {
			evidenceRows: 0,
			knowledgeNodeIds: new Set<string>(),
		};
		summary.evidenceRows += 1;
		summary.knowledgeNodeIds.add(knowledgeNodeId);
		byWorkspaceMessage.set(key, summary);
	}

	return byWorkspaceMessage;
}

async function writeMemoryMessageBackfillCandidate(
	candidate: MemoryMessageBackfillCandidate,
	now: Date,
): Promise<boolean> {
	const metadataPatch = JSON.stringify(
		mergeMemoryMessageBackfillMetadata(null, candidate.messageId, candidate.sourceKey, now),
	);

	const result = await db.execute(sql`
		UPDATE memories
		SET metadata = coalesce(metadata, '{}'::jsonb) || ${metadataPatch}::jsonb,
			updated_at = now()
		WHERE id = ${candidate.memoryId}::uuid
			AND workspace_id = ${candidate.workspaceId}::uuid
			AND category = ${candidate.category}::memory_category
			AND coalesce(metadata->>'messageId', '') = ''
		RETURNING id
	`);

	return rowsFromExecute(result).length > 0;
}

/**
 * Deterministically reports or backfills memories.metadata.messageId.
 *
 * This intentionally refuses contact+timestamp guesses. A memory is eligible
 * only when metadata already carries exactly one DB message UUID under a known
 * legacy source key, and that message exists in the same workspace.
 */
export async function backfillMemoryMessageMetadata(
	opts: MemoryMessageBackfillOptions = {},
): Promise<MemoryMessageBackfillReport> {
	const now = opts.now ?? new Date();
	const rows = await listMemoryMessageBackfillRows(opts);
	const extracted = rows.map((row) => ({
		row,
		extracted: extractMemoryMessageIdCandidate(row.metadata),
	}));
	const candidateRefs = extracted
		.filter(
			(item): item is { row: MemoryMessageBackfillRow; extracted: ExtractedMessageIdCandidate } =>
				item.extracted.status === 'candidate',
		)
		.map((item) => ({
			workspaceId: item.row.workspaceId,
			messageId: item.extracted.messageId,
		}));
	const existingMessages = await findExistingWorkspaceMessages(candidateRefs);
	const evidenceByWorkspaceMessage = await findUnlockableKnowledgeEvidence(candidateRefs);

	const workspaceSummaries = new Map<string, MemoryMessageBackfillWorkspaceSummary>();
	const contactSummaries = new Map<string, MemoryMessageBackfillContactSummary>();
	const candidates: MemoryMessageBackfillCandidate[] = [];

	const workspaceSummaryFor = (workspaceId: string) => {
		const summary = workspaceSummaries.get(workspaceId) ?? emptyWorkspaceSummary(workspaceId);
		workspaceSummaries.set(workspaceId, summary);
		return summary;
	};
	const contactSummaryFor = (workspaceId: string, contactId: string | null) => {
		const key = `${workspaceId}:${contactId ?? 'none'}`;
		const summary = contactSummaries.get(key) ?? emptyContactSummary(workspaceId, contactId);
		contactSummaries.set(key, summary);
		return summary;
	};

	for (const { row, extracted: candidate } of extracted) {
		const workspaceSummary = workspaceSummaryFor(row.workspaceId);
		const contactSummary = contactSummaryFor(row.workspaceId, row.contactId);

		if (candidate.status !== 'candidate') {
			incrementSummary(workspaceSummary, candidate.status);
			incrementContactSummary(contactSummary, candidate.status);
			continue;
		}

		const workspaceMessageKey = `${row.workspaceId}:${candidate.messageId}`;
		if (!existingMessages.has(workspaceMessageKey)) {
			incrementSummary(workspaceSummary, 'no_matching_message');
			incrementContactSummary(contactSummary, 'no_matching_message');
			continue;
		}

		const unlocks = evidenceByWorkspaceMessage.get(workspaceMessageKey);
		const backfillCandidate: MemoryMessageBackfillCandidate = {
			memoryId: row.id,
			workspaceId: row.workspaceId,
			contactId: row.contactId,
			category: row.category,
			messageId: candidate.messageId,
			sourceKey: candidate.sourceKey,
			estimatedUnlockedEvidenceRows: unlocks?.evidenceRows ?? 0,
			estimatedUnlockedKnowledgeNodes: unlocks?.knowledgeNodeIds.size ?? 0,
		};
		candidates.push(backfillCandidate);
		incrementSummary(workspaceSummary, 'eligible');
		incrementContactSummary(contactSummary, 'eligible');
		workspaceSummary.estimatedUnlockedEvidenceRows +=
			backfillCandidate.estimatedUnlockedEvidenceRows;
		workspaceSummary.estimatedUnlockedKnowledgeNodes +=
			backfillCandidate.estimatedUnlockedKnowledgeNodes;
	}

	let updated = 0;
	if (opts.write === true) {
		for (const candidate of candidates) {
			if (await writeMemoryMessageBackfillCandidate(candidate, now)) {
				updated += 1;
				const workspaceSummary = workspaceSummaryFor(candidate.workspaceId);
				const contactSummary = contactSummaryFor(candidate.workspaceId, candidate.contactId);
				workspaceSummary.updated += 1;
				contactSummary.updated += 1;
			}
		}
	}

	const estimatedUnlockedEvidenceRows = candidates.reduce(
		(sum, candidate) => sum + candidate.estimatedUnlockedEvidenceRows,
		0,
	);
	const estimatedUnlockedKnowledgeNodes = candidates.reduce(
		(sum, candidate) => sum + candidate.estimatedUnlockedKnowledgeNodes,
		0,
	);

	return {
		mode: opts.write === true ? 'write' : 'dry-run',
		workspaceId: opts.workspaceId ?? null,
		totalMemories: rows.length,
		memoriesMissingMessageId:
			rows.length -
			extracted.filter((item) => item.extracted.status === 'already_has_message_id').length,
		eligibleForBackfill: candidates.length,
		skippedAlreadyHasMessageId: extracted.filter(
			(item) => item.extracted.status === 'already_has_message_id',
		).length,
		skippedAmbiguous: [...workspaceSummaries.values()].reduce(
			(sum, summary) => sum + summary.skippedAmbiguous,
			0,
		),
		skippedNoDeterministicSource: [...workspaceSummaries.values()].reduce(
			(sum, summary) => sum + summary.skippedNoDeterministicSource,
			0,
		),
		skippedNoMatchingMessage: [...workspaceSummaries.values()].reduce(
			(sum, summary) => sum + summary.skippedNoMatchingMessage,
			0,
		),
		updated,
		estimatedUnlockedEvidenceRows,
		estimatedUnlockedKnowledgeNodes,
		byWorkspace: [...workspaceSummaries.values()].sort(
			(a, b) => b.eligibleForBackfill - a.eligibleForBackfill,
		),
		byContact: [...contactSummaries.values()].sort(
			(a, b) => b.eligibleForBackfill - a.eligibleForBackfill,
		),
		candidates,
		recommendedNextAction:
			candidates.length > 0 && opts.write !== true
				? 'Review the dry-run output, then run with --write to attach metadata.messageId to deterministic legacy memories.'
				: candidates.length > 0
					? 'Backfill completed. Re-run the dry-run report to verify remaining ambiguous or unmatched memories.'
					: 'No deterministic legacy memories found. Avoid fuzzy contact/time matching unless a reviewed source-message signal is added.',
	};
}
