import {
	createKnowledgeLink,
	inferSimilarityLinks,
	isFeatureEnabled,
	listContactIdsByKnowledge,
	listKnowledgeNodes,
} from '@repo/db';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum shared-contact co-occurrences to create a related_to link. */
const MIN_CO_OCCURRENCE = 2;

export interface KnowledgeInferenceResult {
	workspaceId: string;
	nodesProcessed: number;
	coOccurrenceLinks: number;
	similarityLinks: number;
	totalLinks: number;
	skippedReason?: 'feature_flag_off' | 'too_few_nodes';
}

// ─── Core inference pipeline ──────────────────────────────────────────────────

/**
 * Run the knowledge inference pipeline for a workspace.
 *
 * Two strategies for creating knowledge_links edges:
 *
 * 1. **Co-occurrence**: Two knowledge nodes that share ≥ MIN_CO_OCCURRENCE contacts
 *    are linked with Jaccard similarity weight: |A ∩ B| / |A ∪ B|.
 *    Prevents generic nodes from forming max-weight edges to everything.
 *
 * 2. **Embedding similarity (SQL-native)**: Uses pgvector <=> operator in PostgreSQL
 *    to find all node pairs with cosine distance < 0.30 (similarity ≥ 0.70).
 *    Replaces the previous O(n²) in-memory loop, removing the 500-node ceiling.
 *
 * Both paths are per-error resilient — one failed link does not abort the run.
 * Feature-flag gated: `knowledge_links` must be enabled for the workspace.
 */
export async function runKnowledgeInference(
	workspaceId: string,
	options: { requireFeatureFlag?: boolean } = {},
): Promise<KnowledgeInferenceResult> {
	const requireFeatureFlag = options.requireFeatureFlag ?? true;
	const enabled = requireFeatureFlag
		? await isFeatureEnabled('knowledge_links', workspaceId)
		: true;
	if (!enabled) {
		console.log('[knowledge-inference] Feature flag off — skipping');
		return {
			workspaceId,
			nodesProcessed: 0,
			coOccurrenceLinks: 0,
			similarityLinks: 0,
			totalLinks: 0,
			skippedReason: 'feature_flag_off',
		};
	}

	const nodes = await listKnowledgeNodes(workspaceId, { limit: 5000 });
	if (nodes.length < 2) {
		console.log(`[knowledge-inference] Too few nodes (${nodes.length}) — skipping`);
		return {
			workspaceId,
			nodesProcessed: nodes.length,
			coOccurrenceLinks: 0,
			similarityLinks: 0,
			totalLinks: 0,
			skippedReason: 'too_few_nodes',
		};
	}

	console.log(
		`[knowledge-inference] Starting for workspace=${workspaceId.slice(0, 8)}: ${nodes.length} nodes`,
	);

	// ── 1. Co-occurrence via shared contacts ─────────────────────────────────

	// nodeId → contactId[]
	const nodeContacts = new Map<string, string[]>();
	for (const node of nodes) {
		try {
			const ids = await listContactIdsByKnowledge(node.id, workspaceId);
			nodeContacts.set(node.id, ids);
		} catch {
			nodeContacts.set(node.id, []);
		}
	}

	// contactId → nodeId[] (inverted index)
	const contactNodes = new Map<string, string[]>();
	for (const [nodeId, contactIds] of nodeContacts) {
		for (const contactId of contactIds) {
			const arr = contactNodes.get(contactId) ?? [];
			arr.push(nodeId);
			contactNodes.set(contactId, arr);
		}
	}

	// Count co-occurrences (sorted pair key "aId:bId" to avoid double-counting)
	const coOccurrences = new Map<string, number>();
	for (const nodeIds of contactNodes.values()) {
		for (let i = 0; i < nodeIds.length; i++) {
			for (let j = i + 1; j < nodeIds.length; j++) {
				const pair = [nodeIds[i], nodeIds[j]].sort().join(':');
				coOccurrences.set(pair, (coOccurrences.get(pair) ?? 0) + 1);
			}
		}
	}

	let coLinks = 0;
	for (const [pair, count] of coOccurrences) {
		if (count >= MIN_CO_OCCURRENCE) {
			const parts = pair.split(':');
			const aId = parts[0] ?? '';
			const bId = parts[1] ?? '';
			if (!aId || !bId) continue;

			// Jaccard similarity: |A ∩ B| / |A ∪ B|
			// More accurate than count/10 — prevents generic nodes from connecting to everything
			const contactsA = nodeContacts.get(aId) ?? [];
			const contactsB = nodeContacts.get(bId) ?? [];
			const unionSize = contactsA.length + contactsB.length - count;
			const weight = unionSize > 0 ? count / unionSize : 0;

			// Skip negligible edges (Jaccard < 0.05 = less than 5% overlap)
			if (weight < 0.05) continue;

			try {
				await createKnowledgeLink(workspaceId, aId, bId, 'related_to', weight, {
					evidenceKind: 'contact_cooccurrence',
					confidence: weight,
					metadata: {
						source: 'knowledge_inference',
						method: 'shared_contact_jaccard',
						sharedContactCount: count,
						contactsA: contactsA.length,
						contactsB: contactsB.length,
						unionSize,
					},
				});
				coLinks++;
			} catch (err) {
				console.error('[knowledge-inference] Co-occurrence link failed:', (err as Error).message);
			}
		}
	}

	console.log(`[knowledge-inference] Co-occurrence pass: ${coLinks} links created`);

	// ── 2. Embedding similarity (SQL-native, uses HNSW index) ────────────────
	let simLinks = 0;
	try {
		simLinks = await inferSimilarityLinks(workspaceId, 0.3);
	} catch (err) {
		console.error('[knowledge-inference] SQL similarity pass failed:', (err as Error).message);
	}

	console.log(`[knowledge-inference] Similarity pass: ${simLinks} links created`);
	console.log(
		`[knowledge-inference] Done for workspace=${workspaceId.slice(0, 8)}: ${coLinks + simLinks} total links`,
	);
	return {
		workspaceId,
		nodesProcessed: nodes.length,
		coOccurrenceLinks: coLinks,
		similarityLinks: simLinks,
		totalLinks: coLinks + simLinks,
	};
}
