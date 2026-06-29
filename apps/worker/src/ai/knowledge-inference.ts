import {
	inferSimilarityRelationshipCandidates,
	isFeatureEnabled,
	listContactIdsByKnowledge,
	listKnowledgeNodes,
	upsertKnowledgeRelationshipCandidate,
} from '@repo/db';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum shared-contact co-occurrences to create a related_to review candidate. */
const MIN_CO_OCCURRENCE = 2;

export interface KnowledgeInferenceResult {
	workspaceId: string;
	nodesProcessed: number;
	candidateRelationships: number;
	coOccurrenceCandidates: number;
	coOccurrenceLinks: number;
	confirmedLinks: number;
	similarityCandidates: number;
	similarityLinks: number;
	totalLinks: number;
	skippedReason?: 'feature_flag_off' | 'too_few_nodes';
}

// ─── Core inference pipeline ──────────────────────────────────────────────────

/**
 * Run the knowledge inference pipeline for a workspace.
 *
 * Two strategies for creating reviewable relationship candidates:
 *
 * 1. **Co-occurrence**: Two knowledge nodes that share ≥ MIN_CO_OCCURRENCE contacts
 *    are linked with Jaccard similarity weight: |A ∩ B| / |A ∪ B|.
 *    Prevents generic nodes from forming max-weight candidates to everything.
 *
 * 2. **Embedding similarity (SQL-native)**: Uses pgvector <=> operator in PostgreSQL
 *    to find all node pairs with cosine distance < 0.30 (similarity >= 0.70).
 *    Replaces the previous O(n²) in-memory loop, removing the 500-node ceiling.
 *
 * Both paths are per-error resilient: one failed candidate does not abort the run.
 * Candidates are review-only until direct quoted evidence promotes an edge into
 * knowledge_links.
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
			candidateRelationships: 0,
			coOccurrenceCandidates: 0,
			coOccurrenceLinks: 0,
			confirmedLinks: 0,
			similarityCandidates: 0,
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
			candidateRelationships: 0,
			coOccurrenceCandidates: 0,
			coOccurrenceLinks: 0,
			confirmedLinks: 0,
			similarityCandidates: 0,
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

	let coOccurrenceCandidates = 0;
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
				await upsertKnowledgeRelationshipCandidate(workspaceId, {
					sourceNodeId: aId,
					targetNodeId: bId,
					linkType: 'related_to',
					evidenceKind: 'contact_cooccurrence',
					confidence: weight,
					promotionStatus: 'review_only',
					metadata: {
						source: 'knowledge_inference',
						method: 'shared_contact_jaccard',
						sharedContactCount: count,
						contactsA: contactsA.length,
						contactsB: contactsB.length,
						unionSize,
					},
				});
				coOccurrenceCandidates++;
			} catch (err) {
				console.error(
					'[knowledge-inference] Co-occurrence candidate failed:',
					(err as Error).message,
				);
			}
		}
	}

	console.log(
		`[knowledge-inference] Co-occurrence pass: ${coOccurrenceCandidates} review candidates stored`,
	);

	// ── 2. Embedding similarity (SQL-native, uses HNSW index) ────────────────
	let similarityCandidates = 0;
	try {
		similarityCandidates = await inferSimilarityRelationshipCandidates(workspaceId, 0.3);
	} catch (err) {
		console.error(
			'[knowledge-inference] SQL similarity candidate pass failed:',
			(err as Error).message,
		);
	}

	console.log(`[knowledge-inference] Similarity pass: ${similarityCandidates} candidates stored`);
	console.log(
		`[knowledge-inference] Done for workspace=${workspaceId.slice(0, 8)}: ${coOccurrenceCandidates + similarityCandidates} review candidates, 0 confirmed links`,
	);
	return {
		workspaceId,
		nodesProcessed: nodes.length,
		candidateRelationships: coOccurrenceCandidates + similarityCandidates,
		coOccurrenceCandidates,
		coOccurrenceLinks: 0,
		confirmedLinks: 0,
		similarityCandidates,
		similarityLinks: 0,
		totalLinks: 0,
	};
}
