import { withKeys } from '@repo/crypto';
import type { SealedEnvelope } from '@repo/crypto';
import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '../client';
import { outcomes } from '../schema/outcomes';

export type Outcome = typeof outcomes.$inferSelect;
export type OutcomeType =
	| 'deal_closed'
	| 'commitment_fulfilled'
	| 'commitment_missed'
	| 'goal_completed'
	| 'intro_connected'
	| 'relationship_health';
export type OutcomeResult = 'positive' | 'negative' | 'neutral';

export interface CreateOutcomeInput {
	contactId?: string;
	type: OutcomeType;
	result: OutcomeResult;
	/** Category labels only — no PII */
	contextLabels?: string[];
	/** Plaintext notes — will be encrypted by encryptedText customType */
	notes?: string;
	/** Derived from contextLabels — never from raw notes */
	embedding?: number[];
	occurredAt?: Date;
}

export interface OutcomeStats {
	type: string;
	total: number;
	positive: number;
	negative: number;
	neutral: number;
	winRate: number;
}

/**
 * SEC-120: Runtime allowlist for context_labels prefixes.
 * Labels must be `prefix:value` format with a known prefix.
 * Prevents PII from leaking into embeddings (Vec2Text recovery risk).
 */
const ALLOWED_LABEL_PREFIXES = new Set([
	'deal_type',
	'stage',
	'value_range',
	'commitment_type',
	'assignee',
	'confidence',
	'goal_type',
	'completion',
	'intro_context',
	'trend',
	'label',
]);

function validateContextLabels(labels: string[]): void {
	for (const label of labels) {
		const colonIdx = label.indexOf(':');
		if (colonIdx === -1) {
			throw new Error(`SEC-120: context_label must be "prefix:value" format, got "${label}"`);
		}
		const prefix = label.slice(0, colonIdx);
		if (!ALLOWED_LABEL_PREFIXES.has(prefix)) {
			throw new Error(
				`SEC-120: unknown context_label prefix "${prefix}". Allowed: ${[...ALLOWED_LABEL_PREFIXES].join(', ')}`,
			);
		}
	}
}

/**
 * Create an outcome record for a terminal event.
 * Caller must wrap in withKeys() if notes is provided (encryptedText requires key context).
 * Embeddings must be derived from contextLabels, never from raw notes.
 */
export async function createOutcome(
	workspaceId: string,
	data: CreateOutcomeInput,
): Promise<Outcome> {
	if (data.contextLabels?.length) {
		validateContextLabels(data.contextLabels);
	}

	const result = await db
		.insert(outcomes)
		.values({
			workspaceId,
			contactId: data.contactId,
			type: data.type,
			result: data.result,
			contextLabels: data.contextLabels ?? [],
			notes: data.notes,
			embedding: data.embedding,
			occurredAt: data.occurredAt ?? new Date(),
		})
		.returning();
	const row = result[0];
	if (!row) throw new Error('createOutcome: insert returned no rows');
	return row;
}

/**
 * List outcomes for a workspace, optionally filtered by contact.
 * Returns most recent first.
 * SEC-ENC-515: wraps in withKeys() when envelope provided so encryptedText.fromDriver() decrypts notes.
 */
export async function listOutcomes(
	workspaceId: string,
	contactId?: string,
	envelope?: SealedEnvelope,
): Promise<Outcome[]> {
	const conditions = [eq(outcomes.workspaceId, workspaceId)];
	if (contactId) {
		conditions.push(eq(outcomes.contactId, contactId));
	}

	const doQuery = async () =>
		db
			.select()
			.from(outcomes)
			.where(and(...conditions))
			.orderBy(desc(outcomes.occurredAt))
			.limit(100);

	return envelope ? withKeys(envelope, doQuery) : doQuery();
}

/**
 * Search outcomes by cosine similarity over context_label embeddings.
 * workspace_id enforced in WHERE — prevents cross-tenant precedent leakage.
 * SEC-ENC-515: Two-step pattern — raw SQL for IDs + similarity (no encrypted columns),
 * then Drizzle ORM for full rows so encryptedText.fromDriver() decrypts notes.
 */
export async function searchOutcomes(
	workspaceId: string,
	queryEmbedding: number[],
	limit = 10,
	envelope?: SealedEnvelope,
): Promise<Outcome[]> {
	const embeddingStr = `[${queryEmbedding.join(',')}]`;

	const doQuery = async () => {
		// Step 1: Raw SQL for IDs only (no encrypted columns)
		const idRows = await db.execute(sql`
			SELECT id
			FROM outcomes
			WHERE workspace_id = ${workspaceId}::uuid
			AND embedding IS NOT NULL
			ORDER BY embedding <=> ${embeddingStr}::vector
			LIMIT ${limit}
		`);
		const ids = (idRows as unknown as Array<{ id: string }>).map((r) => r.id);
		if (ids.length === 0) return [];

		// Step 2: Drizzle ORM for full rows — customType decrypts notes
		return db.select().from(outcomes).where(inArray(outcomes.id, ids));
	};

	return envelope ? withKeys(envelope, doQuery) : doQuery();
}

/**
 * Aggregate outcome counts and win rate by type for a workspace.
 * Used for the dashboard stats card.
 */
export async function getOutcomeStats(workspaceId: string): Promise<OutcomeStats[]> {
	const rows = await db
		.select({
			type: outcomes.type,
			total: count(),
			positive: sql<number>`count(*) filter (where result = 'positive')`,
			negative: sql<number>`count(*) filter (where result = 'negative')`,
			neutral: sql<number>`count(*) filter (where result = 'neutral')`,
		})
		.from(outcomes)
		.where(eq(outcomes.workspaceId, workspaceId))
		.groupBy(outcomes.type);

	return rows.map((r) => ({
		type: r.type,
		total: Number(r.total),
		positive: Number(r.positive),
		negative: Number(r.negative),
		neutral: Number(r.neutral),
		winRate: Number(r.total) > 0 ? Number(r.positive) / Number(r.total) : 0,
	}));
}

/**
 * Check whether an outcome of a given type was recorded for a contact within
 * the past windowDays (default 30). Used to prevent duplicate relationship_health
 * outcomes from flooding the table on every health-scoring run.
 */
export async function hasRecentOutcome(
	workspaceId: string,
	contactId: string,
	type: OutcomeType,
	windowDays = 30,
): Promise<boolean> {
	const since = new Date();
	since.setDate(since.getDate() - windowDays);

	const rows = await db
		.select({ id: outcomes.id })
		.from(outcomes)
		.where(
			and(
				eq(outcomes.workspaceId, workspaceId),
				eq(outcomes.contactId, contactId),
				eq(outcomes.type, type),
				gte(outcomes.occurredAt, since),
			),
		)
		.limit(1);

	return rows.length > 0;
}
