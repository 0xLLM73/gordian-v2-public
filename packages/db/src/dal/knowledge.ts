import type { SealedEnvelope } from '@repo/crypto';
import { withKeys } from '@repo/crypto';
import { and, eq, sql } from '@repo/db';
import { desc, inArray, isNotNull, isNull } from 'drizzle-orm';
import { db } from '../client';
import { contacts } from '../schema/contacts';
import {
	knowledgeContacts,
	knowledgeEvidence,
	type knowledgeExtractionLog,
	knowledgeLinks,
	knowledgeNodes,
} from '../schema/knowledge';

export type KnowledgeNode = typeof knowledgeNodes.$inferSelect;
export type KnowledgeReviewStatus = 'unreviewed' | 'reviewed' | 'needs_review';
/** KnowledgeNode without embedding or raw metadata — safe for browser responses. */
export type KnowledgeNodePublic = Omit<KnowledgeNode, 'embedding' | 'metadata'> & {
	reviewStatus?: KnowledgeReviewStatus | null;
	reviewedAt?: string | null;
};
/** Vector search result — embedding excluded, DB-computed similarity included. */
export type KnowledgeSearchResult = KnowledgeNodePublic & {
	metadata?: Record<string, unknown> | null;
	similarity: number;
};
export type KnowledgeContact = typeof knowledgeContacts.$inferSelect;
export type KnowledgeEvidence = typeof knowledgeEvidence.$inferSelect;
export type KnowledgeExtractionLogEntry = typeof knowledgeExtractionLog.$inferSelect;

const evidenceRecencyOrder = sql`coalesce(${knowledgeEvidence.occurredAt}, ${knowledgeEvidence.createdAt}) desc`;
export const DEFAULT_KNOWLEDGE_SEARCH_MIN_SIMILARITY = 0.62;
export const DEFAULT_KNOWLEDGE_MESSAGE_RECALL_LIMIT = 30;
export const DEFAULT_KNOWLEDGE_MESSAGE_RECALL_NODE_LIMIT = 20;
export const DEFAULT_KNOWLEDGE_MESSAGE_RECALL_MIN_SCORE = 0.62;

export interface CreateKnowledgeNodeInput {
	type:
		| 'topic'
		| 'project'
		| 'organization'
		| 'technology'
		| 'sector'
		| 'concept'
		| 'rationale'
		| 'decision'
		| 'outcome';
	name: string;
	displayName: string;
	description?: string;
	embedding?: number[];
	metadata?: Record<string, unknown>;
}

export interface UpdateKnowledgeNodeInput {
	type?: CreateKnowledgeNodeInput['type'];
	name?: string;
	displayName?: string;
	description?: string | null;
	embedding?: number[];
	mentionCount?: number;
	lastSeenAt?: Date;
	metadata?: Record<string, unknown> | null;
}

export type KnowledgeEvidenceKind =
	| 'llm_extracted'
	| 'embedding_match'
	| 'contact_cooccurrence'
	| 'manual'
	| 'inferred_weak';

export interface CreateKnowledgeEvidenceInput {
	knowledgeNodeId: string;
	relatedKnowledgeNodeId?: string | null;
	contactId?: string | null;
	messageId?: string | null;
	relationType: string;
	evidenceKind: KnowledgeEvidenceKind;
	confidence?: number | null;
	snippet?: string | null;
	occurredAt?: Date | null;
	metadata?: Record<string, unknown> | null;
}

export interface KnowledgeContactEvidenceInput {
	messageId?: string | null;
	snippet?: string | null;
	occurredAt?: Date | null;
	evidenceKind?: KnowledgeEvidenceKind;
	confidence?: number | null;
	metadata?: Record<string, unknown> | null;
	envelope?: SealedEnvelope;
}

export interface KnowledgeLinkEvidenceInput {
	messageId?: string | null;
	snippet?: string | null;
	occurredAt?: Date | null;
	evidenceKind?: KnowledgeEvidenceKind;
	confidence?: number | null;
	metadata?: Record<string, unknown> | null;
	envelope?: SealedEnvelope;
}

export interface KnowledgeSearchEvidenceItem {
	id: string;
	contactId: string | null;
	messageId: string | null;
	relationType: string;
	evidenceKind: KnowledgeEvidenceKind;
	confidence: number | null;
	snippet: string | null;
	occurredAt: Date | null;
	createdAt: Date;
}

export interface KnowledgeSearchContactItem {
	id: string;
	firstName: string | null;
	lastName: string | null;
	relationType: KnowledgeContact['relationType'];
	strength: number;
	evidenceCount: number;
	lastEvidenceAt: Date;
	evidence: KnowledgeSearchEvidenceItem[];
}

export interface KnowledgeSearchResultWithEvidence {
	node: KnowledgeNodePublic;
	similarity: number | null;
	matchScore: number;
	matchReasons: string[];
	exactMatch: boolean;
	aliasMatch: boolean;
	messageRecallScore: number | null;
	messageHitCount: number;
	messageMatchedEvidenceIds: string[];
	messageMatchedAt: Date | null;
	messageRecallReasons: string[];
	evidenceCount: number;
	aggregateEvidenceCount: number;
	latestEvidenceAt: Date | null;
	topConfidence: number | null;
	connectedContactCount: number;
	connectedContactsWithEvidence: number;
	contacts: KnowledgeSearchContactItem[];
	evidence: KnowledgeSearchEvidenceItem[];
}

export interface SearchKnowledgeNodesWithEvidenceOptions {
	type?: ListKnowledgeNodesOptions['type'];
	limit?: number;
	minSimilarity?: number;
	messageRecallQueryText?: string;
	messageRecallLimit?: number;
	messageRecallNodeLimit?: number;
	minMessageRecallScore?: number;
	evidenceLimitPerNode?: number;
	contactLimitPerNode?: number;
}

export interface LegacyKnowledgeEvidenceWorkspaceSummary {
	workspaceId: string;
	totalKnowledgeContactRows: number;
	rowsWithoutEvidence: number;
}

export interface LegacyKnowledgeEvidenceNodeTypeSummary {
	nodeType: string;
	totalKnowledgeContactRows: number;
	rowsWithoutEvidence: number;
}

export interface LegacyKnowledgeEvidenceNodeGap {
	workspaceId: string;
	nodeId: string;
	nodeType: string;
	rowsWithoutEvidence: number;
	aggregateEvidenceCount: number;
	latestLegacyEvidenceAt: Date | null;
}

export interface LegacyKnowledgeEvidenceContactGap {
	workspaceId: string;
	contactId: string;
	rowsWithoutEvidence: number;
	aggregateEvidenceCount: number;
	latestLegacyEvidenceAt: Date | null;
}

export interface LegacyKnowledgeEvidenceReport {
	totalKnowledgeContactRows: number;
	rowsWithoutEvidence: number;
	byWorkspace: LegacyKnowledgeEvidenceWorkspaceSummary[];
	byNodeType: LegacyKnowledgeEvidenceNodeTypeSummary[];
	topNodesMissingEvidence: LegacyKnowledgeEvidenceNodeGap[];
	topContactsMissingEvidence: LegacyKnowledgeEvidenceContactGap[];
	recommendedNextAction: string;
}

export interface KnowledgeAnalysisContactCandidate {
	id: string;
	messageCount: number;
	earliestMessageAt: Date | null;
	latestMessageAt: Date | null;
	messageHorizon: Date | null;
	backfillOldestMessageAt: Date | null;
	backfillOldestMessageId: string | null;
	backfillMessagesScanned: number;
	backfillCompletedAt: Date | null;
	stale: boolean;
}

export interface KnowledgeNodeEvidenceStats {
	nodeId: string;
	evidenceRows: number;
	distinctEvidenceContacts: number;
	distinctEvidenceMessages: number;
	linkedContacts: number;
	aggregateLinkEvidenceCount: number;
	maxLinkEvidenceCount: number;
}

export interface RepairKnowledgeEvidenceCountsResult {
	workspaceId: string;
	duplicateEvidenceRowsDeleted: number;
	contactLinksRecomputed: number;
	nodesRecomputed: number;
}

/** Column selection that excludes `embedding` — use for all browser-facing queries. */
const knowledgeNodeColumns = {
	id: knowledgeNodes.id,
	workspaceId: knowledgeNodes.workspaceId,
	type: knowledgeNodes.type,
	name: knowledgeNodes.name,
	displayName: knowledgeNodes.displayName,
	description: knowledgeNodes.description,
	nameBlindIndex: knowledgeNodes.nameBlindIndex,
	aliases: knowledgeNodes.aliases,
	mentionCount: knowledgeNodes.mentionCount,
	firstSeenAt: knowledgeNodes.firstSeenAt,
	lastSeenAt: knowledgeNodes.lastSeenAt,
	reviewStatus:
		sql<KnowledgeReviewStatus | null>`${knowledgeNodes.metadata}->'review'->>'status'`.as(
			'reviewStatus',
		),
	reviewedAt: sql<string | null>`${knowledgeNodes.metadata}->'review'->>'reviewedAt'`.as(
		'reviewedAt',
	),
	createdAt: knowledgeNodes.createdAt,
};

const KNOWLEDGE_SEARCH_PREFIX_PATTERNS = [
	/^who\s+(?:has\s+)?(?:talked|spoke|chatted)\s+about\s+/i,
	/^who\s+(?:has\s+)?mentioned\s+/i,
	/^who\s+(?:is\s+)?(?:interested\s+in|working\s+on|using|building)\s+/i,
	/^people\s+(?:who\s+are\s+)?(?:interested\s+in|working\s+on|using|building)\s+/i,
	/^people\s+(?:who\s+)?(?:talked\s+about|mentioned|know\s+about)\s+/i,
	/^contacts\s+(?:who\s+are\s+)?(?:interested\s+in|working\s+on|using|building)\s+/i,
	/^contacts\s+(?:who\s+)?(?:talked\s+about|mentioned|know\s+about)\s+/i,
	/^show\s+me\s+(?:people|contacts)\s+(?:who\s+)?(?:talked\s+about|mentioned|interested\s+in)\s+/i,
	/^find\s+(?:people|contacts)\s+(?:who\s+)?(?:talked\s+about|mentioned|interested\s+in)\s+/i,
];

export function normalizeKnowledgeSearchQuery(query: string): string {
	let normalized = query
		.replace(/[?!.]+$/g, '')
		.replace(/\s+/g, ' ')
		.trim();

	for (const pattern of KNOWLEDGE_SEARCH_PREFIX_PATTERNS) {
		normalized = normalized.replace(pattern, '').trim();
	}

	return normalized.replace(/[?!.]+$/g, '').trim();
}

/**
 * KG-1: Wrap a query in a transaction with iterative HNSW scanning enabled.
 * Uses SET LOCAL (transaction-scoped) — the setting resets at COMMIT and
 * never leaks to connection pool neighbors.
 *
 * Prevents HNSW overfiltering in multi-tenant queries: without this, the index
 * finds N globally nearest vectors first, THEN applies WHERE workspace_id = ?,
 * discarding results from other workspaces and degrading recall.
 *
 * Requires pgvector 0.8.0+ (confirmed available).
 */
async function withIterativeScan<T>(fn: (tx: typeof db) => Promise<T>): Promise<T> {
	return db.transaction(async (tx) => {
		await tx.execute(sql`SET LOCAL hnsw.iterative_scan = relaxed_order`);
		return fn(tx as unknown as typeof db);
	});
}

export interface ListKnowledgeNodesOptions {
	type?:
		| 'topic'
		| 'project'
		| 'organization'
		| 'technology'
		| 'sector'
		| 'concept'
		| 'rationale'
		| 'decision'
		| 'outcome';
	limit?: number;
	offset?: number;
}

export async function createKnowledgeNode(
	workspaceId: string,
	data: CreateKnowledgeNodeInput,
	envelope: SealedEnvelope,
): Promise<KnowledgeNode> {
	return withKeys(envelope, async () => {
		const result = await db
			.insert(knowledgeNodes)
			.values({
				workspaceId,
				type: data.type,
				name: data.name.toLowerCase(),
				nameBlindIndex: data.name.toLowerCase(),
				displayName: data.displayName,
				description: data.description,
				embedding: data.embedding,
				metadata: data.metadata,
			})
			.onConflictDoUpdate({
				target: [knowledgeNodes.workspaceId, knowledgeNodes.nameBlindIndex, knowledgeNodes.type],
				set: {
					mentionCount: sql`${knowledgeNodes.mentionCount} + 1`,
					lastSeenAt: sql`now()`,
				},
			})
			.returning();
		const row = result[0];
		if (!row) throw new Error('createKnowledgeNode: insert returned no rows');
		return row;
	});
}

export async function updateKnowledgeNode(
	workspaceId: string,
	id: string,
	data: UpdateKnowledgeNodeInput,
	envelope: SealedEnvelope,
): Promise<KnowledgeNode | null> {
	return withKeys(envelope, async () => {
		const updates: Record<string, unknown> = {};
		if (data.type !== undefined) updates.type = data.type;
		if (data.name !== undefined) {
			const normalizedName = data.name.toLowerCase();
			updates.name = normalizedName;
			updates.nameBlindIndex = normalizedName;
		}
		if (data.displayName !== undefined) updates.displayName = data.displayName;
		if (data.description !== undefined) updates.description = data.description;
		if (data.embedding !== undefined) updates.embedding = data.embedding;
		if (data.mentionCount !== undefined) updates.mentionCount = data.mentionCount;
		if (data.lastSeenAt !== undefined) updates.lastSeenAt = data.lastSeenAt;
		if (data.metadata !== undefined) updates.metadata = data.metadata;

		const result = await db
			.update(knowledgeNodes)
			.set(updates)
			.where(and(eq(knowledgeNodes.id, id), eq(knowledgeNodes.workspaceId, workspaceId)))
			.returning();
		return result[0] ?? null;
	});
}

/** Atomically increment mentionCount and bump lastSeenAt when a node is reused. */
export async function incrementNodeMentionCount(
	workspaceId: string,
	nodeId: string,
): Promise<void> {
	await db
		.update(knowledgeNodes)
		.set({
			mentionCount: sql`${knowledgeNodes.mentionCount} + 1`,
			lastSeenAt: sql`now()`,
		})
		.where(and(eq(knowledgeNodes.id, nodeId), eq(knowledgeNodes.workspaceId, workspaceId)));
}

export async function getKnowledgeNode(
	workspaceId: string,
	id: string,
	envelope?: SealedEnvelope,
): Promise<KnowledgeNode | null> {
	const doQuery = async () => {
		const result = await db
			.select()
			.from(knowledgeNodes)
			.where(and(eq(knowledgeNodes.id, id), eq(knowledgeNodes.workspaceId, workspaceId)))
			.limit(1);
		return result[0] ?? null;
	};
	return envelope ? withKeys(envelope, doQuery) : doQuery();
}

export async function listKnowledgeNodes(
	workspaceId: string,
	opts?: ListKnowledgeNodesOptions,
	envelope?: SealedEnvelope,
): Promise<KnowledgeNodePublic[]> {
	const limit = opts?.limit ?? 50;
	const offset = opts?.offset ?? 0;
	const conditions = [eq(knowledgeNodes.workspaceId, workspaceId)];

	if (opts?.type) {
		conditions.push(
			eq(knowledgeNodes.type, opts.type as (typeof knowledgeNodes.type.enumValues)[number]),
		);
	}

	const doQuery = async () =>
		db
			.select(knowledgeNodeColumns)
			.from(knowledgeNodes)
			.where(and(...conditions))
			.orderBy(sql`${knowledgeNodes.mentionCount} desc`)
			.limit(limit)
			.offset(offset);

	return envelope ? withKeys(envelope, doQuery) : doQuery();
}

export async function getKnowledgeNodeEvidenceStats(
	workspaceId: string,
	nodeIds: string[],
): Promise<Map<string, KnowledgeNodeEvidenceStats>> {
	if (nodeIds.length === 0) return new Map();

	const [evidenceRows, contactRows] = await Promise.all([
		db
			.select({
				nodeId: knowledgeEvidence.knowledgeNodeId,
				evidenceRows: sql<number>`count(*)::int`,
				distinctEvidenceContacts: sql<number>`count(DISTINCT ${knowledgeEvidence.contactId}) FILTER (WHERE ${knowledgeEvidence.contactId} IS NOT NULL)::int`,
				distinctEvidenceMessages: sql<number>`count(DISTINCT ${knowledgeEvidence.messageId}) FILTER (WHERE ${knowledgeEvidence.messageId} IS NOT NULL)::int`,
			})
			.from(knowledgeEvidence)
			.where(
				and(
					eq(knowledgeEvidence.workspaceId, workspaceId),
					inArray(knowledgeEvidence.knowledgeNodeId, nodeIds),
				),
			)
			.groupBy(knowledgeEvidence.knowledgeNodeId),
		db
			.select({
				nodeId: knowledgeContacts.knowledgeNodeId,
				linkedContacts: sql<number>`count(*)::int`,
				aggregateLinkEvidenceCount: sql<number>`coalesce(sum(${knowledgeContacts.evidenceCount}), 0)::int`,
				maxLinkEvidenceCount: sql<number>`coalesce(max(${knowledgeContacts.evidenceCount}), 0)::int`,
			})
			.from(knowledgeContacts)
			.where(
				and(
					eq(knowledgeContacts.workspaceId, workspaceId),
					inArray(knowledgeContacts.knowledgeNodeId, nodeIds),
				),
			)
			.groupBy(knowledgeContacts.knowledgeNodeId),
	]);

	const stats = new Map<string, KnowledgeNodeEvidenceStats>();
	for (const nodeId of nodeIds) {
		stats.set(nodeId, {
			nodeId,
			evidenceRows: 0,
			distinctEvidenceContacts: 0,
			distinctEvidenceMessages: 0,
			linkedContacts: 0,
			aggregateLinkEvidenceCount: 0,
			maxLinkEvidenceCount: 0,
		});
	}
	for (const row of evidenceRows) {
		const current = stats.get(row.nodeId);
		if (!current) continue;
		current.evidenceRows = Number(row.evidenceRows ?? 0);
		current.distinctEvidenceContacts = Number(row.distinctEvidenceContacts ?? 0);
		current.distinctEvidenceMessages = Number(row.distinctEvidenceMessages ?? 0);
	}
	for (const row of contactRows) {
		const current = stats.get(row.nodeId);
		if (!current) continue;
		current.linkedContacts = Number(row.linkedContacts ?? 0);
		current.aggregateLinkEvidenceCount = Number(row.aggregateLinkEvidenceCount ?? 0);
		current.maxLinkEvidenceCount = Number(row.maxLinkEvidenceCount ?? 0);
	}

	return stats;
}

/**
 * Search knowledge nodes by blind index exact match and/or embedding (cosine similarity).
 *
 * SEC-ENC-101: ILIKE replaced with blind index. Encrypted columns cannot support
 * substring search — blind index provides exact match only. Embedding similarity
 * provides fuzzy matching as a fallback. This is a functional tradeoff:
 * substring text search on entity names is lost in exchange for encryption.
 *
 * When embedding is provided, ranks by vector distance (closest first).
 * When query string is provided, filters by blind index exact match on name.
 * When both are provided, tries blind index first, falls back to embedding-only.
 */
export async function searchKnowledgeNodes(
	workspaceId: string,
	query: string,
	embedding?: number[],
	envelope?: SealedEnvelope,
): Promise<KnowledgeSearchResult[]> {
	if (embedding && embedding.length > 0) {
		// SEC-ENC-515: Use Drizzle ORM (not raw SQL) so encryptedText.fromDriver() decrypts
		// SEC-ENC-101: No ILIKE filter — encrypted name cannot be pattern-matched
		// KG-1: withIterativeScan prevents HNSW overfiltering in multi-tenant queries
		const embeddingStr = `[${embedding.join(',')}]`;
		return withIterativeScan(async (tx) => {
			const doQuery = async () =>
				tx
					.select({
						...knowledgeNodeColumns,
						metadata: knowledgeNodes.metadata,
						similarity: sql<number>`1 - (${knowledgeNodes.embedding} <=> ${embeddingStr}::halfvec(512))`,
					})
					.from(knowledgeNodes)
					.where(
						and(eq(knowledgeNodes.workspaceId, workspaceId), isNotNull(knowledgeNodes.embedding)),
					)
					.orderBy(sql`${knowledgeNodes.embedding} <=> ${embeddingStr}::halfvec(512)`)
					.limit(20);

			return (envelope ? withKeys(envelope, doQuery) : doQuery()) as Promise<
				KnowledgeSearchResult[]
			>;
		});
	}

	if (query && envelope) {
		// Blind index exact match on name — SEC-ENC-101
		return withKeys(envelope, async () => {
			const rows = await db
				.select(knowledgeNodeColumns)
				.from(knowledgeNodes)
				.where(
					and(
						eq(knowledgeNodes.workspaceId, workspaceId),
						eq(knowledgeNodes.nameBlindIndex, query.toLowerCase()),
					),
				)
				.orderBy(sql`${knowledgeNodes.mentionCount} desc`)
				.limit(20);
			return rows as KnowledgeSearchResult[];
		});
	}

	return listKnowledgeNodes(workspaceId, { limit: 20 }, envelope) as Promise<
		KnowledgeSearchResult[]
	>;
}

interface KnowledgeSearchCandidate {
	node: KnowledgeNodePublic;
	similarity: number | null;
	exactMatch: boolean;
	aliasMatch: boolean;
	matchReasons: Set<string>;
	messageRecallScore: number | null;
	messageHitCount: number;
	messageMatchedEvidenceIds: Set<string>;
	messageMatchedAt: Date | null;
	messageRecallReasons: Set<string>;
}

interface KnowledgeMessageRecallHit {
	memoryId: string;
	messageId: string;
	content: string | null;
	category: string;
	rrfScore: number;
	semanticScore: number;
	ftsRank: number;
	contactId: string | null;
	memoryCreatedAt: Date | null;
}

interface KnowledgeMessageRecallEvidenceRow {
	node: KnowledgeNodePublic;
	evidenceId: string;
	messageId: string;
	occurredAt: Date | null;
	createdAt: Date;
	memoryHit: KnowledgeMessageRecallHit;
}

async function findExactKnowledgeNodes(
	workspaceId: string,
	normalizedQuery: string,
	envelope: SealedEnvelope,
	opts: Pick<SearchKnowledgeNodesWithEvidenceOptions, 'type' | 'limit'>,
): Promise<KnowledgeNodePublic[]> {
	if (!normalizedQuery) return [];

	return withKeys(envelope, async () => {
		const conditions = [
			eq(knowledgeNodes.workspaceId, workspaceId),
			eq(knowledgeNodes.nameBlindIndex, normalizedQuery.toLowerCase()),
		];
		if (opts.type) {
			conditions.push(
				eq(knowledgeNodes.type, opts.type as (typeof knowledgeNodes.type.enumValues)[number]),
			);
		}

		return await db
			.select(knowledgeNodeColumns)
			.from(knowledgeNodes)
			.where(and(...conditions))
			.orderBy(desc(knowledgeNodes.mentionCount))
			.limit(opts.limit ?? 20);
	});
}

async function findAliasKnowledgeNodes(
	workspaceId: string,
	normalizedQuery: string,
	envelope: SealedEnvelope,
	opts: Pick<SearchKnowledgeNodesWithEvidenceOptions, 'type' | 'limit'>,
): Promise<KnowledgeNodePublic[]> {
	if (!normalizedQuery) return [];

	return withKeys(envelope, async () => {
		const conditions = [
			eq(knowledgeNodes.workspaceId, workspaceId),
			sql`${normalizedQuery.toLowerCase()} = ANY(${knowledgeNodes.aliases})`,
		];
		if (opts.type) {
			conditions.push(
				eq(knowledgeNodes.type, opts.type as (typeof knowledgeNodes.type.enumValues)[number]),
			);
		}

		return await db
			.select(knowledgeNodeColumns)
			.from(knowledgeNodes)
			.where(and(...conditions))
			.orderBy(desc(knowledgeNodes.mentionCount))
			.limit(opts.limit ?? 20);
	});
}

function addKnowledgeSearchCandidate(
	candidates: Map<string, KnowledgeSearchCandidate>,
	node: KnowledgeNodePublic,
	reason: string,
	opts?: { similarity?: number | null; exactMatch?: boolean; aliasMatch?: boolean },
) {
	const existing = candidates.get(node.id);
	if (existing) {
		existing.matchReasons.add(reason);
		existing.exactMatch = existing.exactMatch || opts?.exactMatch === true;
		existing.aliasMatch = existing.aliasMatch || opts?.aliasMatch === true;
		if (typeof opts?.similarity === 'number') {
			existing.similarity =
				typeof existing.similarity === 'number'
					? Math.max(existing.similarity, opts.similarity)
					: opts.similarity;
		}
		return;
	}

	candidates.set(node.id, {
		node,
		similarity: opts?.similarity ?? null,
		exactMatch: opts?.exactMatch === true,
		aliasMatch: opts?.aliasMatch === true,
		matchReasons: new Set([reason]),
		messageRecallScore: null,
		messageHitCount: 0,
		messageMatchedEvidenceIds: new Set(),
		messageMatchedAt: null,
		messageRecallReasons: new Set(),
	});
}

function compareOptionalDates(a?: Date | null, b?: Date | null): number {
	const aTime = a?.getTime() ?? 0;
	const bTime = b?.getTime() ?? 0;
	return bTime - aTime;
}

function bestOptionalDate(a?: Date | null, b?: Date | null): Date | null {
	if (!a) return b ?? null;
	if (!b) return a;
	return a.getTime() >= b.getTime() ? a : b;
}

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

function toReportNumber(value: unknown): number {
	if (typeof value === 'number') return value;
	if (typeof value === 'bigint') return Number(value);
	if (typeof value === 'string') return Number.parseInt(value, 10) || 0;
	return 0;
}

function toReportDate(value: unknown): Date | null {
	if (value instanceof Date) return value;
	if (typeof value === 'string' && value.length > 0) {
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? null : date;
	}
	return null;
}

function toReportString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizeMemoryRecallScore(hit: KnowledgeMessageRecallHit): number {
	const semanticScore = Number.isFinite(hit.semanticScore) ? hit.semanticScore : 0;
	const ftsScore = hit.ftsRank > 0 ? Math.min(0.95, 0.72 + Math.min(hit.ftsRank, 1) * 0.2) : 0;
	const rrfScore = Number.isFinite(hit.rrfScore) ? Math.min(0.88, hit.rrfScore * 10) : 0;
	return Math.max(semanticScore, ftsScore, rrfScore);
}

function isConfidentMemoryRecallHit(
	hit: KnowledgeMessageRecallHit,
	minMessageRecallScore: number,
): boolean {
	return hit.ftsRank > 0 || normalizeMemoryRecallScore(hit) >= minMessageRecallScore;
}

function mapMemoryRecallRows(rows: Array<Record<string, unknown>>): KnowledgeMessageRecallHit[] {
	return rows
		.map((row) => ({
			memoryId: toReportString(row.memoryId ?? row.memory_id ?? row.id) ?? '',
			messageId: toReportString(row.messageId ?? row.message_id) ?? '',
			content: toReportString(row.content),
			category: toReportString(row.category) ?? 'general',
			rrfScore: Number(row.rrfScore ?? row.rrf_score ?? 0),
			semanticScore: Number(row.semanticScore ?? row.semantic_score ?? 0),
			ftsRank: Number(row.ftsRank ?? row.fts_rank ?? 0),
			contactId: toReportString(row.contactId ?? row.contact_id),
			memoryCreatedAt: toReportDate(row.memoryCreatedAt ?? row.memory_created_at),
		}))
		.filter((row) => row.memoryId && row.messageId);
}

async function searchMessageLinkedMemoriesForKnowledgeRecall(
	workspaceId: string,
	queryText: string,
	queryEmbedding: number[] | undefined,
	opts: { limit: number; minMessageRecallScore: number },
): Promise<KnowledgeMessageRecallHit[]> {
	const normalizedQuery = queryText.trim();
	if (!normalizedQuery) return [];

	const messageIdExpr = sql`
		coalesce(
			m.metadata->>'messageId',
			m.metadata->>'message_id',
			m.metadata->>'sourceMessageId',
			m.metadata->>'source_message_id'
		)
	`;

	const messageIdCase = sql`
		CASE
			WHEN ${messageIdExpr} ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
			THEN ${messageIdExpr}
			ELSE NULL
		END
	`;

	const result =
		queryEmbedding && queryEmbedding.length > 0
			? await db.execute(sql`
				WITH hits AS (
					SELECT
						id,
						category,
						rrf_score,
						semantic_score,
						fts_rank
					FROM hybrid_search(
						${workspaceId}::uuid,
						${`[${queryEmbedding.join(',')}]`}::halfvec(512),
						${normalizedQuery},
						NULL::memory_category,
						${opts.limit}
					)
				)
					SELECT
						h.id::text AS "memoryId",
						${messageIdCase} AS "messageId",
						NULL::text AS content,
					h.category::text AS category,
					h.rrf_score::float AS "rrfScore",
					h.semantic_score::float AS "semanticScore",
					h.fts_rank::float AS "ftsRank",
					m.contact_id::text AS "contactId",
					m.created_at AS "memoryCreatedAt"
				FROM hits h
				INNER JOIN memories m
					ON m.id = h.id
					AND m.category = h.category
					AND m.workspace_id = ${workspaceId}::uuid
				WHERE ${messageIdCase} IS NOT NULL
				ORDER BY h.rrf_score DESC
				LIMIT ${opts.limit}
			`)
			: await db.execute(sql`
				SELECT
					m.id::text AS "memoryId",
					${messageIdCase} AS "messageId",
					m.content_sanitized AS content,
					m.category::text AS category,
					ts_rank(
						to_tsvector('english', m.content_sanitized),
						plainto_tsquery('english', ${normalizedQuery})
					)::float AS "rrfScore",
					0::float AS "semanticScore",
					ts_rank(
						to_tsvector('english', m.content_sanitized),
						plainto_tsquery('english', ${normalizedQuery})
					)::float AS "ftsRank",
					m.contact_id::text AS "contactId",
					m.created_at AS "memoryCreatedAt"
				FROM memories m
				WHERE m.workspace_id = ${workspaceId}::uuid
					AND m.content_sanitized IS NOT NULL
					AND ${messageIdCase} IS NOT NULL
					AND to_tsvector('english', m.content_sanitized) @@ plainto_tsquery('english', ${normalizedQuery})
				ORDER BY "ftsRank" DESC
				LIMIT ${opts.limit}
			`);

	return mapMemoryRecallRows(rowsFromExecute<Record<string, unknown>>(result)).filter((hit) =>
		isConfidentMemoryRecallHit(hit, opts.minMessageRecallScore),
	);
}

function addMessageRecallToCandidate(
	candidate: KnowledgeSearchCandidate,
	row: KnowledgeMessageRecallEvidenceRow,
) {
	const score = normalizeMemoryRecallScore(row.memoryHit);
	candidate.messageRecallScore =
		typeof candidate.messageRecallScore === 'number'
			? Math.max(candidate.messageRecallScore, score)
			: score;
	candidate.messageMatchedEvidenceIds.add(row.evidenceId);
	candidate.messageHitCount = candidate.messageMatchedEvidenceIds.size;
	candidate.messageMatchedAt = bestOptionalDate(
		candidate.messageMatchedAt,
		row.occurredAt ?? row.memoryHit.memoryCreatedAt ?? row.createdAt,
	);
	candidate.matchReasons.add('evidence_message_match');
	candidate.messageRecallReasons.add('evidence_message_match');
	if (row.memoryHit.ftsRank > 0) candidate.messageRecallReasons.add('memory_full_text');
	if (row.memoryHit.semanticScore > 0) candidate.messageRecallReasons.add('memory_semantic');
}

function computeKnowledgeSearchScore(input: {
	candidate: KnowledgeSearchCandidate;
	evidenceCount: number;
	topConfidence: number | null;
	connectedContactsWithEvidence: number;
	latestEvidenceAt: Date | null;
}): number {
	const {
		candidate,
		evidenceCount,
		topConfidence,
		connectedContactsWithEvidence,
		latestEvidenceAt,
	} = input;

	if (candidate.exactMatch) return 1;
	if (candidate.aliasMatch) return 0.96;

	let score = Math.max(0, candidate.similarity ?? 0) * 0.78;
	score += Math.min(evidenceCount, 20) * 0.006;
	score += Math.min(connectedContactsWithEvidence, 5) * 0.018;
	if (typeof topConfidence === 'number') score += topConfidence * 0.07;

	if (latestEvidenceAt) {
		const ageDays = Math.max(0, (Date.now() - latestEvidenceAt.getTime()) / 86_400_000);
		if (ageDays <= 30) score += 0.04;
		else if (ageDays <= 180) score += 0.02;
	}

	// Ranking remains intentionally inspectable: node recall establishes the
	// anchor, then exact mapped message evidence adds a bounded recall boost.
	if (typeof candidate.messageRecallScore === 'number') {
		score += Math.min(candidate.messageRecallScore, 1) * 0.16;
		score += Math.min(candidate.messageHitCount, 5) * 0.025;
	}

	return Math.min(1, Number(score.toFixed(4)));
}

export async function searchKnowledgeNodesWithEvidence(
	workspaceId: string,
	query: string,
	embedding: number[] | undefined,
	envelope: SealedEnvelope,
	opts?: SearchKnowledgeNodesWithEvidenceOptions,
): Promise<KnowledgeSearchResultWithEvidence[]> {
	const normalizedQuery = normalizeKnowledgeSearchQuery(query);
	if (!normalizedQuery) return [];

	const limit = opts?.limit ?? 20;
	const minSimilarity = opts?.minSimilarity ?? DEFAULT_KNOWLEDGE_SEARCH_MIN_SIMILARITY;
	const messageRecallLimit = opts?.messageRecallLimit ?? DEFAULT_KNOWLEDGE_MESSAGE_RECALL_LIMIT;
	const messageRecallNodeLimit =
		opts?.messageRecallNodeLimit ?? DEFAULT_KNOWLEDGE_MESSAGE_RECALL_NODE_LIMIT;
	const minMessageRecallScore =
		opts?.minMessageRecallScore ?? DEFAULT_KNOWLEDGE_MESSAGE_RECALL_MIN_SCORE;
	const evidenceLimitPerNode = opts?.evidenceLimitPerNode ?? 3;
	const contactLimitPerNode = opts?.contactLimitPerNode ?? 3;
	const candidates = new Map<string, KnowledgeSearchCandidate>();

	const [exactNodes, aliasNodes] = await Promise.all([
		findExactKnowledgeNodes(workspaceId, normalizedQuery, envelope, { type: opts?.type, limit }),
		findAliasKnowledgeNodes(workspaceId, normalizedQuery, envelope, { type: opts?.type, limit }),
	]);

	for (const node of exactNodes) {
		addKnowledgeSearchCandidate(candidates, node, 'exact name', { exactMatch: true });
	}
	for (const node of aliasNodes) {
		addKnowledgeSearchCandidate(candidates, node, 'alias', { aliasMatch: true });
	}

	if (embedding && embedding.length > 0) {
		const semanticMatches = await searchKnowledgeNodes(
			workspaceId,
			normalizedQuery,
			embedding,
			envelope,
		);
		for (const node of semanticMatches) {
			if (opts?.type && node.type !== opts.type) continue;
			const similarity = node.similarity ?? 0;
			const alreadyExact = candidates.has(node.id);
			if (!alreadyExact && similarity < minSimilarity) continue;
			addKnowledgeSearchCandidate(candidates, node, 'semantic similarity', { similarity });
		}
	}

	if (opts?.messageRecallQueryText) {
		const memoryHits = await searchMessageLinkedMemoriesForKnowledgeRecall(
			workspaceId,
			opts.messageRecallQueryText,
			embedding,
			{ limit: messageRecallLimit, minMessageRecallScore },
		);
		const messageIds = [...new Set(memoryHits.map((hit) => hit.messageId))].slice(
			0,
			messageRecallLimit,
		);

		if (messageIds.length > 0) {
			const bestHitByMessageId = new Map<string, KnowledgeMessageRecallHit>();
			for (const hit of memoryHits) {
				const existing = bestHitByMessageId.get(hit.messageId);
				if (!existing || normalizeMemoryRecallScore(hit) > normalizeMemoryRecallScore(existing)) {
					bestHitByMessageId.set(hit.messageId, hit);
				}
			}

			const recallRows = await withKeys(envelope, async () => {
				const conditions = [
					eq(knowledgeEvidence.workspaceId, workspaceId),
					inArray(knowledgeEvidence.messageId, messageIds),
				];
				if (opts?.type) {
					conditions.push(
						eq(knowledgeNodes.type, opts.type as (typeof knowledgeNodes.type.enumValues)[number]),
					);
				}

				return db
					.select({
						nodeId: knowledgeNodes.id,
						workspaceId: knowledgeNodes.workspaceId,
						type: knowledgeNodes.type,
						name: knowledgeNodes.name,
						displayName: knowledgeNodes.displayName,
						description: knowledgeNodes.description,
						nameBlindIndex: knowledgeNodes.nameBlindIndex,
						aliases: knowledgeNodes.aliases,
						mentionCount: knowledgeNodes.mentionCount,
						firstSeenAt: knowledgeNodes.firstSeenAt,
						lastSeenAt: knowledgeNodes.lastSeenAt,
						createdAt: knowledgeNodes.createdAt,
						evidenceId: knowledgeEvidence.id,
						messageId: knowledgeEvidence.messageId,
						evidenceOccurredAt: knowledgeEvidence.occurredAt,
						evidenceCreatedAt: knowledgeEvidence.createdAt,
					})
					.from(knowledgeEvidence)
					.innerJoin(
						knowledgeNodes,
						and(
							eq(knowledgeEvidence.knowledgeNodeId, knowledgeNodes.id),
							eq(knowledgeNodes.workspaceId, workspaceId),
						),
					)
					.where(and(...conditions))
					.orderBy(evidenceRecencyOrder, desc(knowledgeEvidence.createdAt))
					.limit(messageRecallNodeLimit);
			});

			for (const row of recallRows) {
				if (!row.messageId) continue;
				const memoryHit = bestHitByMessageId.get(row.messageId);
				if (!memoryHit) continue;
				const node: KnowledgeNodePublic = {
					id: row.nodeId,
					workspaceId: row.workspaceId,
					type: row.type,
					name: row.name,
					displayName: row.displayName,
					description: row.description,
					nameBlindIndex: row.nameBlindIndex,
					aliases: row.aliases,
					mentionCount: row.mentionCount,
					firstSeenAt: row.firstSeenAt,
					lastSeenAt: row.lastSeenAt,
					createdAt: row.createdAt,
				};
				addKnowledgeSearchCandidate(candidates, node, 'evidence_message_match');
				const candidate = candidates.get(row.nodeId);
				if (!candidate) continue;
				addMessageRecallToCandidate(candidate, {
					node,
					evidenceId: row.evidenceId,
					messageId: row.messageId,
					occurredAt: row.evidenceOccurredAt,
					createdAt: row.evidenceCreatedAt,
					memoryHit,
				});
			}
		}
	}

	const candidateList = [...candidates.values()].slice(0, Math.max(limit, messageRecallNodeLimit));
	if (candidateList.length === 0) return [];

	const nodeIds = candidateList.map((candidate) => candidate.node.id);

	const { contactRows, evidenceRows } = await withKeys(envelope, async () => {
		const [contactsForNodes, evidenceForNodes] = await Promise.all([
			db
				.select({
					nodeId: knowledgeContacts.knowledgeNodeId,
					contactId: contacts.id,
					firstName: contacts.firstName,
					lastName: contacts.lastName,
					relationType: knowledgeContacts.relationType,
					strength: knowledgeContacts.strength,
					evidenceCount: knowledgeContacts.evidenceCount,
					lastEvidenceAt: knowledgeContacts.lastEvidenceAt,
				})
				.from(knowledgeContacts)
				.innerJoin(
					contacts,
					and(eq(knowledgeContacts.contactId, contacts.id), eq(contacts.workspaceId, workspaceId)),
				)
				.where(
					and(
						eq(knowledgeContacts.workspaceId, workspaceId),
						inArray(knowledgeContacts.knowledgeNodeId, nodeIds),
					),
				)
				.orderBy(desc(knowledgeContacts.evidenceCount), desc(knowledgeContacts.lastEvidenceAt)),
			db
				.select({
					id: knowledgeEvidence.id,
					knowledgeNodeId: knowledgeEvidence.knowledgeNodeId,
					contactId: knowledgeEvidence.contactId,
					messageId: knowledgeEvidence.messageId,
					relationType: knowledgeEvidence.relationType,
					evidenceKind: knowledgeEvidence.evidenceKind,
					confidence: knowledgeEvidence.confidence,
					snippet: knowledgeEvidence.snippet,
					occurredAt: knowledgeEvidence.occurredAt,
					createdAt: knowledgeEvidence.createdAt,
				})
				.from(knowledgeEvidence)
				.where(
					and(
						eq(knowledgeEvidence.workspaceId, workspaceId),
						inArray(knowledgeEvidence.knowledgeNodeId, nodeIds),
					),
				)
				.orderBy(evidenceRecencyOrder, desc(knowledgeEvidence.createdAt)),
		]);

		return { contactRows: contactsForNodes, evidenceRows: evidenceForNodes };
	});

	const contactsByNode = new Map<string, typeof contactRows>();
	for (const row of contactRows) {
		const rows = contactsByNode.get(row.nodeId) ?? [];
		rows.push(row);
		contactsByNode.set(row.nodeId, rows);
	}

	const evidenceByNode = new Map<string, typeof evidenceRows>();
	const evidenceByContact = new Map<string, typeof evidenceRows>();
	for (const row of evidenceRows) {
		const rows = evidenceByNode.get(row.knowledgeNodeId) ?? [];
		rows.push(row);
		evidenceByNode.set(row.knowledgeNodeId, rows);

		if (row.contactId) {
			const key = `${row.knowledgeNodeId}:${row.contactId}:${row.relationType}`;
			const contactEvidence = evidenceByContact.get(key) ?? [];
			contactEvidence.push(row);
			evidenceByContact.set(key, contactEvidence);
		}
	}

	const results = candidateList.map((candidate): KnowledgeSearchResultWithEvidence => {
		const nodeEvidence = evidenceByNode.get(candidate.node.id) ?? [];
		const matchedEvidenceIds = candidate.messageMatchedEvidenceIds;
		const rankedNodeEvidence =
			matchedEvidenceIds.size > 0
				? nodeEvidence.slice().sort((a, b) => {
						const aMatched = matchedEvidenceIds.has(a.id);
						const bMatched = matchedEvidenceIds.has(b.id);
						if (aMatched !== bMatched) return aMatched ? -1 : 1;
						return compareOptionalDates(a.occurredAt ?? a.createdAt, b.occurredAt ?? b.createdAt);
					})
				: nodeEvidence;
		const nodeContacts = contactsByNode.get(candidate.node.id) ?? [];
		const aggregateEvidenceCount = nodeContacts.reduce((sum, row) => sum + row.evidenceCount, 0);
		const latestEvidenceAt =
			rankedNodeEvidence[0]?.occurredAt ??
			rankedNodeEvidence[0]?.createdAt ??
			nodeContacts
				.slice()
				.sort((a, b) => compareOptionalDates(a.lastEvidenceAt, b.lastEvidenceAt))[0]
				?.lastEvidenceAt ??
			null;
		const topConfidence =
			nodeEvidence.reduce<number | null>((max, row) => {
				if (typeof row.confidence !== 'number') return max;
				return max === null ? row.confidence : Math.max(max, row.confidence);
			}, null) ??
			nodeContacts.reduce<number | null>((max, row) => {
				if (typeof row.strength !== 'number') return max;
				return max === null ? row.strength : Math.max(max, row.strength);
			}, null);
		const connectedContactsWithEvidence = new Set(
			nodeEvidence.filter((row) => row.contactId).map((row) => row.contactId),
		).size;

		const evidence = rankedNodeEvidence.slice(0, evidenceLimitPerNode).map((row) => ({
			id: row.id,
			contactId: row.contactId,
			messageId: row.messageId,
			relationType: row.relationType,
			evidenceKind: row.evidenceKind,
			confidence: row.confidence,
			snippet: row.snippet,
			occurredAt: row.occurredAt,
			createdAt: row.createdAt,
		}));

		const contactsForResult = nodeContacts
			.slice()
			.sort((a, b) => {
				const aEvidence =
					evidenceByContact.get(`${a.nodeId}:${a.contactId}:${a.relationType}`) ?? [];
				const bEvidence =
					evidenceByContact.get(`${b.nodeId}:${b.contactId}:${b.relationType}`) ?? [];
				if (aEvidence.length !== bEvidence.length) return bEvidence.length - aEvidence.length;
				if (a.evidenceCount !== b.evidenceCount) return b.evidenceCount - a.evidenceCount;
				if (a.strength !== b.strength) return b.strength - a.strength;
				return compareOptionalDates(a.lastEvidenceAt, b.lastEvidenceAt);
			})
			.slice(0, contactLimitPerNode)
			.map((row) => {
				const contactEvidence =
					evidenceByContact.get(`${row.nodeId}:${row.contactId}:${row.relationType}`) ?? [];
				return {
					id: row.contactId,
					firstName: row.firstName,
					lastName: row.lastName,
					relationType: row.relationType,
					strength: row.strength,
					evidenceCount: row.evidenceCount,
					lastEvidenceAt: row.lastEvidenceAt,
					evidence: contactEvidence.slice(0, evidenceLimitPerNode).map((evidenceRow) => ({
						id: evidenceRow.id,
						contactId: evidenceRow.contactId,
						messageId: evidenceRow.messageId,
						relationType: evidenceRow.relationType,
						evidenceKind: evidenceRow.evidenceKind,
						confidence: evidenceRow.confidence,
						snippet: evidenceRow.snippet,
						occurredAt: evidenceRow.occurredAt,
						createdAt: evidenceRow.createdAt,
					})),
				};
			});

		const matchReasons = [...candidate.matchReasons];
		if (nodeEvidence.length > 0) matchReasons.push('message evidence');
		if (connectedContactsWithEvidence > 0) matchReasons.push('contact evidence');
		if (latestEvidenceAt) matchReasons.push('recent activity');
		if (candidate.messageHitCount > 0) matchReasons.push('matched in message evidence');

		return {
			node: candidate.node,
			similarity: candidate.similarity,
			matchScore: computeKnowledgeSearchScore({
				candidate,
				evidenceCount: nodeEvidence.length,
				topConfidence,
				connectedContactsWithEvidence,
				latestEvidenceAt,
			}),
			matchReasons: [...new Set(matchReasons)],
			exactMatch: candidate.exactMatch,
			aliasMatch: candidate.aliasMatch,
			messageRecallScore: candidate.messageRecallScore,
			messageHitCount: candidate.messageHitCount,
			messageMatchedEvidenceIds: [...candidate.messageMatchedEvidenceIds],
			messageMatchedAt: candidate.messageMatchedAt,
			messageRecallReasons: [...candidate.messageRecallReasons],
			evidenceCount: nodeEvidence.length,
			aggregateEvidenceCount,
			latestEvidenceAt,
			topConfidence,
			connectedContactCount: nodeContacts.length,
			connectedContactsWithEvidence,
			contacts: contactsForResult,
			evidence,
		};
	});

	return results
		.sort((a, b) => {
			if (a.exactMatch !== b.exactMatch) return a.exactMatch ? -1 : 1;
			if (a.aliasMatch !== b.aliasMatch) return a.aliasMatch ? -1 : 1;
			if (a.matchScore !== b.matchScore) return b.matchScore - a.matchScore;
			return (b.node.mentionCount ?? 0) - (a.node.mentionCount ?? 0);
		})
		.slice(0, limit);
}

/**
 * Dry-run report for legacy aggregate contact-topic links that do not have
 * source message evidence rows yet. This function never writes data.
 */
export async function getLegacyKnowledgeEvidenceReport(): Promise<LegacyKnowledgeEvidenceReport> {
	const [totalsResult, byWorkspaceResult, byNodeTypeResult, topNodesResult, topContactsResult] =
		await Promise.all([
			db.execute(sql`
				SELECT
					count(DISTINCT kc.id)::int AS "totalKnowledgeContactRows",
					count(DISTINCT kc.id) FILTER (WHERE ke.id IS NULL)::int AS "rowsWithoutEvidence"
				FROM knowledge_contacts kc
				LEFT JOIN knowledge_evidence ke
					ON ke.workspace_id = kc.workspace_id
					AND ke.knowledge_node_id = kc.knowledge_node_id
					AND ke.contact_id = kc.contact_id
					AND ke.relation_type = kc.relation_type::text
			`),
			db.execute(sql`
				SELECT
					kc.workspace_id::text AS "workspaceId",
					count(DISTINCT kc.id)::int AS "totalKnowledgeContactRows",
					count(DISTINCT kc.id) FILTER (WHERE ke.id IS NULL)::int AS "rowsWithoutEvidence"
				FROM knowledge_contacts kc
				LEFT JOIN knowledge_evidence ke
					ON ke.workspace_id = kc.workspace_id
					AND ke.knowledge_node_id = kc.knowledge_node_id
					AND ke.contact_id = kc.contact_id
					AND ke.relation_type = kc.relation_type::text
				GROUP BY kc.workspace_id
				ORDER BY "rowsWithoutEvidence" DESC
			`),
			db.execute(sql`
				SELECT
					kn.type::text AS "nodeType",
					count(DISTINCT kc.id)::int AS "totalKnowledgeContactRows",
					count(DISTINCT kc.id) FILTER (WHERE ke.id IS NULL)::int AS "rowsWithoutEvidence"
				FROM knowledge_contacts kc
				INNER JOIN knowledge_nodes kn
					ON kn.id = kc.knowledge_node_id
					AND kn.workspace_id = kc.workspace_id
				LEFT JOIN knowledge_evidence ke
					ON ke.workspace_id = kc.workspace_id
					AND ke.knowledge_node_id = kc.knowledge_node_id
					AND ke.contact_id = kc.contact_id
					AND ke.relation_type = kc.relation_type::text
				GROUP BY kn.type
				ORDER BY "rowsWithoutEvidence" DESC
			`),
			db.execute(sql`
				SELECT
					kc.workspace_id::text AS "workspaceId",
					kc.knowledge_node_id::text AS "nodeId",
					kn.type::text AS "nodeType",
					count(DISTINCT kc.id)::int AS "rowsWithoutEvidence",
					coalesce(sum(kc.evidence_count), 0)::int AS "aggregateEvidenceCount",
					max(kc.last_evidence_at) AS "latestLegacyEvidenceAt"
				FROM knowledge_contacts kc
				INNER JOIN knowledge_nodes kn
					ON kn.id = kc.knowledge_node_id
					AND kn.workspace_id = kc.workspace_id
				LEFT JOIN knowledge_evidence ke
					ON ke.workspace_id = kc.workspace_id
					AND ke.knowledge_node_id = kc.knowledge_node_id
					AND ke.contact_id = kc.contact_id
					AND ke.relation_type = kc.relation_type::text
				WHERE ke.id IS NULL
				GROUP BY kc.workspace_id, kc.knowledge_node_id, kn.type
				ORDER BY "rowsWithoutEvidence" DESC, "aggregateEvidenceCount" DESC
				LIMIT 20
			`),
			db.execute(sql`
				SELECT
					kc.workspace_id::text AS "workspaceId",
					kc.contact_id::text AS "contactId",
					count(DISTINCT kc.id)::int AS "rowsWithoutEvidence",
					coalesce(sum(kc.evidence_count), 0)::int AS "aggregateEvidenceCount",
					max(kc.last_evidence_at) AS "latestLegacyEvidenceAt"
				FROM knowledge_contacts kc
				LEFT JOIN knowledge_evidence ke
					ON ke.workspace_id = kc.workspace_id
					AND ke.knowledge_node_id = kc.knowledge_node_id
					AND ke.contact_id = kc.contact_id
					AND ke.relation_type = kc.relation_type::text
				WHERE ke.id IS NULL
				GROUP BY kc.workspace_id, kc.contact_id
				ORDER BY "rowsWithoutEvidence" DESC, "aggregateEvidenceCount" DESC
				LIMIT 20
			`),
		]);

	const totals = rowsFromExecute<{
		totalKnowledgeContactRows: unknown;
		rowsWithoutEvidence: unknown;
	}>(totalsResult)[0];

	const rowsWithoutEvidence = toReportNumber(totals?.rowsWithoutEvidence);

	return {
		totalKnowledgeContactRows: toReportNumber(totals?.totalKnowledgeContactRows),
		rowsWithoutEvidence,
		byWorkspace: rowsFromExecute<{
			workspaceId: string;
			totalKnowledgeContactRows: unknown;
			rowsWithoutEvidence: unknown;
		}>(byWorkspaceResult).map((row) => ({
			workspaceId: row.workspaceId,
			totalKnowledgeContactRows: toReportNumber(row.totalKnowledgeContactRows),
			rowsWithoutEvidence: toReportNumber(row.rowsWithoutEvidence),
		})),
		byNodeType: rowsFromExecute<{
			nodeType: string;
			totalKnowledgeContactRows: unknown;
			rowsWithoutEvidence: unknown;
		}>(byNodeTypeResult).map((row) => ({
			nodeType: row.nodeType,
			totalKnowledgeContactRows: toReportNumber(row.totalKnowledgeContactRows),
			rowsWithoutEvidence: toReportNumber(row.rowsWithoutEvidence),
		})),
		topNodesMissingEvidence: rowsFromExecute<{
			workspaceId: string;
			nodeId: string;
			nodeType: string;
			rowsWithoutEvidence: unknown;
			aggregateEvidenceCount: unknown;
			latestLegacyEvidenceAt: unknown;
		}>(topNodesResult).map((row) => ({
			workspaceId: row.workspaceId,
			nodeId: row.nodeId,
			nodeType: row.nodeType,
			rowsWithoutEvidence: toReportNumber(row.rowsWithoutEvidence),
			aggregateEvidenceCount: toReportNumber(row.aggregateEvidenceCount),
			latestLegacyEvidenceAt: toReportDate(row.latestLegacyEvidenceAt),
		})),
		topContactsMissingEvidence: rowsFromExecute<{
			workspaceId: string;
			contactId: string;
			rowsWithoutEvidence: unknown;
			aggregateEvidenceCount: unknown;
			latestLegacyEvidenceAt: unknown;
		}>(topContactsResult).map((row) => ({
			workspaceId: row.workspaceId,
			contactId: row.contactId,
			rowsWithoutEvidence: toReportNumber(row.rowsWithoutEvidence),
			aggregateEvidenceCount: toReportNumber(row.aggregateEvidenceCount),
			latestLegacyEvidenceAt: toReportDate(row.latestLegacyEvidenceAt),
		})),
		recommendedNextAction:
			rowsWithoutEvidence > 0
				? 'Run a reviewed evidence backfill that deterministically maps legacy links to candidate messages or memories before writing knowledge_evidence rows.'
				: 'No legacy aggregate-only contact-topic links found. Keep monitoring after new extraction runs.',
	};
}

/**
 * Remove exact rerun duplicates and normalize counters for a workspace.
 *
 * This is intentionally content-blind: it groups by stable IDs, relation type,
 * evidence kind, and source message only. It does not decrypt snippets or labels.
 */
export async function repairKnowledgeEvidenceCounts(
	workspaceId: string,
): Promise<RepairKnowledgeEvidenceCountsResult> {
	const result = await db.execute(sql`
		WITH ranked_message_evidence AS (
			SELECT
				id,
				row_number() OVER (
					PARTITION BY
						workspace_id,
						knowledge_node_id,
						coalesce(contact_id, '00000000-0000-0000-0000-000000000000'::uuid),
						coalesce(related_knowledge_node_id, '00000000-0000-0000-0000-000000000000'::uuid),
						message_id,
						relation_type,
						evidence_kind
					ORDER BY created_at ASC, id ASC
				) AS duplicate_rank
			FROM knowledge_evidence
			WHERE workspace_id = ${workspaceId}::uuid
				AND message_id IS NOT NULL
		),
		deleted_duplicate_evidence AS (
			DELETE FROM knowledge_evidence ke
			USING ranked_message_evidence rme
			WHERE ke.id = rme.id
				AND rme.duplicate_rank > 1
			RETURNING ke.id
		),
		evidence_counts AS (
			SELECT
				workspace_id,
				knowledge_node_id,
				contact_id,
				relation_type,
				GREATEST(
					(
						count(DISTINCT message_id) FILTER (WHERE message_id IS NOT NULL)
						+ count(*) FILTER (WHERE message_id IS NULL)
					)::int,
					1
				) AS evidence_count,
				max(coalesce(occurred_at, created_at)) AS latest_evidence_at
			FROM knowledge_evidence
			WHERE workspace_id = ${workspaceId}::uuid
				AND contact_id IS NOT NULL
			GROUP BY workspace_id, knowledge_node_id, contact_id, relation_type
		),
		updated_contacts AS (
			UPDATE knowledge_contacts kc
			SET
				evidence_count = ec.evidence_count,
				last_evidence_at = coalesce(ec.latest_evidence_at, kc.last_evidence_at)
			FROM evidence_counts ec
			WHERE kc.workspace_id = ec.workspace_id
				AND kc.knowledge_node_id = ec.knowledge_node_id
				AND kc.contact_id = ec.contact_id
				AND kc.relation_type::text = ec.relation_type
				AND (
					kc.evidence_count IS DISTINCT FROM ec.evidence_count
					OR kc.last_evidence_at IS DISTINCT FROM coalesce(ec.latest_evidence_at, kc.last_evidence_at)
				)
			RETURNING kc.id
		),
		link_counts AS (
			SELECT
				kc.workspace_id,
				kc.knowledge_node_id,
				kc.contact_id,
				kc.relation_type::text AS relation_type,
				coalesce(ec.evidence_count, kc.evidence_count) AS evidence_count,
				coalesce(ec.latest_evidence_at, kc.last_evidence_at) AS last_evidence_at
			FROM knowledge_contacts kc
			LEFT JOIN evidence_counts ec
				ON ec.workspace_id = kc.workspace_id
				AND ec.knowledge_node_id = kc.knowledge_node_id
				AND ec.contact_id = kc.contact_id
				AND ec.relation_type = kc.relation_type::text
			WHERE kc.workspace_id = ${workspaceId}::uuid
		),
		contact_node_counts AS (
			SELECT
				workspace_id,
				knowledge_node_id,
				coalesce(sum(evidence_count), 0)::int AS aggregate_evidence_count,
				max(last_evidence_at) AS latest_contact_evidence_at
			FROM link_counts
			GROUP BY workspace_id, knowledge_node_id
		),
		evidence_node_counts AS (
			SELECT
				workspace_id,
				knowledge_node_id,
				(
					count(DISTINCT message_id) FILTER (WHERE message_id IS NOT NULL)
					+ count(*) FILTER (WHERE message_id IS NULL)
				)::int AS direct_evidence_count,
				max(coalesce(occurred_at, created_at)) AS latest_direct_evidence_at
			FROM knowledge_evidence
			WHERE workspace_id = ${workspaceId}::uuid
			GROUP BY workspace_id, knowledge_node_id
		),
		node_counts AS (
			SELECT
				kn.workspace_id,
				kn.id AS knowledge_node_id,
				GREATEST(
					1,
					coalesce(cnc.aggregate_evidence_count, 0),
					coalesce(enc.direct_evidence_count, 0)
				)::int AS mention_count,
				GREATEST(
					kn.last_seen_at,
					cnc.latest_contact_evidence_at,
					enc.latest_direct_evidence_at
				) AS latest_seen_at
			FROM knowledge_nodes kn
			LEFT JOIN contact_node_counts cnc
				ON cnc.workspace_id = kn.workspace_id
				AND cnc.knowledge_node_id = kn.id
			LEFT JOIN evidence_node_counts enc
				ON enc.workspace_id = kn.workspace_id
				AND enc.knowledge_node_id = kn.id
			WHERE kn.workspace_id = ${workspaceId}::uuid
				AND (
					cnc.knowledge_node_id IS NOT NULL
					OR enc.knowledge_node_id IS NOT NULL
				)
		),
		updated_nodes AS (
			UPDATE knowledge_nodes kn
			SET
				mention_count = nc.mention_count,
				last_seen_at = coalesce(nc.latest_seen_at, kn.last_seen_at)
			FROM node_counts nc
			WHERE kn.workspace_id = nc.workspace_id
				AND kn.id = nc.knowledge_node_id
				AND (
					kn.mention_count IS DISTINCT FROM nc.mention_count
					OR kn.last_seen_at IS DISTINCT FROM coalesce(nc.latest_seen_at, kn.last_seen_at)
				)
			RETURNING kn.id
		)
		SELECT
			(SELECT count(*)::int FROM deleted_duplicate_evidence) AS "duplicateEvidenceRowsDeleted",
			(SELECT count(*)::int FROM updated_contacts) AS "contactLinksRecomputed",
			(SELECT count(*)::int FROM updated_nodes) AS "nodesRecomputed"
	`);
	const row = rowsFromExecute<{
		duplicateEvidenceRowsDeleted: unknown;
		contactLinksRecomputed: unknown;
		nodesRecomputed: unknown;
	}>(result)[0];

	return {
		workspaceId,
		duplicateEvidenceRowsDeleted: toReportNumber(row?.duplicateEvidenceRowsDeleted),
		contactLinksRecomputed: toReportNumber(row?.contactLinksRecomputed),
		nodesRecomputed: toReportNumber(row?.nodesRecomputed),
	};
}

/**
 * Store one evidence/provenance row for a knowledge claim.
 * Snippets are encryptedText, so callers must pass an envelope when snippet is present.
 */
async function findExistingMessageBackedKnowledgeEvidence(
	workspaceId: string,
	data: CreateKnowledgeEvidenceInput,
	envelope?: SealedEnvelope,
): Promise<KnowledgeEvidence | null> {
	if (!data.messageId) return null;

	const relatedNodeId = data.relatedKnowledgeNodeId ?? null;
	const contactId = data.contactId ?? null;
	const conditions = [
		eq(knowledgeEvidence.workspaceId, workspaceId),
		eq(knowledgeEvidence.knowledgeNodeId, data.knowledgeNodeId),
		eq(knowledgeEvidence.messageId, data.messageId),
		eq(knowledgeEvidence.relationType, data.relationType),
		eq(knowledgeEvidence.evidenceKind, data.evidenceKind),
		contactId ? eq(knowledgeEvidence.contactId, contactId) : isNull(knowledgeEvidence.contactId),
		relatedNodeId
			? eq(knowledgeEvidence.relatedKnowledgeNodeId, relatedNodeId)
			: isNull(knowledgeEvidence.relatedKnowledgeNodeId),
	];

	const doQuery = async () => {
		const result =
			(await db
				.select()
				.from(knowledgeEvidence)
				.where(and(...conditions))
				.limit(1)) ?? [];
		return result[0] ?? null;
	};

	return envelope ? withKeys(envelope, doQuery) : doQuery();
}

export async function createKnowledgeEvidence(
	workspaceId: string,
	data: CreateKnowledgeEvidenceInput,
	envelope?: SealedEnvelope,
): Promise<KnowledgeEvidence> {
	if (data.snippet && !envelope) {
		throw new Error('createKnowledgeEvidence: envelope required when snippet is provided');
	}

	const doInsert = async () => {
		const existing = await findExistingMessageBackedKnowledgeEvidence(workspaceId, data);
		if (existing) return existing;

		const result = await db
			.insert(knowledgeEvidence)
			.values({
				workspaceId,
				knowledgeNodeId: data.knowledgeNodeId,
				relatedKnowledgeNodeId: data.relatedKnowledgeNodeId ?? null,
				contactId: data.contactId ?? null,
				messageId: data.messageId ?? null,
				relationType: data.relationType,
				evidenceKind: data.evidenceKind,
				confidence: data.confidence ?? null,
				snippet: data.snippet ?? null,
				occurredAt: data.occurredAt ?? null,
				metadata: data.metadata ?? null,
			})
			.returning();
		const row = result[0];
		if (!row) throw new Error('createKnowledgeEvidence: insert returned no rows');
		return row;
	};

	return envelope ? withKeys(envelope, doInsert) : doInsert();
}

export async function listEvidenceForKnowledgeNode(
	workspaceId: string,
	nodeId: string,
	envelope: SealedEnvelope,
	opts?: { limit?: number },
): Promise<KnowledgeEvidence[]> {
	const limit = opts?.limit ?? 25;
	return withKeys(envelope, async () =>
		db
			.select()
			.from(knowledgeEvidence)
			.where(
				and(
					eq(knowledgeEvidence.workspaceId, workspaceId),
					eq(knowledgeEvidence.knowledgeNodeId, nodeId),
				),
			)
			.orderBy(evidenceRecencyOrder, desc(knowledgeEvidence.createdAt))
			.limit(limit),
	);
}

export async function listEvidenceForKnowledgeNodes(
	workspaceId: string,
	nodeIds: string[],
	envelope: SealedEnvelope,
): Promise<KnowledgeEvidence[]> {
	if (nodeIds.length === 0) return [];
	return withKeys(envelope, async () =>
		db
			.select()
			.from(knowledgeEvidence)
			.where(
				and(
					eq(knowledgeEvidence.workspaceId, workspaceId),
					inArray(knowledgeEvidence.knowledgeNodeId, nodeIds),
				),
			)
			.orderBy(evidenceRecencyOrder, desc(knowledgeEvidence.createdAt)),
	);
}

export async function listEvidenceForKnowledgeContact(
	workspaceId: string,
	nodeId: string,
	contactId: string,
	envelope: SealedEnvelope,
	opts?: { relationType?: string; limit?: number },
): Promise<KnowledgeEvidence[]> {
	const limit = opts?.limit ?? 10;
	const conditions = [
		eq(knowledgeEvidence.workspaceId, workspaceId),
		eq(knowledgeEvidence.knowledgeNodeId, nodeId),
		eq(knowledgeEvidence.contactId, contactId),
	];
	if (opts?.relationType) {
		conditions.push(eq(knowledgeEvidence.relationType, opts.relationType));
	}

	return withKeys(envelope, async () =>
		db
			.select()
			.from(knowledgeEvidence)
			.where(and(...conditions))
			.orderBy(evidenceRecencyOrder, desc(knowledgeEvidence.createdAt))
			.limit(limit),
	);
}

export async function listEvidenceForKnowledgeLink(
	workspaceId: string,
	nodeId: string,
	relatedNodeId: string,
	envelope: SealedEnvelope,
	opts?: { relationType?: string; limit?: number },
): Promise<KnowledgeEvidence[]> {
	const limit = opts?.limit ?? 10;
	const conditions = [
		eq(knowledgeEvidence.workspaceId, workspaceId),
		eq(knowledgeEvidence.knowledgeNodeId, nodeId),
		eq(knowledgeEvidence.relatedKnowledgeNodeId, relatedNodeId),
	];
	if (opts?.relationType) {
		conditions.push(eq(knowledgeEvidence.relationType, opts.relationType));
	}

	return withKeys(envelope, async () =>
		db
			.select()
			.from(knowledgeEvidence)
			.where(and(...conditions))
			.orderBy(evidenceRecencyOrder, desc(knowledgeEvidence.createdAt))
			.limit(limit),
	);
}

/**
 * Link a contact to a knowledge node. Idempotent: repeated calls increment
 * evidenceCount and update strength/lastEvidenceAt rather than creating duplicates.
 */
export async function linkContactToKnowledge(
	workspaceId: string,
	nodeId: string,
	contactId: string,
	relationType:
		| 'knows_about'
		| 'works_on'
		| 'member_of'
		| 'expert_in'
		| 'uses'
		| 'invested_in'
		| 'interested_in'
		| 'decided'
		| 'experienced_outcome',
	strength = 1.0,
	evidence?: KnowledgeContactEvidenceInput,
): Promise<KnowledgeContact> {
	if (evidence?.snippet && !evidence.envelope) {
		throw new Error('linkContactToKnowledge: envelope required when evidence snippet is provided');
	}

	const values: typeof knowledgeContacts.$inferInsert = {
		workspaceId,
		knowledgeNodeId: nodeId,
		contactId,
		relationType,
		strength,
	};
	if (evidence?.occurredAt) {
		values.lastEvidenceAt = evidence.occurredAt;
	}
	const evidenceOccurredAtIso = evidence?.occurredAt?.toISOString();
	const evidenceInput: CreateKnowledgeEvidenceInput | null = evidence
		? {
				knowledgeNodeId: nodeId,
				contactId,
				messageId: evidence.messageId ?? null,
				relationType,
				evidenceKind: evidence.evidenceKind ?? 'manual',
				confidence: evidence.confidence ?? strength,
				snippet: evidence.snippet ?? null,
				occurredAt: evidence.occurredAt ?? null,
				metadata: evidence.metadata ?? null,
			}
		: null;
	const existingEvidence = evidenceInput
		? await findExistingMessageBackedKnowledgeEvidence(
				workspaceId,
				evidenceInput,
				evidence?.envelope,
			)
		: null;
	const conflictSet: Record<string, unknown> = {
		strength,
		lastEvidenceAt: evidenceOccurredAtIso
			? sql`GREATEST(${knowledgeContacts.lastEvidenceAt}, ${evidenceOccurredAtIso}::timestamptz)`
			: sql`now()`,
	};
	if (!existingEvidence) {
		conflictSet.evidenceCount = sql`${knowledgeContacts.evidenceCount} + 1`;
	}

	const result = await db
		.insert(knowledgeContacts)
		.values(values)
		.onConflictDoUpdate({
			target: [
				knowledgeContacts.knowledgeNodeId,
				knowledgeContacts.contactId,
				knowledgeContacts.relationType,
			],
			set: conflictSet,
		})
		.returning();
	const row = result[0];
	if (!row) throw new Error('linkContactToKnowledge: insert returned no rows');
	if (evidenceInput && !existingEvidence) {
		await createKnowledgeEvidence(workspaceId, evidenceInput, evidence?.envelope);
	}
	return row;
}

export interface KnowledgeContactWithEvidence {
	contact: typeof contacts.$inferSelect;
	link: KnowledgeContact;
	evidence: KnowledgeEvidence[];
}

/**
 * Return linked contacts plus supporting evidence snippets for a topic node.
 * Requires an envelope because contact names and evidence snippets are encrypted.
 */
export async function listContactsWithEvidenceForKnowledgeNode(
	nodeId: string,
	workspaceId: string,
	envelope: SealedEnvelope,
	opts?: { evidenceLimitPerContact?: number },
): Promise<KnowledgeContactWithEvidence[]> {
	const evidenceLimit = opts?.evidenceLimitPerContact ?? 3;

	return withKeys(envelope, async () => {
		const contactRows = await db
			.select({ contact: contacts, link: knowledgeContacts })
			.from(knowledgeContacts)
			.innerJoin(
				contacts,
				and(eq(knowledgeContacts.contactId, contacts.id), eq(contacts.workspaceId, workspaceId)),
			)
			.where(
				and(
					eq(knowledgeContacts.knowledgeNodeId, nodeId),
					eq(knowledgeContacts.workspaceId, workspaceId),
				),
			);

		if (contactRows.length === 0) return [];

		const contactIds = contactRows.map((r) => r.contact.id);
		const evidenceRows = await db
			.select()
			.from(knowledgeEvidence)
			.where(
				and(
					eq(knowledgeEvidence.workspaceId, workspaceId),
					eq(knowledgeEvidence.knowledgeNodeId, nodeId),
					inArray(knowledgeEvidence.contactId, contactIds),
				),
			)
			.orderBy(evidenceRecencyOrder, desc(knowledgeEvidence.createdAt));

		return contactRows.map((row) => ({
			...row,
			evidence: evidenceRows
				.filter((e) => e.contactId === row.contact.id && e.relationType === row.link.relationType)
				.slice(0, evidenceLimit),
		}));
	});
}

/**
 * Return contact IDs linked to a knowledge node. No PII fields are returned.
 * Use this in worker/backend contexts where only IDs or counts are needed.
 * SEC-W04: workspaceId is required for defense-in-depth workspace isolation.
 */
export async function listContactIdsByKnowledge(
	nodeId: string,
	workspaceId: string,
): Promise<string[]> {
	const rows = await db
		.select({ contactId: knowledgeContacts.contactId })
		.from(knowledgeContacts)
		.where(
			and(
				eq(knowledgeContacts.knowledgeNodeId, nodeId),
				eq(knowledgeContacts.workspaceId, workspaceId),
			),
		);
	return rows.map((r) => r.contactId);
}

/**
 * List full (decrypted) contacts linked to a knowledge node.
 * Requires SealedEnvelope — use only in web/UI contexts where PII display is needed.
 * SEC-W04: workspaceId enforced in both the join and the contacts query (defense-in-depth).
 */
export async function listContactsByKnowledge(
	nodeId: string,
	workspaceId: string,
	envelope: SealedEnvelope,
) {
	const contactIds = await listContactIdsByKnowledge(nodeId, workspaceId);
	if (contactIds.length === 0) return [];

	// SEC-W04: workspace_id filter for defense-in-depth (listContactIdsByKnowledge already scopes, but enforce independently)
	const contactRows = await withKeys(
		envelope,
		async () =>
			await db
				.select()
				.from(contacts)
				.where(and(inArray(contacts.id, contactIds), eq(contacts.workspaceId, workspaceId))),
	);

	return contactRows.map((contact) => ({ contact }));
}

/**
 * List all knowledge nodes linked to a contact.
 * SEC-114: workspaceId is required to prevent cross-workspace BOLA.
 */
export async function listKnowledgeByContact(
	contactId: string,
	workspaceId: string,
	envelope?: SealedEnvelope,
): Promise<KnowledgeNode[]> {
	const doQuery = async () =>
		db
			.select({ node: knowledgeNodes })
			.from(knowledgeContacts)
			.innerJoin(knowledgeNodes, eq(knowledgeContacts.knowledgeNodeId, knowledgeNodes.id))
			.where(
				and(
					eq(knowledgeContacts.contactId, contactId),
					eq(knowledgeContacts.workspaceId, workspaceId),
				),
			)
			.then((rows) => rows.map((r) => r.node));

	return envelope ? withKeys(envelope, doQuery) : doQuery();
}

/**
 * Merge two knowledge nodes. Transfers contact links and knowledge_links
 * (both directions) from mergedId to survivorId, handling conflicts.
 * Appends the merged node's name to the survivor's aliases array and
 * combines mention counts. Deletes the merged node after transfer.
 */
export async function mergeKnowledgeNodes(
	workspaceId: string,
	survivorId: string,
	mergedId: string,
	envelope?: SealedEnvelope,
): Promise<void> {
	const doMerge = async () =>
		db.transaction(async (tx) => {
			// Fetch the merged node to get its name for alias tracking
			const mergedNode = await tx
				.select({ name: knowledgeNodes.name, mentionCount: knowledgeNodes.mentionCount })
				.from(knowledgeNodes)
				.where(and(eq(knowledgeNodes.id, mergedId), eq(knowledgeNodes.workspaceId, workspaceId)))
				.limit(1);

			if (mergedNode.length === 0) return;

			// Step 1: Transfer non-conflicting contact links to survivor
			await tx.execute(sql`
			UPDATE knowledge_contacts
			SET knowledge_node_id = ${survivorId}::uuid
			WHERE knowledge_node_id = ${mergedId}::uuid
			AND workspace_id = ${workspaceId}::uuid
			AND (contact_id, relation_type) NOT IN (
				SELECT contact_id, relation_type
				FROM knowledge_contacts
				WHERE knowledge_node_id = ${survivorId}::uuid
				AND workspace_id = ${workspaceId}::uuid
			)
		`);

			// Step 2: Transfer non-conflicting knowledge_links (edges)
			await tx.execute(sql`
			UPDATE knowledge_links
			SET source_node_id = ${survivorId}::uuid
			WHERE source_node_id = ${mergedId}::uuid
			AND workspace_id = ${workspaceId}::uuid
			AND (target_node_id, link_type) NOT IN (
				SELECT target_node_id, link_type
				FROM knowledge_links
				WHERE source_node_id = ${survivorId}::uuid
				AND workspace_id = ${workspaceId}::uuid
			)
		`);

			await tx.execute(sql`
			UPDATE knowledge_links
			SET target_node_id = ${survivorId}::uuid
			WHERE target_node_id = ${mergedId}::uuid
			AND workspace_id = ${workspaceId}::uuid
			AND (source_node_id, link_type) NOT IN (
				SELECT source_node_id, link_type
				FROM knowledge_links
				WHERE target_node_id = ${survivorId}::uuid
				AND workspace_id = ${workspaceId}::uuid
			)
		`);

			// Step 3: Transfer evidence rows that point at the merged node.
			await tx.execute(sql`
			UPDATE knowledge_evidence
			SET knowledge_node_id = ${survivorId}::uuid
			WHERE knowledge_node_id = ${mergedId}::uuid
			AND workspace_id = ${workspaceId}::uuid
		`);

			await tx.execute(sql`
			UPDATE knowledge_evidence
			SET related_knowledge_node_id = ${survivorId}::uuid
			WHERE related_knowledge_node_id = ${mergedId}::uuid
			AND workspace_id = ${workspaceId}::uuid
		`);

			// Step 4: Add merged node's name to survivor's aliases + combine mention counts
			await tx.execute(sql`
			UPDATE knowledge_nodes
			SET
				aliases = array_append(aliases, ${mergedNode[0]?.name}),
				mention_count = mention_count + ${mergedNode[0]?.mentionCount ?? 0}
			WHERE id = ${survivorId}::uuid
			AND workspace_id = ${workspaceId}::uuid
		`);

			// Step 5: Delete remaining conflict links and the merged node
			await tx
				.delete(knowledgeContacts)
				.where(
					and(
						eq(knowledgeContacts.knowledgeNodeId, mergedId),
						eq(knowledgeContacts.workspaceId, workspaceId),
					),
				);

			await tx
				.delete(knowledgeNodes)
				.where(and(eq(knowledgeNodes.id, mergedId), eq(knowledgeNodes.workspaceId, workspaceId)));
		});

	if (envelope) {
		await withKeys(envelope, doMerge);
	} else {
		await doMerge();
	}
}

export async function deleteKnowledgeNode(workspaceId: string, id: string): Promise<void> {
	await db
		.delete(knowledgeNodes)
		.where(and(eq(knowledgeNodes.id, id), eq(knowledgeNodes.workspaceId, workspaceId)));
}

/**
 * Find a knowledge node by normalized name across ALL types.
 * Used for cross-type deduplication: if "uniswap" exists as a 'project',
 * don't create a second "uniswap" as an 'organization'.
 *
 * SEC-ENC-100: Uses blind index for exact match on encrypted name column.
 *
 * Returns the existing node (if any) regardless of type.
 * Returns null if no match exists.
 */
export async function findNodeByNameAnyType(
	workspaceId: string,
	normalizedName: string,
	envelope: SealedEnvelope,
): Promise<KnowledgeNode | null> {
	return withKeys(envelope, async () => {
		const result = await db
			.select()
			.from(knowledgeNodes)
			.where(
				and(
					eq(knowledgeNodes.workspaceId, workspaceId),
					eq(knowledgeNodes.nameBlindIndex, normalizedName),
				),
			)
			.orderBy(desc(knowledgeNodes.mentionCount))
			.limit(1);

		return result[0] ?? null;
	});
}

/**
 * Find a knowledge node by checking its aliases array.
 * Used to prevent re-creating nodes that were previously merged.
 *
 * @returns The surviving node if the name matches an alias, null otherwise.
 */
export async function findNodeByAlias(
	workspaceId: string,
	normalizedName: string,
	envelope?: SealedEnvelope,
): Promise<KnowledgeNode | null> {
	// SEC-ENC-515: Use Drizzle ORM so encryptedText.fromDriver() decrypts
	const doQuery = async () => {
		const result = await db
			.select()
			.from(knowledgeNodes)
			.where(
				and(
					eq(knowledgeNodes.workspaceId, workspaceId),
					sql`${normalizedName} = ANY(${knowledgeNodes.aliases})`,
				),
			)
			.limit(1);
		return result[0] ?? null;
	};

	return envelope ? withKeys(envelope, doQuery) : doQuery();
}

/**
 * Create knowledge_links edges between semantically similar nodes
 * using pgvector's HNSW index. Runs entirely in PostgreSQL — no
 * application-level O(n²) comparison.
 *
 * Uses the <=> (cosine distance) operator. pgvector returns distance,
 * not similarity, so threshold 0.30 distance = 0.70 similarity.
 *
 * Idempotent: ON CONFLICT updates weight if the new similarity is higher.
 *
 * @returns Number of links created or updated.
 */
export async function inferSimilarityLinks(
	workspaceId: string,
	distanceThreshold = 0.3,
): Promise<number> {
	// KG-1: withIterativeScan prevents HNSW overfiltering in multi-tenant queries
	return withIterativeScan(async (tx) => {
		const result = await tx.execute(sql`
			WITH pairs AS (
				SELECT
					a.id AS source_id,
					b.id AS target_id,
					1 - (a.embedding <=> b.embedding) AS similarity
				FROM knowledge_nodes a
				JOIN knowledge_nodes b
					ON a.workspace_id = b.workspace_id
					AND a.id < b.id
				WHERE a.workspace_id = ${workspaceId}::uuid
					AND a.embedding IS NOT NULL
					AND b.embedding IS NOT NULL
					AND (a.embedding <=> b.embedding) < ${distanceThreshold}
			)
			INSERT INTO knowledge_links (id, workspace_id, source_node_id, target_node_id, link_type, weight)
			SELECT
				gen_random_uuid(),
				${workspaceId}::uuid,
				source_id,
				target_id,
				'related_to',
				similarity
			FROM pairs
			ON CONFLICT (workspace_id, source_node_id, target_node_id, link_type)
			DO UPDATE SET weight = GREATEST(knowledge_links.weight, EXCLUDED.weight)
			RETURNING id
		`);

		return Array.isArray(result) ? result.length : 0;
	});
}

// ─── Knowledge Links (Phase 32) ────────────────────────────────────────────

export type KnowledgeLink = typeof knowledgeLinks.$inferSelect;
export type KnowledgeLinkType =
	| 'part_of'
	| 'related_to'
	| 'competes_with'
	| 'builds_on'
	| 'funds'
	| 'uses'
	| 'cites'
	| 'led_to'
	| 'preceded_by'
	| 'contradicts';

/**
 * Create a directed edge between two knowledge nodes.
 * Idempotent: conflicting (workspace, source, target, link_type) updates the weight.
 */
export async function createKnowledgeLink(
	workspaceId: string,
	sourceNodeId: string,
	targetNodeId: string,
	linkType: KnowledgeLinkType,
	weight?: number,
	evidence?: KnowledgeLinkEvidenceInput,
): Promise<KnowledgeLink> {
	if (evidence?.snippet && !evidence.envelope) {
		throw new Error('createKnowledgeLink: envelope required when evidence snippet is provided');
	}

	const result = await db
		.insert(knowledgeLinks)
		.values({ workspaceId, sourceNodeId, targetNodeId, linkType, weight })
		.onConflictDoUpdate({
			target: [
				knowledgeLinks.workspaceId,
				knowledgeLinks.sourceNodeId,
				knowledgeLinks.targetNodeId,
				knowledgeLinks.linkType,
			],
			set: { weight },
		})
		.returning();
	const row = result[0];
	if (!row) throw new Error('createKnowledgeLink: insert returned no rows');
	if (evidence) {
		await createKnowledgeEvidence(
			workspaceId,
			{
				knowledgeNodeId: sourceNodeId,
				relatedKnowledgeNodeId: targetNodeId,
				messageId: evidence.messageId ?? null,
				relationType: linkType,
				evidenceKind: evidence.evidenceKind ?? 'manual',
				confidence: evidence.confidence ?? weight ?? null,
				snippet: evidence.snippet ?? null,
				occurredAt: evidence.occurredAt ?? null,
				metadata: evidence.metadata ?? null,
			},
			evidence.envelope,
		);
	}
	return row;
}

export interface KnowledgeNeighbor {
	link: KnowledgeLink;
	node: typeof knowledgeNodes.$inferSelect;
	direction: 'outbound' | 'inbound';
}

/**
 * Return all nodes directly connected to nodeId (outbound + inbound edges)
 * within the workspace. Each result includes the edge and direction.
 */
export async function getKnowledgeNeighbors(
	nodeId: string,
	workspaceId: string,
	envelope?: SealedEnvelope,
): Promise<KnowledgeNeighbor[]> {
	const doQuery = async () => {
		const outbound = await db
			.select({ link: knowledgeLinks, node: knowledgeNodes })
			.from(knowledgeLinks)
			.innerJoin(knowledgeNodes, eq(knowledgeLinks.targetNodeId, knowledgeNodes.id))
			.where(
				and(eq(knowledgeLinks.sourceNodeId, nodeId), eq(knowledgeLinks.workspaceId, workspaceId)),
			);

		const inbound = await db
			.select({ link: knowledgeLinks, node: knowledgeNodes })
			.from(knowledgeLinks)
			.innerJoin(knowledgeNodes, eq(knowledgeLinks.sourceNodeId, knowledgeNodes.id))
			.where(
				and(eq(knowledgeLinks.targetNodeId, nodeId), eq(knowledgeLinks.workspaceId, workspaceId)),
			);

		return [
			...outbound.map((r) => ({ ...r, direction: 'outbound' as const })),
			...inbound.map((r) => ({ ...r, direction: 'inbound' as const })),
		];
	};

	return envelope ? withKeys(envelope, doQuery) : doQuery();
}

/**
 * Return knowledge nodes that both contactA and contactB are linked to,
 * within the same workspace. Used to surface shared context between contacts.
 */
export async function getSharedKnowledge(
	contactIdA: string,
	contactIdB: string,
	workspaceId: string,
	envelope?: SealedEnvelope,
): Promise<(typeof knowledgeNodes.$inferSelect)[]> {
	// SEC-ENC-515: Two-step — raw SQL for shared node IDs, Drizzle ORM for decrypted nodes
	const doQuery = async () => {
		// Step 1: Get shared node IDs via raw SQL (IDs are not encrypted)
		const idRows = await db.execute(sql`
			SELECT kca.knowledge_node_id AS id
			FROM knowledge_contacts kca
			INNER JOIN knowledge_contacts kcb
				ON kcb.knowledge_node_id = kca.knowledge_node_id
				AND kcb.contact_id = ${contactIdB}::uuid
				AND kcb.workspace_id = ${workspaceId}::uuid
			WHERE kca.contact_id = ${contactIdA}::uuid
				AND kca.workspace_id = ${workspaceId}::uuid
		`);

		const ids = (idRows as unknown as Array<{ id: string }>).map((r) => r.id);
		if (ids.length === 0) return [];

		// Step 2: Fetch full nodes via Drizzle ORM (customType decrypts name/displayName/description)
		return db
			.select()
			.from(knowledgeNodes)
			.where(and(eq(knowledgeNodes.workspaceId, workspaceId), inArray(knowledgeNodes.id, ids)))
			.orderBy(desc(knowledgeNodes.mentionCount))
			.limit(50);
	};

	return envelope ? withKeys(envelope, doQuery) : doQuery();
}

/**
 * 2-hop recursive graph traversal from nodeId within workspaceId.
 * Returns all nodes reachable within `hops` edge-hops (default 2),
 * with their distance from the start node.
 * Workspace isolation is enforced at every hop via the CTE WHERE clause.
 */
export interface GraphSearchNode {
	node: typeof knowledgeNodes.$inferSelect;
	depth: number;
}

export async function knowledgeGraphSearch(
	nodeId: string,
	workspaceId: string,
	hops = 2,
	envelope?: SealedEnvelope,
): Promise<GraphSearchNode[]> {
	// SEC-ENC-515: Two-step — CTE for node IDs/depths, Drizzle ORM for decrypted nodes
	const doQuery = async () => {
		// Step 1: Recursive CTE returns only node_id + depth (no encrypted columns)
		const graphRows = await db.execute(sql`
			WITH RECURSIVE graph(node_id, depth) AS (
				SELECT ${nodeId}::uuid AS node_id, 0 AS depth
				UNION
				SELECT
					kl.target_node_id AS node_id,
					g.depth + 1 AS depth
				FROM graph g
				INNER JOIN knowledge_links kl
					ON kl.source_node_id = g.node_id
					AND kl.workspace_id = ${workspaceId}::uuid
				WHERE g.depth < ${hops}
			)
			SELECT DISTINCT ON (node_id) node_id, depth
			FROM graph
			WHERE node_id != ${nodeId}::uuid
			ORDER BY node_id, depth ASC
		`);

		const nodeDepths = graphRows as unknown as Array<{ node_id: string; depth: number }>;
		if (nodeDepths.length === 0) return [];

		// Step 2: Fetch full nodes via Drizzle ORM (customType decrypts name/displayName/description)
		const nodeIds = nodeDepths.map((r) => r.node_id);
		const nodes = await db
			.select()
			.from(knowledgeNodes)
			.where(and(eq(knowledgeNodes.workspaceId, workspaceId), inArray(knowledgeNodes.id, nodeIds)));

		const depthMap = new Map(nodeDepths.map((r) => [r.node_id, r.depth]));
		return nodes.map((node) => ({
			node,
			depth: depthMap.get(node.id) ?? 0,
		}));
	};

	return envelope ? withKeys(envelope, doQuery) : doQuery();
}

// ─── Provenance Search ───────────────────────────────────────────────────────

// SEC-PROV-011: Return ONLY whitelisted fields from metadata — never the
// raw JSONB blob. Prevents PII leakage from evidenceQuote or other fields
// reaching the LLM or client. Same approach as precedents.ts whitelist.
export interface ProvenanceResult {
	nodeId: string;
	nodeType: string;
	displayName: string;
	description: string | null;
	depth: number;
	provenanceScore: number;
	/** Whitelisted structural fields extracted from metadata — no PII */
	decisionAction?: string;
	decisionDate?: string;
	outcomeResult?: string;
	outcomeRoiWeight?: number;
	maskedEvidenceQuote?: string;
}

// SEC-PROV-006: Whitelist of valid node types for anchor filtering.
const VALID_NODE_TYPES = new Set([
	'topic',
	'project',
	'organization',
	'technology',
	'sector',
	'concept',
	'rationale',
	'decision',
	'outcome',
]);

/**
 * Provenance-aware graph traversal from a semantic query.
 *
 * 1. Anchors on knowledge nodes semantically similar to the query (W_semantic)
 * 2. Walks edges up to `maxHops` hops bidirectionally, accumulating weights
 * 3. Applies time decay on each hop (W_recency)
 * 4. Extracts ROI modifier from outcome nodes (W_outcome)
 * 5. Returns paths ordered by composite provenance score (W_semantic * W_recency * W_outcome)
 *
 * Security: workspace_id on every JOIN (SEC-PROV-007/008),
 * anchorTypes whitelisted (SEC-PROV-006), metadata fields whitelisted (SEC-PROV-011).
 */
export async function provenanceSearch(
	workspaceId: string,
	queryEmbedding: number[],
	opts?: {
		maxHops?: number;
		semanticThreshold?: number;
		limit?: number;
		/** Filter to specific node types in anchor step */
		anchorTypes?: string[];
		/** Envelope for decrypting displayName/description in Step 2 */
		envelope?: SealedEnvelope;
	},
): Promise<ProvenanceResult[]> {
	const maxHops = Math.min(opts?.maxHops ?? 3, 4);
	const semanticThreshold = opts?.semanticThreshold ?? 0.15;
	const limit = opts?.limit ?? 10;
	const embeddingStr = `[${queryEmbedding.join(',')}]`;

	// SEC-PROV-006: Whitelist anchorTypes against known enum values
	const safeAnchorTypes = opts?.anchorTypes?.filter((t) => VALID_NODE_TYPES.has(t));

	const typeFilter =
		safeAnchorTypes && safeAnchorTypes.length > 0
			? sql`AND kn.type = ANY(${safeAnchorTypes}::knowledge_node_type[])`
			: sql``;

	// KG-1: withIterativeScan prevents HNSW overfiltering in multi-tenant queries
	// SEC-ENC-515: Two-step — CTE for scoring (no encrypted columns), Drizzle ORM for decrypted fields
	return withIterativeScan(async (tx) => {
		// Step 1: Recursive CTE computes provenance scores. metadata (JSONB, not encrypted) is needed
		// for roi_weight extraction during recursion. display_name/description excluded (encrypted).
		const cteRows = await tx.execute(sql`
			WITH RECURSIVE provenance_path AS (
				SELECT
					kn.id AS node_id,
					kn.type::text AS node_type,
					kn.metadata,
					0 AS depth,
					(1 - (kn.embedding <=> ${embeddingStr}::halfvec(512))) AS w_semantic,
					1.0::double precision AS w_recency,
					1.0::double precision AS w_outcome,
					ARRAY[kn.id] AS path
				FROM knowledge_nodes kn
				WHERE kn.workspace_id = ${workspaceId}::uuid
					AND kn.embedding IS NOT NULL
					AND (kn.embedding <=> ${embeddingStr}::halfvec(512)) < ${semanticThreshold}
					${typeFilter}

				UNION ALL

				SELECT
					kn.id AS node_id,
					kn.type::text AS node_type,
					kn.metadata,
					p.depth + 1 AS depth,
					p.w_semantic,
					p.w_recency * EXP(-0.01 * EXTRACT(EPOCH FROM (NOW() - kl.created_at)) / 86400),
					CASE
						WHEN kn.type = 'outcome' AND kn.metadata IS NOT NULL
							THEN COALESCE((kn.metadata->>'roi_weight')::double precision, p.w_outcome)
						ELSE p.w_outcome
					END,
					p.path || kn.id
				FROM provenance_path p
				JOIN knowledge_links kl
					ON kl.source_node_id = p.node_id
					AND kl.workspace_id = ${workspaceId}::uuid
				JOIN knowledge_nodes kn
					ON kn.id = kl.target_node_id
					AND kn.workspace_id = ${workspaceId}::uuid
				WHERE p.depth < ${maxHops}
					AND NOT kn.id = ANY(p.path)

				UNION ALL

				SELECT
					kn.id AS node_id,
					kn.type::text AS node_type,
					kn.metadata,
					p.depth + 1 AS depth,
					p.w_semantic,
					p.w_recency * EXP(-0.01 * EXTRACT(EPOCH FROM (NOW() - kl.created_at)) / 86400),
					CASE
						WHEN kn.type = 'outcome' AND kn.metadata IS NOT NULL
							THEN COALESCE((kn.metadata->>'roi_weight')::double precision, p.w_outcome)
						ELSE p.w_outcome
					END,
					p.path || kn.id
				FROM provenance_path p
				JOIN knowledge_links kl
					ON kl.target_node_id = p.node_id
					AND kl.workspace_id = ${workspaceId}::uuid
				JOIN knowledge_nodes kn
					ON kn.id = kl.source_node_id
					AND kn.workspace_id = ${workspaceId}::uuid
				WHERE p.depth < ${maxHops}
					AND NOT kn.id = ANY(p.path)
			)
			SELECT DISTINCT ON (node_id)
				node_id,
				node_type,
				metadata,
				depth,
				(w_semantic * w_recency * w_outcome) AS provenance_score
			FROM provenance_path
			ORDER BY node_id, (w_semantic * w_recency * w_outcome) DESC
		`);

		const rawRows = cteRows as unknown as Array<Record<string, unknown>>;
		if (rawRows.length === 0) return [];

		// Step 2: Fetch displayName + description via Drizzle ORM (customType decrypts)
		// SEC-ENC-515a: Wrap in withKeys so encryptedText.fromDriver() can decrypt
		// SEC-ENC-515b: Filter by workspace_id to prevent cross-tenant data access
		const nodeIds = rawRows.map((r) => r.node_id as string);
		const doStep2 = async () =>
			tx
				.select({
					id: knowledgeNodes.id,
					displayName: knowledgeNodes.displayName,
					description: knowledgeNodes.description,
				})
				.from(knowledgeNodes)
				.where(
					and(inArray(knowledgeNodes.id, nodeIds), eq(knowledgeNodes.workspaceId, workspaceId)),
				);
		const nodes = opts?.envelope ? await withKeys(opts.envelope, doStep2) : await doStep2();

		const nodeMap = new Map(nodes.map((n) => [n.id, n]));

		// SEC-PROV-011: Map raw rows to ProvenanceResult with whitelisted metadata fields only.
		return rawRows
			.map((r) => {
				const meta = r.metadata as Record<string, unknown> | null;
				const node = nodeMap.get(r.node_id as string);
				return {
					nodeId: r.node_id as string,
					nodeType: r.node_type as string,
					displayName: node?.displayName ?? (r.node_id as string),
					description: node?.description ?? null,
					depth: r.depth as number,
					provenanceScore: r.provenance_score as number,
					...(r.node_type === 'decision' && meta
						? {
								decisionAction: meta.action as string | undefined,
								decisionDate: meta.decidedAt as string | undefined,
							}
						: {}),
					...(r.node_type === 'outcome' && meta
						? {
								outcomeResult: meta.result as string | undefined,
								outcomeRoiWeight: meta.roi_weight as number | undefined,
							}
						: {}),
					...(r.node_type === 'rationale' && meta
						? {
								maskedEvidenceQuote: meta.evidenceQuote as string | undefined,
							}
						: {}),
				};
			})
			.sort((a, b) => b.provenanceScore - a.provenanceScore)
			.slice(0, limit);
	});
}

/**
 * Fetch the full knowledge graph for a workspace: top nodes and their
 * interconnecting links. Used for the force-directed graph visualization.
 *
 * Limited to maxNodes (default 200) by mentionCount DESC to prevent
 * browser memory issues. Only returns links where BOTH source and target
 * are in the returned node set.
 */
export async function getGraphData(
	workspaceId: string,
	maxNodes = 200,
	envelope?: SealedEnvelope,
): Promise<{ nodes: KnowledgeNodePublic[]; links: KnowledgeLink[] }> {
	const doQuery = async () => {
		const nodes = await db
			.select(knowledgeNodeColumns)
			.from(knowledgeNodes)
			.where(eq(knowledgeNodes.workspaceId, workspaceId))
			.orderBy(desc(knowledgeNodes.mentionCount))
			.limit(maxNodes);

		if (nodes.length === 0) return { nodes: [], links: [] };

		const nodeIds = nodes.map((n) => n.id);

		const links = await db
			.select()
			.from(knowledgeLinks)
			.where(
				and(
					eq(knowledgeLinks.workspaceId, workspaceId),
					inArray(knowledgeLinks.sourceNodeId, nodeIds),
					inArray(knowledgeLinks.targetNodeId, nodeIds),
				),
			);

		return { nodes, links };
	};

	return envelope ? withKeys(envelope, doQuery) : doQuery();
}

// ─── Knowledge Extraction Log ─────────────────────────────────────────────────

/**
 * Record that knowledge extraction ran for a contact.
 * Upsert on (workspace_id, contact_id).
 */
export async function upsertExtractionLog(
	workspaceId: string,
	contactId: string,
	data: { messageHorizon?: Date; entitiesExtracted: number; llmCalled: boolean },
): Promise<void> {
	// Import the table value here to avoid the linter stripping the top-level import
	const { knowledgeExtractionLog: logTable } = await import('../schema/knowledge');
	const messageHorizonIso = data.messageHorizon?.toISOString();
	await db
		.insert(logTable)
		.values({
			workspaceId,
			contactId,
			entitiesExtracted: data.entitiesExtracted,
			llmCalled: data.llmCalled ? 1 : 0,
			messageHorizon: data.messageHorizon,
		})
		.onConflictDoUpdate({
			target: [logTable.workspaceId, logTable.contactId],
			set: {
				lastExtractedAt: sql`now()`,
				entitiesExtracted: sql`${data.entitiesExtracted}`,
				llmCalled: sql`${data.llmCalled ? 1 : 0}`,
				messageHorizon: messageHorizonIso
					? sql`COALESCE(GREATEST("knowledge_extraction_log"."message_horizon", ${messageHorizonIso}::timestamptz), ${messageHorizonIso}::timestamptz)`
					: sql`"knowledge_extraction_log"."message_horizon"`,
			},
		});
}

/**
 * Advance historical knowledge backfill progress without overwriting the
 * extraction summary fields from the entity/embedding pass.
 */
export async function updateKnowledgeBackfillProgress(
	workspaceId: string,
	contactId: string,
	data: {
		oldestMessageAt?: Date;
		oldestMessageId?: string;
		messagesScanned?: number;
		completedAt?: Date;
	},
): Promise<void> {
	const { knowledgeExtractionLog: logTable } = await import('../schema/knowledge');
	const scanned = Math.max(0, Math.floor(data.messagesScanned ?? 0));
	const oldestMessageAtIso = data.oldestMessageAt?.toISOString();
	const oldestMessageId = data.oldestMessageId;
	const completedAtIso = data.completedAt?.toISOString();
	const set: Record<string, unknown> = {
		lastExtractedAt: sql`now()`,
	};
	if (oldestMessageAtIso) {
		set.backfillOldestMessageAt = sql`COALESCE(LEAST("knowledge_extraction_log"."backfill_oldest_message_at", ${oldestMessageAtIso}::timestamptz), ${oldestMessageAtIso}::timestamptz)`;
		if (oldestMessageId) {
			set.backfillOldestMessageId = sql`
				CASE
					WHEN "knowledge_extraction_log"."backfill_oldest_message_at" IS NULL THEN ${oldestMessageId}::uuid
					WHEN ${oldestMessageAtIso}::timestamptz < "knowledge_extraction_log"."backfill_oldest_message_at" THEN ${oldestMessageId}::uuid
					WHEN ${oldestMessageAtIso}::timestamptz = "knowledge_extraction_log"."backfill_oldest_message_at"
						AND (
							"knowledge_extraction_log"."backfill_oldest_message_id" IS NULL
							OR ${oldestMessageId}::uuid < "knowledge_extraction_log"."backfill_oldest_message_id"
						)
						THEN ${oldestMessageId}::uuid
					ELSE "knowledge_extraction_log"."backfill_oldest_message_id"
				END
			`;
		}
	}
	if (scanned > 0) {
		set.backfillMessagesScanned = sql`"knowledge_extraction_log"."backfill_messages_scanned" + ${scanned}`;
	}
	if (completedAtIso) {
		set.backfillCompletedAt = sql`COALESCE("knowledge_extraction_log"."backfill_completed_at", ${completedAtIso}::timestamptz)`;
	}

	const updatedRows = await db
		.update(logTable)
		.set(set)
		.where(and(eq(logTable.workspaceId, workspaceId), eq(logTable.contactId, contactId)))
		.returning({ id: logTable.id });
	if (Array.isArray(updatedRows) && updatedRows.length > 0) return;

	await db
		.insert(logTable)
		.values({
			workspaceId,
			contactId,
			backfillOldestMessageAt: data.oldestMessageAt,
			backfillOldestMessageId: data.oldestMessageId,
			backfillMessagesScanned: scanned,
			backfillCompletedAt: data.completedAt,
		})
		.onConflictDoNothing();
}

/**
 * Get the extraction log for a specific contact.
 * Returns null if never extracted.
 */
export async function getExtractionLog(
	workspaceId: string,
	contactId: string,
): Promise<KnowledgeExtractionLogEntry | null> {
	const { knowledgeExtractionLog: logTable } = await import('../schema/knowledge');
	const rows = await db
		.select()
		.from(logTable)
		.where(and(eq(logTable.workspaceId, workspaceId), eq(logTable.contactId, contactId)))
		.limit(1);
	return rows[0] ?? null;
}

/**
 * Get contacts that need knowledge extraction — those with messages
 * newer than their last extraction (or never extracted).
 * Returns contact IDs ordered by staleness (most stale first).
 */
export async function getContactsNeedingExtraction(
	workspaceId: string,
	limit = 50,
): Promise<string[]> {
	const rows = await db.execute(sql`
		WITH contact_messages AS (
			SELECT
				c.id,
				c.source_account_id,
				MAX(m.sent_at) AS latest_message_at
			FROM contacts c
			INNER JOIN messages m
				ON m.contact_id = c.id
				AND m.workspace_id = c.workspace_id
			WHERE c.workspace_id = ${workspaceId}::uuid
			GROUP BY c.id, c.source_account_id
		),
		candidates AS (
			SELECT
				cm.id,
				cm.source_account_id,
				cm.latest_message_at,
				kel.last_extracted_at,
				kel.message_horizon
			FROM contact_messages cm
			LEFT JOIN knowledge_extraction_log kel
				ON kel.contact_id = cm.id
				AND kel.workspace_id = ${workspaceId}::uuid
			WHERE (
				kel.id IS NULL
				OR kel.message_horizon IS NULL
				OR kel.message_horizon < cm.latest_message_at
			)
		),
		ranked AS (
			SELECT
				id,
				source_account_id,
				latest_message_at,
				last_extracted_at,
				ROW_NUMBER() OVER (
					PARTITION BY source_account_id
					ORDER BY last_extracted_at ASC NULLS FIRST, latest_message_at DESC NULLS LAST
				) AS source_rank
			FROM candidates
		)
		SELECT id
		FROM ranked
		ORDER BY source_rank ASC, last_extracted_at ASC NULLS FIRST, latest_message_at DESC NULLS LAST
		LIMIT ${limit}
	`);
	return (rows as unknown as Array<{ id: string }>).map((r) => r.id);
}

/**
 * Return contact/message counts for manual knowledge analysis estimates.
 * `includeFresh=true` is used for an explicit full rebuild; the default only
 * returns contacts whose messages are newer than their extraction cursor.
 */
export async function getKnowledgeAnalysisContactCandidates(
	workspaceId: string,
	options: { includeFresh?: boolean; limit?: number } = {},
): Promise<KnowledgeAnalysisContactCandidate[]> {
	const limit = options.limit ?? 50;
	const freshnessFilter = options.includeFresh
		? sql``
		: sql`AND (
			kel.id IS NULL
			OR kel.message_horizon IS NULL
			OR kel.message_horizon < cm.latest_message_at
		)`;

	const rows = await db.execute(sql`
		WITH contact_messages AS (
			SELECT
				c.id,
				c.source_account_id,
				COUNT(m.id)::int AS message_count,
				MIN(m.sent_at) AS earliest_message_at,
				MAX(m.sent_at) AS latest_message_at
			FROM contacts c
			INNER JOIN messages m
				ON m.contact_id = c.id
				AND m.workspace_id = c.workspace_id
			WHERE c.workspace_id = ${workspaceId}::uuid
			GROUP BY c.id, c.source_account_id
		)
		, candidates AS (
			SELECT
				cm.id,
				cm.source_account_id,
				cm.message_count,
				cm.earliest_message_at,
				cm.latest_message_at,
				kel.message_horizon,
				kel.backfill_oldest_message_at,
				kel.backfill_oldest_message_id,
				kel.backfill_messages_scanned,
				kel.backfill_completed_at,
				(
					kel.id IS NULL
					OR kel.message_horizon IS NULL
					OR kel.message_horizon < cm.latest_message_at
				) AS stale,
				(
					kel.id IS NULL
					OR kel.backfill_completed_at IS NULL
				) AS backfill_incomplete
			FROM contact_messages cm
			LEFT JOIN knowledge_extraction_log kel
				ON kel.contact_id = cm.id
				AND kel.workspace_id = ${workspaceId}::uuid
			WHERE 1 = 1
			${freshnessFilter}
		),
		ranked AS (
			SELECT
				*,
				ROW_NUMBER() OVER (
					PARTITION BY source_account_id
					ORDER BY backfill_incomplete DESC, stale DESC, latest_message_at DESC NULLS LAST
				) AS source_rank
			FROM candidates
		)
		SELECT
			id,
			message_count,
			earliest_message_at,
			latest_message_at,
			message_horizon,
			backfill_oldest_message_at,
			backfill_oldest_message_id,
			backfill_messages_scanned,
			backfill_completed_at,
			stale
		FROM ranked
		ORDER BY source_rank ASC, backfill_incomplete DESC, stale DESC, latest_message_at DESC NULLS LAST
		LIMIT ${limit}
	`);

	return (
		rows as unknown as Array<{
			id: string;
			message_count?: number | string;
			messageCount?: number | string;
			earliest_message_at?: Date | string | null;
			earliestMessageAt?: Date | string | null;
			latest_message_at?: Date | string | null;
			latestMessageAt?: Date | string | null;
			message_horizon?: Date | string | null;
			messageHorizon?: Date | string | null;
			backfill_oldest_message_at?: Date | string | null;
			backfillOldestMessageAt?: Date | string | null;
			backfill_oldest_message_id?: string | null;
			backfillOldestMessageId?: string | null;
			backfill_messages_scanned?: number | string | null;
			backfillMessagesScanned?: number | string | null;
			backfill_completed_at?: Date | string | null;
			backfillCompletedAt?: Date | string | null;
			stale?: boolean;
		}>
	).map((row) => ({
		id: row.id,
		messageCount: Number(row.message_count ?? row.messageCount ?? 0),
		earliestMessageAt: coerceDate(row.earliest_message_at ?? row.earliestMessageAt),
		latestMessageAt: coerceDate(row.latest_message_at ?? row.latestMessageAt),
		messageHorizon: coerceDate(row.message_horizon ?? row.messageHorizon),
		backfillOldestMessageAt: coerceDate(
			row.backfill_oldest_message_at ?? row.backfillOldestMessageAt,
		),
		backfillOldestMessageId: row.backfill_oldest_message_id ?? row.backfillOldestMessageId ?? null,
		backfillMessagesScanned: Number(
			row.backfill_messages_scanned ?? row.backfillMessagesScanned ?? 0,
		),
		backfillCompletedAt: coerceDate(row.backfill_completed_at ?? row.backfillCompletedAt),
		stale: row.stale === true,
	}));
}

function coerceDate(value: Date | string | null | undefined): Date | null {
	if (!value) return null;
	if (value instanceof Date) return value;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}
