import { computeBlindIndex, getCurrentKeys, withKeys } from '@repo/crypto';
import type { SealedEnvelope } from '@repo/crypto';
import { and, eq, sql } from '@repo/db';
import { desc, inArray, isNotNull } from 'drizzle-orm';
import { db } from '../client';
import { contacts } from '../schema/contacts';
import {
	knowledgeContacts,
	type knowledgeExtractionLog,
	knowledgeLinks,
	knowledgeNodes,
} from '../schema/knowledge';

export type KnowledgeNode = typeof knowledgeNodes.$inferSelect;
/** KnowledgeNode without embedding or metadata — safe for browser responses. */
export type KnowledgeNodePublic = Omit<KnowledgeNode, 'embedding' | 'metadata'>;
/** Vector search result — embedding excluded, DB-computed similarity included. */
export type KnowledgeSearchResult = KnowledgeNodePublic & {
	metadata?: Record<string, unknown> | null;
	similarity: number;
};
export type KnowledgeContact = typeof knowledgeContacts.$inferSelect;
export type KnowledgeExtractionLogEntry = typeof knowledgeExtractionLog.$inferSelect;

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
	displayName?: string;
	description?: string;
	embedding?: number[];
	mentionCount?: number;
	lastSeenAt?: Date;
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
	createdAt: knowledgeNodes.createdAt,
};

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
		if (data.displayName !== undefined) updates.displayName = data.displayName;
		if (data.description !== undefined) updates.description = data.description;
		if (data.embedding !== undefined) updates.embedding = data.embedding;
		if (data.mentionCount !== undefined) updates.mentionCount = data.mentionCount;
		if (data.lastSeenAt !== undefined) updates.lastSeenAt = data.lastSeenAt;

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
			const keys = getCurrentKeys();
			const queryHash = computeBlindIndex(query.toLowerCase(), keys.bik);
			const rows = await db
				.select(knowledgeNodeColumns)
				.from(knowledgeNodes)
				.where(
					and(
						eq(knowledgeNodes.workspaceId, workspaceId),
						eq(knowledgeNodes.nameBlindIndex, queryHash),
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
): Promise<KnowledgeContact> {
	const result = await db
		.insert(knowledgeContacts)
		.values({
			workspaceId,
			knowledgeNodeId: nodeId,
			contactId,
			relationType,
			strength,
		})
		.onConflictDoUpdate({
			target: [
				knowledgeContacts.knowledgeNodeId,
				knowledgeContacts.contactId,
				knowledgeContacts.relationType,
			],
			set: {
				evidenceCount: sql`${knowledgeContacts.evidenceCount} + 1`,
				strength,
				lastEvidenceAt: sql`now()`,
			},
		})
		.returning();
	const row = result[0];
	if (!row) throw new Error('linkContactToKnowledge: insert returned no rows');
	return row;
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

			// Step 3: Add merged node's name to survivor's aliases + combine mention counts
			await tx.execute(sql`
			UPDATE knowledge_nodes
			SET
				aliases = array_append(aliases, ${mergedNode[0]?.name}),
				mention_count = mention_count + ${mergedNode[0]?.mentionCount ?? 0}
			WHERE id = ${survivorId}::uuid
			AND workspace_id = ${workspaceId}::uuid
		`);

			// Step 4: Delete remaining conflict links and the merged node
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
		const keys = getCurrentKeys();
		const nameHash = computeBlindIndex(normalizedName, keys.bik);
		const result = await db
			.select()
			.from(knowledgeNodes)
			.where(
				and(
					eq(knowledgeNodes.workspaceId, workspaceId),
					eq(knowledgeNodes.nameBlindIndex, nameHash),
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
): Promise<KnowledgeLink> {
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
				messageHorizon: data.messageHorizon ?? sql`"knowledge_extraction_log"."message_horizon"`,
			},
		});
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
		SELECT c.id
		FROM contacts c
		LEFT JOIN knowledge_extraction_log kel
			ON kel.contact_id = c.id
			AND kel.workspace_id = c.workspace_id
		WHERE c.workspace_id = ${workspaceId}::uuid
		AND (
			kel.id IS NULL
			OR kel.message_horizon < (
				SELECT MAX(m.sent_at)
				FROM messages m
				WHERE m.contact_id = c.id
				AND m.workspace_id = c.workspace_id
			)
		)
		ORDER BY kel.last_extracted_at ASC NULLS FIRST
		LIMIT ${limit}
	`);
	return (rows as unknown as Array<{ id: string }>).map((r) => r.id);
}
