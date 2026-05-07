'use server';

import { workspaceAction } from '@/lib/safe-action';
import { track } from '@/lib/track';
import { deriveKeys, maskEntities, prefilterEntities, unwrapWrk, withKeys } from '@repo/crypto';
import {
	and,
	db,
	eq,
	getContactsByIds,
	getGraphData,
	getKnowledgeNeighbors,
	getKnowledgeNode,
	getSharedKnowledge,
	knowledgeContacts,
	knowledgeLinks,
	knowledgeNodes,
	listContactIdsByKnowledge,
	listContactsByKnowledge,
	listKnowledgeByContact,
	listKnowledgeNodes,
	mergeKnowledgeNodes,
	searchKnowledgeNodes,
	sql,
} from '@repo/db';
import { z } from 'zod';

const NODE_TYPES = ['topic', 'project', 'organization', 'technology', 'sector', 'concept'] as const;

async function generateQueryEmbedding(text: string): Promise<number[] | undefined> {
	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) return undefined;
	try {
		const response = await fetch('https://api.openai.com/v1/embeddings', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model: 'text-embedding-3-small',
				input: text,
				dimensions: 512,
			}),
		});
		if (!response.ok) return undefined;
		const data = (await response.json()) as {
			data: Array<{ embedding: number[] }>;
		};
		return data.data[0]?.embedding;
	} catch {
		return undefined;
	}
}

/**
 * List knowledge nodes for the workspace, with optional type filter and pagination.
 * Enriches each node with contactCount + up to 3 contact first-name previews.
 * CRITICAL: Uses workspaceAction — workspaceId never from client.
 */
export const listKnowledgeNodesAction = workspaceAction
	.schema(
		z.object({
			type: z.enum(NODE_TYPES).optional(),
			query: z.string().optional(),
			limit: z.number().max(50).default(20),
			offset: z.number().default(0),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		let nodes: Awaited<ReturnType<typeof listKnowledgeNodes>>;
		if (parsedInput.query?.trim()) {
			const query = parsedInput.query.trim();
			// ELM-mask the query before embedding (SEC-122)
			const wrk = await unwrapWrk(ctx.envelope);
			const keys = await deriveKeys(wrk, ctx.workspaceId, ctx.envelope.wrkVersion);
			const detected = prefilterEntities(query);
			const maskedQuery = maskEntities(query, keys.bik, detected).maskedText;
			const embedding = await generateQueryEmbedding(maskedQuery);

			nodes = await searchKnowledgeNodes(ctx.workspaceId, query, embedding, ctx.envelope);

			track(ctx.workspaceId, ctx.session.user.id, 'knowledge.searched', {
				query_length: query.length,
				result_count: nodes.length,
				search_mode: embedding ? 'semantic' : 'text',
			});
		} else {
			nodes = await listKnowledgeNodes(
				ctx.workspaceId,
				{
					type: parsedInput.type,
					limit: parsedInput.limit,
					offset: parsedInput.offset,
				},
				ctx.envelope,
			);
		}

		if (nodes.length === 0) return nodes;

		// Batch-fetch contact IDs per node (no encryption needed)
		const contactIdsByNode = await Promise.all(
			nodes.map(async (n) => ({
				nodeId: n.id,
				contactIds: await listContactIdsByKnowledge(n.id, ctx.workspaceId),
			})),
		);

		// Collect unique contact IDs for preview resolution (first 3 per node)
		const previewContactIds = new Set<string>();
		const nodeContactMap = new Map<string, string[]>();
		for (const { nodeId, contactIds } of contactIdsByNode) {
			nodeContactMap.set(nodeId, contactIds);
			for (const cid of contactIds.slice(0, 3)) {
				previewContactIds.add(cid);
			}
		}

		// Resolve contact first names (needs envelope for decryption)
		let contactNameMap = new Map<string, string>();
		if (previewContactIds.size > 0 && ctx.envelope) {
			const contactRows = await getContactsByIds(
				ctx.workspaceId,
				[...previewContactIds],
				ctx.envelope,
			);
			contactNameMap = new Map(
				contactRows.map((c) => [c.id, (c.firstName as string) || 'Someone']),
			);
		}

		// Enrich nodes with contact previews
		return nodes.map((n) => {
			const contactIds = nodeContactMap.get(n.id) ?? [];
			const contactPreviews = contactIds
				.slice(0, 3)
				.map((cid) => contactNameMap.get(cid) ?? 'Someone');
			return {
				...n,
				contactCount: contactIds.length,
				contactPreviews,
			};
		});
	});

/**
 * Get a single knowledge node with its linked contacts.
 * Verifies workspace ownership before returning — prevents BOLA.
 * CRITICAL: Uses workspaceAction — workspaceId never from client.
 */
export const getKnowledgeNodeAction = workspaceAction
	.schema(z.object({ id: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		const node = await getKnowledgeNode(ctx.workspaceId, parsedInput.id, ctx.envelope);
		if (!node) return null;

		track(ctx.workspaceId, ctx.session.user.id, 'knowledge.viewed', {
			item_type: node.type,
		});

		// SEC-006: Project only the fields the UI needs — never send phone/email/notes/blind indexes to the client
		const contactRows = await listContactsByKnowledge(node.id, ctx.workspaceId, ctx.envelope);
		const contacts = contactRows.map((r) => ({
			id: r.contact.id,
			firstName: r.contact.firstName,
			lastName: r.contact.lastName,
		}));

		return { node, contacts };
	});

/**
 * Get knowledge nodes linked to a specific contact.
 * Scopes by workspaceId — prevents BOLA (SEC-114).
 * CRITICAL: Uses workspaceAction — workspaceId never from client.
 */
export const getContactKnowledgeAction = workspaceAction
	.schema(z.object({ contactId: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		return await listKnowledgeByContact(parsedInput.contactId, ctx.workspaceId, ctx.envelope);
	});

/**
 * Get neighboring knowledge nodes (linked entities) for a node.
 * Returns both outbound and inbound edges with direction and link type.
 * CRITICAL: Uses workspaceAction — workspaceId never from client.
 */
export const getKnowledgeNeighborsAction = workspaceAction
	.schema(z.object({ nodeId: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		return await getKnowledgeNeighbors(parsedInput.nodeId, ctx.workspaceId, ctx.envelope);
	});

/**
 * Get knowledge nodes shared between two contacts.
 * Used to surface common ground when viewing a node from a contact context.
 * CRITICAL: Uses workspaceAction — workspaceId never from client.
 */
export const getSharedKnowledgeAction = workspaceAction
	.schema(z.object({ contactIdA: z.string().uuid(), contactIdB: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		return await getSharedKnowledge(
			parsedInput.contactIdA,
			parsedInput.contactIdB,
			ctx.workspaceId,
			ctx.envelope,
		);
	});

/**
 * Merge two knowledge nodes: transfer links from mergedId to survivorId.
 * SEC-114: Both IDs verified via workspaceAction + UUID schema (SEC-119).
 * BOLA prevention: verifies both nodes exist in workspace before merging.
 * CRITICAL: Uses workspaceAction — workspaceId never from client.
 */
export const mergeKnowledgeNodesAction = workspaceAction
	.schema(
		z.object({
			survivorId: z.string().uuid(),
			mergedId: z.string().uuid(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const { survivorId, mergedId } = parsedInput;

		if (survivorId === mergedId) {
			throw new Error('Cannot merge a node with itself');
		}

		// BOLA prevention: verify both nodes belong to this workspace
		const [survivor, merged] = await Promise.all([
			getKnowledgeNode(ctx.workspaceId, survivorId, ctx.envelope),
			getKnowledgeNode(ctx.workspaceId, mergedId, ctx.envelope),
		]);

		if (!survivor) throw new Error('Survivor node not found in workspace');
		if (!merged) throw new Error('Merged node not found in workspace');

		await mergeKnowledgeNodes(ctx.workspaceId, survivorId, mergedId, ctx.envelope);

		return { success: true };
	});

/**
 * Find candidate nodes for merging with a given node.
 * Searches for nodes with similar names and returns top 5.
 * CRITICAL: Uses workspaceAction — workspaceId never from client.
 */
export const findMergeCandidatesAction = workspaceAction
	.schema(z.object({ nodeId: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		const node = await getKnowledgeNode(ctx.workspaceId, parsedInput.nodeId, ctx.envelope);
		if (!node) return [];

		const similar = await searchKnowledgeNodes(ctx.workspaceId, node.name, undefined, ctx.envelope);
		return similar.filter((n) => n.id !== parsedInput.nodeId).slice(0, 5);
	});

/**
 * Fetch graph data for the knowledge graph visualization.
 * Returns top nodes by mention count and their interconnecting links.
 * CRITICAL: Uses workspaceAction — workspaceId never from client.
 */
export const getGraphDataAction = workspaceAction
	.schema(z.object({ maxNodes: z.number().max(500).default(200) }))
	.action(async ({ parsedInput, ctx }) => {
		return await getGraphData(ctx.workspaceId, parsedInput.maxNodes, ctx.envelope);
	});

// ─── Decision Provenance Graph (Phase 4) ──────────────────────────────────

/**
 * Fetch all decisions involving a contact, with their cited rationales.
 * SEC-PROV-007: workspace_id enforced on both knowledge_contacts and knowledge_nodes JOINs.
 * SEC-PROV-011: Only whitelisted metadata fields (action, decidedAt) returned.
 * CRITICAL: Uses workspaceAction — workspaceId never from client.
 */
export const getContactDecisionsAction = workspaceAction
	.schema(z.object({ contactId: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		return withKeys(ctx.envelope, async () => {
			// 1. Fetch decision nodes linked to this contact via 'decided' relation
			// SEC-PROV-007: workspace_id on both tables
			const decisionRows = await db
				.select({
					id: knowledgeNodes.id,
					displayName: knowledgeNodes.displayName,
					description: knowledgeNodes.description,
					metadata: knowledgeNodes.metadata,
					createdAt: knowledgeNodes.createdAt,
				})
				.from(knowledgeContacts)
				.innerJoin(
					knowledgeNodes,
					and(
						eq(knowledgeContacts.knowledgeNodeId, knowledgeNodes.id),
						eq(knowledgeNodes.workspaceId, ctx.workspaceId),
					),
				)
				.where(
					and(
						eq(knowledgeContacts.contactId, parsedInput.contactId),
						eq(knowledgeContacts.workspaceId, ctx.workspaceId),
						eq(knowledgeContacts.relationType, 'decided'),
						eq(knowledgeNodes.type, 'decision'),
					),
				)
				.orderBy(sql`${knowledgeNodes.createdAt} desc`);

			if (decisionRows.length === 0) return [];

			// 2. For each decision, fetch cited rationales via 'cites' links
			const decisionIds = decisionRows.map((d) => d.id);

			// Get all cites links from these decisions to rationale nodes
			// SEC-PROV-007: workspace_id on both knowledge_links and knowledge_nodes
			const rationaleRows = await db
				.select({
					sourceNodeId: knowledgeLinks.sourceNodeId,
					rationaleId: knowledgeNodes.id,
					rationaleDisplayName: knowledgeNodes.displayName,
				})
				.from(knowledgeLinks)
				.innerJoin(
					knowledgeNodes,
					and(
						eq(knowledgeLinks.targetNodeId, knowledgeNodes.id),
						eq(knowledgeNodes.workspaceId, ctx.workspaceId),
					),
				)
				.where(
					and(
						sql`${knowledgeLinks.sourceNodeId} = ANY(${decisionIds}::uuid[])`,
						eq(knowledgeLinks.workspaceId, ctx.workspaceId),
						eq(knowledgeLinks.linkType, 'cites'),
						eq(knowledgeNodes.type, 'rationale'),
					),
				);

			// Group rationales by decision
			const rationalesByDecision = new Map<string, string[]>();
			for (const r of rationaleRows) {
				const existing = rationalesByDecision.get(r.sourceNodeId) ?? [];
				existing.push(r.rationaleDisplayName);
				rationalesByDecision.set(r.sourceNodeId, existing);
			}

			// 3. Build result with whitelisted metadata fields only (SEC-PROV-011)
			return decisionRows.map((d) => {
				const meta = d.metadata as Record<string, unknown> | null;
				return {
					id: d.id,
					displayName: d.displayName,
					action: (meta?.action as string) ?? null,
					decidedAt: (meta?.decidedAt as string) ?? null,
					entityId: (meta?.entityId as string) ?? null,
					entityType: (meta?.entityType as string) ?? null,
					rationales: rationalesByDecision.get(d.id) ?? [],
				};
			});
		});
	});

/**
 * Fetch the decision trail for a deal — chronological provenance chain.
 * Queries decision nodes where metadata->>'entityId' matches the deal ID.
 * SEC-PROV-007: workspace_id on all JOINs.
 * SEC-PROV-011: Only whitelisted metadata fields returned.
 * SEC-PROV-013: GIN index on metadata ensures this query is fast.
 * CRITICAL: Uses workspaceAction — workspaceId never from client.
 */
export const getDealDecisionTrailAction = workspaceAction
	.schema(z.object({ dealId: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		return withKeys(ctx.envelope, async () => {
			// 1. Fetch decision nodes for this deal via metadata GIN index
			// SEC-PROV-007: workspace_id filter, SEC-PROV-013: GIN index on metadata
			const decisionRows = await db
				.select({
					id: knowledgeNodes.id,
					displayName: knowledgeNodes.displayName,
					description: knowledgeNodes.description,
					metadata: knowledgeNodes.metadata,
					createdAt: knowledgeNodes.createdAt,
				})
				.from(knowledgeNodes)
				.where(
					and(
						eq(knowledgeNodes.workspaceId, ctx.workspaceId),
						eq(knowledgeNodes.type, 'decision'),
						sql`${knowledgeNodes.metadata}->>'entityId' = ${parsedInput.dealId}`,
						sql`${knowledgeNodes.metadata}->>'entityType' = 'deal'`,
					),
				)
				.orderBy(sql`(${knowledgeNodes.metadata}->>'decidedAt')::timestamptz asc nulls last`);

			if (decisionRows.length === 0) return [];

			// 2. Fetch cited rationales for all decisions
			const decisionIds = decisionRows.map((d) => d.id);

			const rationaleRows = await db
				.select({
					sourceNodeId: knowledgeLinks.sourceNodeId,
					rationaleDisplayName: knowledgeNodes.displayName,
				})
				.from(knowledgeLinks)
				.innerJoin(
					knowledgeNodes,
					and(
						eq(knowledgeLinks.targetNodeId, knowledgeNodes.id),
						eq(knowledgeNodes.workspaceId, ctx.workspaceId),
					),
				)
				.where(
					and(
						sql`${knowledgeLinks.sourceNodeId} = ANY(${decisionIds}::uuid[])`,
						eq(knowledgeLinks.workspaceId, ctx.workspaceId),
						eq(knowledgeLinks.linkType, 'cites'),
						eq(knowledgeNodes.type, 'rationale'),
					),
				);

			// 3. Check for outcome nodes linked via 'led_to' from decisions
			const outcomeRows = await db
				.select({
					sourceNodeId: knowledgeLinks.sourceNodeId,
					outcomeDisplayName: knowledgeNodes.displayName,
					outcomeMetadata: knowledgeNodes.metadata,
				})
				.from(knowledgeLinks)
				.innerJoin(
					knowledgeNodes,
					and(
						eq(knowledgeLinks.targetNodeId, knowledgeNodes.id),
						eq(knowledgeNodes.workspaceId, ctx.workspaceId),
					),
				)
				.where(
					and(
						sql`${knowledgeLinks.sourceNodeId} = ANY(${decisionIds}::uuid[])`,
						eq(knowledgeLinks.workspaceId, ctx.workspaceId),
						eq(knowledgeLinks.linkType, 'led_to'),
						eq(knowledgeNodes.type, 'outcome'),
					),
				);

			// Group rationales and outcomes by decision
			const rationalesByDecision = new Map<string, string[]>();
			for (const r of rationaleRows) {
				const existing = rationalesByDecision.get(r.sourceNodeId) ?? [];
				existing.push(r.rationaleDisplayName);
				rationalesByDecision.set(r.sourceNodeId, existing);
			}

			const outcomesByDecision = new Map<
				string,
				{ displayName: string; result: string | null }[]
			>();
			for (const o of outcomeRows) {
				const existing = outcomesByDecision.get(o.sourceNodeId) ?? [];
				const meta = o.outcomeMetadata as Record<string, unknown> | null;
				existing.push({
					displayName: o.outcomeDisplayName,
					result: (meta?.result as string) ?? null,
				});
				outcomesByDecision.set(o.sourceNodeId, existing);
			}

			// 4. Build chronological trail with whitelisted metadata (SEC-PROV-011)
			return decisionRows.map((d) => {
				const meta = d.metadata as Record<string, unknown> | null;
				return {
					id: d.id,
					displayName: d.displayName,
					action: (meta?.action as string) ?? null,
					decidedAt: (meta?.decidedAt as string) ?? null,
					rationales: rationalesByDecision.get(d.id) ?? [],
					outcomes: outcomesByDecision.get(d.id) ?? [],
				};
			});
		});
	});
