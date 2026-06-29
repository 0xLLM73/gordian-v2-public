'use server';

import { deriveKeys, maskEntities, prefilterEntities, unwrapWrk, withKeys } from '@repo/crypto';
import { getOpenAIApiKey } from '@repo/crypto/local-secrets';
import {
	and,
	createKnowledgeEvidence,
	createKnowledgeNode,
	db,
	eq,
	getCalibration,
	getContactsByIds,
	getGraphData,
	getKnowledgeNeighbors,
	getKnowledgeNode,
	getKnowledgeNodeEvidenceStats,
	getSharedKnowledge,
	knowledgeContacts,
	knowledgeLinks,
	knowledgeNodes,
	listContactIdsByKnowledge,
	listContactsByKnowledge,
	listContactsWithEvidenceForKnowledgeNode,
	listEvidenceForKnowledgeContact,
	listEvidenceForKnowledgeLink,
	listEvidenceForKnowledgeNode,
	listKnowledgeByContact,
	listKnowledgeNodes,
	mergeKnowledgeNodes,
	normalizeKnowledgeSearchQuery,
	searchKnowledgeNodes,
	searchKnowledgeNodesWithEvidence,
	sql,
	updateKnowledgeNode,
} from '@repo/db';
import {
	formatKnowledgeEmbeddingInput,
	getKnowledgeEmbeddingConfiguredFingerprint,
	getKnowledgeEmbeddingFingerprint,
	getKnowledgeEmbeddingRuntime,
	getKnowledgeLlmRuntime,
	isAiProcessingEnabled,
	type KnowledgeEmbeddingPurpose,
	knowledgeEmbeddingFingerprintKey,
} from '@repo/shared';
import { z } from 'zod';
import { getKnowledgeEvidenceQualityStatsForNodes } from '@/lib/knowledge-evidence-quality';
import {
	getInternalSecret,
	isLocalWorkerConnectionError,
	LOCAL_WORKER_UNAVAILABLE_MESSAGE,
	workspaceAction,
} from '@/lib/safe-action';
import { track } from '@/lib/track';

const NODE_TYPES = ['topic', 'project', 'organization', 'technology', 'sector', 'concept'] as const;
const ANALYSIS_MODES = ['incremental', 'evidence', 'full'] as const;
const REVIEW_STATUSES = ['reviewed', 'needs_review'] as const;
const DEFAULT_SEARCH_MIN_SIMILARITY = 0.62;
const DEFAULT_KNOWLEDGE_ANALYSIS_LIMIT = 50;

interface KnowledgeAnalysisRunData {
	mode?: string;
	workspaceId?: string;
	workspacesScanned?: number;
	contactsProcessed?: number;
	embeddingMatches?: number;
	messagesScanned?: number;
	backfillContactsCompleted?: number;
	backfillRemainingContacts?: number;
	embeddingProviderMode?: string;
	embeddingProviderLabel?: string;
	llmQueued?: number;
	batchLinked?: number;
	batchUsed?: boolean;
	llmProviderMode?: string;
	llmProviderLabel?: string;
	elapsedMs?: number;
}

interface KnowledgeInferenceRunData {
	status?: string;
	workspaceId?: string;
	nodesProcessed?: number;
	candidateRelationships?: number;
	coOccurrenceCandidates?: number;
	coOccurrenceLinks?: number;
	confirmedLinks?: number;
	similarityCandidates?: number;
	similarityLinks?: number;
	totalLinks?: number;
	skippedReason?: string | null;
}

interface ManualKnowledgeEvidenceRunData {
	workspaceId?: string;
	nodeId?: string;
	contactsScanned?: number;
	messagesScanned?: number;
	evidenceCreated?: number;
	contactsLinked?: number;
	totalEvidenceRows?: number;
	totalEvidenceContacts?: number;
	totalEvidenceMessages?: number;
	elapsedMs?: number;
	skippedReason?: string;
}

interface ManualKnowledgeBuildResponse {
	status?: string;
	analysis?: KnowledgeAnalysisRunData;
	manualEvidence?: ManualKnowledgeEvidenceRunData;
	inference?: KnowledgeInferenceRunData | null;
}

function workerUrl(path: string): string {
	const base = process.env.WORKER_URL ?? 'http://localhost:3001';
	return `${base.replace(/\/$/, '')}${path}`;
}

function publicWorkerActionError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	if (isLocalWorkerConnectionError(message)) return LOCAL_WORKER_UNAVAILABLE_MESSAGE;
	return message;
}

function workerHttpError(status: number): string {
	return `Local worker returned HTTP ${status}. Check the worker logs, WORKER_URL, and WORKER_INTERNAL_SECRET.`;
}

function knowledgeSearchMinSimilarity(): number {
	const raw = process.env.KNOWLEDGE_SEARCH_MIN_SIMILARITY;
	if (!raw) return DEFAULT_SEARCH_MIN_SIMILARITY;
	const configured = Number(raw);
	return Number.isFinite(configured) && configured >= 0 && configured <= 1
		? configured
		: DEFAULT_SEARCH_MIN_SIMILARITY;
}

function claimLabelForEvidenceKind(evidenceKind?: string | null): string {
	switch (evidenceKind) {
		case 'llm_extracted':
			return 'explicit';
		case 'embedding_match':
		case 'contact_cooccurrence':
			return 'inferred';
		case 'inferred_weak':
			return 'weak inferred';
		case 'manual':
			return 'manual';
		default:
			return 'legacy/no evidence';
	}
}

async function generateKnowledgeEmbedding(
	text: string,
	purpose: KnowledgeEmbeddingPurpose,
): Promise<number[] | undefined> {
	const runtime = getKnowledgeEmbeddingRuntime(process.env);
	if (!runtime.isLocal && !isAiProcessingEnabled()) return undefined;

	const apiKey = runtime.isLocal ? runtime.apiKey : await getOpenAIApiKey();
	if (!runtime.isLocal && !apiKey) return undefined;
	try {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};
		if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

		const response = await fetch(runtime.embeddingsUrl, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				model: runtime.model,
				input: formatKnowledgeEmbeddingInput(text, { purpose, runtime }),
				dimensions: runtime.dimensions,
			}),
		});
		if (!response.ok) return undefined;
		const data = (await response.json()) as {
			data: Array<{ embedding: number[] }>;
		};
		const embedding = data.data[0]?.embedding;
		return embedding?.length === runtime.dimensions ? embedding : undefined;
	} catch {
		return undefined;
	}
}

async function generateQueryEmbedding(text: string): Promise<number[] | undefined> {
	return generateKnowledgeEmbedding(text, 'query');
}

function projectKnowledgeNodeForClient(node: {
	id: string;
	type: string;
	name: string;
	displayName: string;
	description?: string | null;
	mentionCount?: number | null;
	firstSeenAt?: Date | null;
	lastSeenAt?: Date | null;
	createdAt?: Date | null;
	reviewStatus?: string | null;
	reviewedAt?: string | null;
}) {
	return {
		id: node.id,
		type: node.type,
		name: node.name,
		displayName: node.displayName,
		description: node.description ?? null,
		mentionCount: node.mentionCount ?? 0,
		firstSeenAt: node.firstSeenAt ?? null,
		lastSeenAt: node.lastSeenAt ?? null,
		createdAt: node.createdAt ?? null,
		reviewStatus: node.reviewStatus ?? null,
		reviewedAt: node.reviewedAt ?? null,
	};
}

function projectEvidenceForClient(e: {
	id: string;
	contactId?: string | null;
	messageId?: string | null;
	relationType: string;
	evidenceKind: string;
	confidence?: number | null;
	snippet?: string | null;
	occurredAt?: Date | null;
	createdAt?: Date | null;
}) {
	return {
		id: e.id,
		contactId: e.contactId ?? null,
		messageId: e.messageId ?? null,
		relationType: e.relationType,
		evidenceKind: e.evidenceKind,
		claimLabel: claimLabelForEvidenceKind(e.evidenceKind),
		confidence: e.confidence ?? null,
		snippet: e.snippet ?? null,
		occurredAt: e.occurredAt ?? null,
		createdAt: e.createdAt ?? null,
	};
}

function projectEvidenceChunkForClient(e: {
	id: string;
	knowledgeEvidenceId: string;
	contactId: string | null;
	messageId: string | null;
	chunkKind: string;
	maskedText: string;
	similarity: number | null;
	embeddingFingerprint: string;
	maskingPolicyVersion: string;
	chunkingPolicyVersion: string;
	occurredAt: Date | null;
	createdAt: Date;
}) {
	return {
		id: e.id,
		knowledgeEvidenceId: e.knowledgeEvidenceId,
		contactId: e.contactId ?? null,
		messageId: e.messageId ?? null,
		chunkKind: e.chunkKind,
		maskedText: e.maskedText,
		similarity: e.similarity,
		embeddingFingerprint: e.embeddingFingerprint,
		maskingPolicyVersion: e.maskingPolicyVersion,
		chunkingPolicyVersion: e.chunkingPolicyVersion,
		occurredAt: e.occurredAt ?? null,
		createdAt: e.createdAt ?? null,
	};
}

function knowledgeEvidenceChunkFingerprint(): string {
	return (
		getKnowledgeEmbeddingConfiguredFingerprint(process.env) ??
		knowledgeEmbeddingFingerprintKey(getKnowledgeEmbeddingFingerprint(process.env))
	);
}

function pluralize(value: number, singular: string, plural = `${singular}s`): string {
	return `${value} ${value === 1 ? singular : plural}`;
}

function buildKnowledgeAnswerSummary(
	rawQuery: string,
	normalizedQuery: string,
	results: Awaited<ReturnType<typeof searchKnowledgeNodesWithEvidence>>,
) {
	if (results.length === 0) {
		return {
			title: `No evidence-backed answer for "${rawQuery.trim()}".`,
			summary: 'No matching knowledge node had enough evidence to answer this from local data yet.',
			support: [],
			suggestedAction: 'Run an evidence pass or add a manual knowledge node, then search again.',
		};
	}

	const top = results[0];
	const contactIds = new Set<string>();
	let evidenceRows = 0;
	let evidenceChunks = 0;
	let explicitRows = 0;
	for (const result of results) {
		evidenceRows += result.evidenceCount;
		evidenceChunks += result.evidenceChunkCount;
		for (const contact of result.contacts) contactIds.add(contact.id);
		for (const evidence of result.evidence) {
			if (evidence.evidenceKind === 'llm_extracted' || evidence.evidenceKind === 'manual') {
				explicitRows++;
			}
		}
	}

	const topName = top?.node.displayName ?? normalizedQuery;
	const confidence =
		typeof top?.matchScore === 'number' ? `${Math.round(top.matchScore * 100)}%` : 'unknown';
	return {
		title: `${topName} is the strongest local match for "${normalizedQuery}".`,
		summary: `${pluralize(results.length, 'topic')} matched with ${pluralize(contactIds.size, 'connected contact')}, ${pluralize(evidenceRows, 'source evidence row')}, and ${pluralize(evidenceChunks, 'retrievable evidence chunk')}. Top match confidence is ${confidence}.`,
		support: [
			`${pluralize(contactIds.size, 'contact')} connected`,
			`${pluralize(evidenceRows, 'evidence row')} stored`,
			`${pluralize(evidenceChunks, 'chunk')} indexed`,
			`${pluralize(explicitRows, 'explicit source')} in the visible preview`,
		],
		suggestedAction:
			evidenceRows > 0
				? 'Open the top topic to inspect the supporting contacts and source snippets.'
				: 'Run an evidence pass to attach source snippets before relying on this answer.',
	};
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

			const searchResults = await searchKnowledgeNodesWithEvidence(
				ctx.workspaceId,
				query,
				embedding,
				ctx.envelope,
				{
					type: parsedInput.type,
					limit: parsedInput.limit,
					minSimilarity: knowledgeSearchMinSimilarity(),
					evidenceChunkFingerprint: knowledgeEvidenceChunkFingerprint(),
				},
			);
			nodes = searchResults.map((result) => result.node);

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
		const evidenceStats = await getKnowledgeNodeEvidenceStats(
			ctx.workspaceId,
			nodes.map((node) => node.id),
		);
		const evidenceQualityStats = await getKnowledgeEvidenceQualityStatsForNodes(
			ctx.workspaceId,
			nodes,
			ctx.envelope,
		);

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
				...projectKnowledgeNodeForClient(n),
				contactCount: contactIds.length,
				contactPreviews,
				evidenceCount: evidenceStats.get(n.id)?.evidenceRows ?? 0,
				distinctEvidenceMessages: evidenceStats.get(n.id)?.distinctEvidenceMessages ?? 0,
				distinctEvidenceContacts: evidenceStats.get(n.id)?.distinctEvidenceContacts ?? 0,
				aggregateEvidenceCount: evidenceStats.get(n.id)?.aggregateLinkEvidenceCount ?? 0,
				directEvidenceRows: evidenceQualityStats.get(n.id)?.directEvidenceRows ?? 0,
				directEvidenceMessages: evidenceQualityStats.get(n.id)?.directEvidenceMessages ?? 0,
				directEvidenceContacts: evidenceQualityStats.get(n.id)?.directEvidenceContacts ?? 0,
				possibleEvidenceRows: evidenceQualityStats.get(n.id)?.possibleEvidenceRows ?? 0,
				weakEvidenceRows: evidenceQualityStats.get(n.id)?.weakEvidenceRows ?? 0,
			};
		});
	});

/**
 * Evidence-aware knowledge search.
 *
 * Primary result remains the knowledge node. Evidence enriches each node with
 * supporting contacts, message snippets, timestamps, relation labels, and scores.
 * CRITICAL: Uses workspaceAction — workspaceId never from client.
 */
export const searchKnowledgeNodesWithEvidenceAction = workspaceAction
	.schema(
		z.object({
			query: z.string().min(1).max(200),
			type: z.enum(NODE_TYPES).optional(),
			limit: z.number().max(50).default(20),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const rawQuery = parsedInput.query.trim();
		const normalizedQuery = normalizeKnowledgeSearchQuery(rawQuery);
		if (!normalizedQuery) {
			return {
				query: rawQuery,
				normalizedQuery,
				minSimilarity: knowledgeSearchMinSimilarity(),
				noConfidentResults: true,
				answer: {
					title: 'Enter a topic or question to search local knowledge.',
					summary: 'The query did not contain enough topic text after normalization.',
					support: [],
					suggestedAction: 'Try a project, organization, topic, or contact interest.',
				},
				results: [],
			};
		}

		const wrk = await unwrapWrk(ctx.envelope);
		const keys = await deriveKeys(wrk, ctx.workspaceId, ctx.envelope.wrkVersion);
		const detected = prefilterEntities(normalizedQuery);
		const maskedQuery = maskEntities(normalizedQuery, keys.bik, detected).maskedText;
		const embedding = await generateQueryEmbedding(maskedQuery);
		const minSimilarity = knowledgeSearchMinSimilarity();

		const results = await searchKnowledgeNodesWithEvidence(
			ctx.workspaceId,
			normalizedQuery,
			embedding,
			ctx.envelope,
			{
				type: parsedInput.type,
				limit: parsedInput.limit,
				minSimilarity,
				messageRecallQueryText: maskedQuery,
				evidenceChunkFingerprint: knowledgeEvidenceChunkFingerprint(),
				evidenceLimitPerNode: 3,
				contactLimitPerNode: 3,
			},
		);
		const evidenceQualityStats = await getKnowledgeEvidenceQualityStatsForNodes(
			ctx.workspaceId,
			results.map((result) => result.node),
			ctx.envelope,
		);

		track(ctx.workspaceId, ctx.session.user.id, 'knowledge.evidence_searched', {
			query_length: rawQuery.length,
			normalized_query_length: normalizedQuery.length,
			result_count: results.length,
			search_mode: embedding ? 'semantic_evidence' : 'exact_evidence',
			min_similarity: minSimilarity,
		});

		return {
			query: rawQuery,
			normalizedQuery,
			minSimilarity,
			noConfidentResults: results.length === 0,
			answer: buildKnowledgeAnswerSummary(rawQuery, normalizedQuery, results),
			results: results.map((result) => {
				const qualityStats = evidenceQualityStats.get(result.node.id);
				return {
					node: projectKnowledgeNodeForClient(result.node),
					similarity: result.similarity,
					matchScore: result.matchScore,
					matchReasons: result.matchReasons,
					exactMatch: result.exactMatch,
					aliasMatch: result.aliasMatch,
					messageRecallScore: result.messageRecallScore,
					messageHitCount: result.messageHitCount,
					messageMatchedEvidenceIds: result.messageMatchedEvidenceIds,
					messageMatchedAt: result.messageMatchedAt,
					messageRecallReasons: result.messageRecallReasons,
					evidenceChunkRecallScore: result.evidenceChunkRecallScore,
					evidenceChunkHitCount: result.evidenceChunkHitCount,
					evidenceChunkMatchedChunkIds: result.evidenceChunkMatchedChunkIds,
					evidenceChunkMatchedAt: result.evidenceChunkMatchedAt,
					evidenceChunkRecallReasons: result.evidenceChunkRecallReasons,
					evidenceCount: result.evidenceCount,
					evidenceChunkCount: result.evidenceChunkCount,
					aggregateEvidenceCount: result.aggregateEvidenceCount,
					latestEvidenceAt: result.latestEvidenceAt,
					topConfidence: result.topConfidence,
					connectedContactCount: result.connectedContactCount,
					connectedContactsWithEvidence: result.connectedContactsWithEvidence,
					directEvidenceRows: qualityStats?.directEvidenceRows ?? 0,
					directEvidenceMessages: qualityStats?.directEvidenceMessages ?? 0,
					directEvidenceContacts: qualityStats?.directEvidenceContacts ?? 0,
					possibleEvidenceRows: qualityStats?.possibleEvidenceRows ?? 0,
					weakEvidenceRows: qualityStats?.weakEvidenceRows ?? 0,
					contacts: result.contacts.map((contact) => ({
						id: contact.id,
						firstName: contact.firstName,
						lastName: contact.lastName,
						relationType: contact.relationType,
						strength: contact.strength,
						evidenceCount: contact.evidenceCount,
						lastEvidenceAt: contact.lastEvidenceAt,
						evidence: contact.evidence.map(projectEvidenceForClient),
					})),
					evidence: result.evidence.map(projectEvidenceForClient),
					evidenceChunks: result.evidenceChunks.map(projectEvidenceChunkForClient),
				};
			}),
		};
	});

export const getKnowledgeAnalysisEstimateAction = workspaceAction
	.schema(
		z.object({
			mode: z.enum(ANALYSIS_MODES).default('incremental'),
			limit: z.number().min(1).max(500).default(DEFAULT_KNOWLEDGE_ANALYSIS_LIMIT),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		try {
			const calibration = await getCalibration(ctx.session.user.id, ctx.workspaceId, ctx.envelope);
			if (calibration?.consentAiAnalysis !== true) {
				const embeddingRuntime = getKnowledgeEmbeddingRuntime(process.env);
				const llmRuntime = getKnowledgeLlmRuntime(process.env);
				return {
					mode: parsedInput.mode,
					enabled: true,
					hasConsent: false,
					canRun: false,
					contactsEstimated: 0,
					staleContactsEstimated: 0,
					backfillContactsEstimated: 0,
					backfillContactsCompletedEstimated: 0,
					backfillMessagesScannedEstimated: 0,
					messagesEstimated: 0,
					embeddingRequestsEstimated: 0,
					embeddingInputsEstimated: 0,
					embeddingProviderMode: embeddingRuntime.mode,
					embeddingProviderLabel: embeddingRuntime.label,
					llmRequestsEstimated: 0,
					llmProviderMode: llmRuntime.mode,
					llmProviderLabel: llmRuntime.label,
					limit: parsedInput.limit,
				};
			}

			const response = await fetch(workerUrl('/admin/knowledge-analysis/estimate'), {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Internal-Secret': getInternalSecret(),
				},
				body: JSON.stringify({
					workspaceId: ctx.workspaceId,
					mode: parsedInput.mode,
					limit: parsedInput.limit,
				}),
				cache: 'no-store',
			});

			if (!response.ok) {
				return {
					mode: parsedInput.mode,
					canRun: false,
					error: workerHttpError(response.status),
				};
			}

			return await response.json();
		} catch (err) {
			return {
				mode: parsedInput.mode,
				canRun: false,
				error: publicWorkerActionError(err),
			};
		}
	});

export const getKnowledgeAnalysisProgressAction = workspaceAction
	.schema(
		z.object({
			mode: z.enum(ANALYSIS_MODES).default('incremental'),
			startedAt: z.string().min(1),
			expectedContacts: z.number().int().min(0).max(500).default(0),
			expectedLlmRequests: z.number().int().min(0).max(500).default(0),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const startedAt = new Date(parsedInput.startedAt);
		if (Number.isNaN(startedAt.getTime())) {
			return {
				error: 'Invalid analysis start time',
				percent: 0,
				stage: 'queued',
				processedContacts: 0,
				expectedContacts: parsedInput.expectedContacts,
				llmCompleted: 0,
				expectedLlmRequests: parsedInput.expectedLlmRequests,
				entitiesExtracted: 0,
				backfillContactsCompleted: 0,
				backfillContactsInProgress: 0,
				backfillMessagesScanned: 0,
				nodeCount: 0,
				evidenceCount: 0,
				linkCount: 0,
				complete: false,
			};
		}
		const startedAtIso = startedAt.toISOString();

		const rows = await db.execute(sql`
			WITH progress AS (
				SELECT
					COUNT(*) FILTER (
						WHERE last_extracted_at >= ${startedAtIso}::timestamptz
					)::int AS processed_contacts,
					COUNT(*) FILTER (
						WHERE last_extracted_at >= ${startedAtIso}::timestamptz
						AND llm_called > 0
					)::int AS llm_completed,
					COALESCE(
						SUM(entities_extracted) FILTER (
							WHERE last_extracted_at >= ${startedAtIso}::timestamptz
						),
						0
					)::int AS entities_extracted,
					MAX(last_extracted_at) FILTER (
						WHERE last_extracted_at >= ${startedAtIso}::timestamptz
					) AS latest_update_at,
					COUNT(*) FILTER (
						WHERE backfill_completed_at >= ${startedAtIso}::timestamptz
					)::int AS backfill_contacts_completed,
					COUNT(*) FILTER (
						WHERE last_extracted_at >= ${startedAtIso}::timestamptz
							AND backfill_oldest_message_at IS NOT NULL
							AND backfill_completed_at IS NULL
					)::int AS backfill_contacts_in_progress,
					COALESCE(
						SUM(backfill_messages_scanned) FILTER (
							WHERE last_extracted_at >= ${startedAtIso}::timestamptz
								OR backfill_completed_at >= ${startedAtIso}::timestamptz
						),
						0
					)::int AS backfill_messages_scanned
				FROM knowledge_extraction_log
				WHERE workspace_id = ${ctx.workspaceId}::uuid
			),
			graph AS (
				SELECT
					(SELECT COUNT(*)::int FROM knowledge_nodes WHERE workspace_id = ${ctx.workspaceId}::uuid) AS node_count,
					(SELECT COUNT(*)::int FROM knowledge_evidence WHERE workspace_id = ${ctx.workspaceId}::uuid) AS evidence_count,
					(SELECT COUNT(*)::int FROM knowledge_links WHERE workspace_id = ${ctx.workspaceId}::uuid) AS link_count
			)
			SELECT
				progress.processed_contacts,
				progress.llm_completed,
				progress.entities_extracted,
				progress.latest_update_at,
				progress.backfill_contacts_completed,
				progress.backfill_contacts_in_progress,
				progress.backfill_messages_scanned,
				graph.node_count,
				graph.evidence_count,
				graph.link_count
			FROM progress, graph
		`);

		const row = (
			rows as unknown as Array<{
				processed_contacts?: number | string | null;
				llm_completed?: number | string | null;
				entities_extracted?: number | string | null;
				latest_update_at?: Date | string | null;
				backfill_contacts_completed?: number | string | null;
				backfill_contacts_in_progress?: number | string | null;
				backfill_messages_scanned?: number | string | null;
				node_count?: number | string | null;
				evidence_count?: number | string | null;
				link_count?: number | string | null;
			}>
		)[0];

		const processedContacts = Number(row?.processed_contacts ?? 0);
		const llmCompleted = Number(row?.llm_completed ?? 0);
		const entitiesExtracted = Number(row?.entities_extracted ?? 0);
		const nodeCount = Number(row?.node_count ?? 0);
		const evidenceCount = Number(row?.evidence_count ?? 0);
		const linkCount = Number(row?.link_count ?? 0);
		const backfillContactsCompleted = Number(row?.backfill_contacts_completed ?? 0);
		const backfillContactsInProgress = Number(row?.backfill_contacts_in_progress ?? 0);
		const backfillMessagesScanned = Number(row?.backfill_messages_scanned ?? 0);
		const expectedContacts = Math.max(parsedInput.expectedContacts, processedContacts);
		const expectedLlmRequests = Math.max(parsedInput.expectedLlmRequests, llmCompleted);
		const contactRatio =
			expectedContacts > 0 ? Math.min(1, processedContacts / expectedContacts) : 0;
		const llmRatio = expectedLlmRequests > 0 ? Math.min(1, llmCompleted / expectedLlmRequests) : 1;
		const complete =
			parsedInput.mode === 'full'
				? expectedContacts > 0 &&
					backfillContactsCompleted >= expectedContacts &&
					(expectedLlmRequests === 0 || llmCompleted >= expectedLlmRequests)
				: expectedContacts > 0 &&
					processedContacts >= expectedContacts &&
					(expectedLlmRequests === 0 || llmCompleted >= expectedLlmRequests);
		const percent = complete
			? 100
			: parsedInput.mode === 'full' && expectedContacts > 0
				? Math.min(
						99,
						Math.round(
							Math.min(
								1,
								(backfillContactsCompleted + backfillContactsInProgress) / expectedContacts,
							) *
								70 +
								llmRatio * 20,
						),
					)
				: expectedLlmRequests > 0
					? Math.min(99, Math.round(contactRatio * 35 + llmRatio * 60))
					: Math.min(99, Math.round(contactRatio * 95));
		const stage = complete
			? 'complete'
			: parsedInput.mode === 'full' && backfillContactsCompleted < expectedContacts
				? 'contacts'
				: processedContacts === 0
					? 'queued'
					: expectedLlmRequests > 0 && processedContacts >= expectedContacts
						? 'llm'
						: 'contacts';
		const latestUpdateAt = row?.latest_update_at
			? new Date(row.latest_update_at).toISOString()
			: null;

		return {
			stage,
			percent,
			processedContacts,
			expectedContacts,
			llmCompleted,
			expectedLlmRequests,
			entitiesExtracted,
			backfillContactsCompleted,
			backfillContactsInProgress,
			backfillMessagesScanned,
			nodeCount,
			evidenceCount,
			linkCount,
			latestUpdateAt,
			complete,
		};
	});

export const runLocalKnowledgeAnalysisAction = workspaceAction
	.schema(
		z.object({
			mode: z.enum(ANALYSIS_MODES).default('incremental'),
			limit: z.number().min(1).max(500).default(DEFAULT_KNOWLEDGE_ANALYSIS_LIMIT),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		try {
			const calibration = await getCalibration(ctx.session.user.id, ctx.workspaceId, ctx.envelope);
			if (calibration?.consentAiAnalysis !== true) {
				return {
					queued: false,
					mode: parsedInput.mode,
					error: 'AI analysis consent is not enabled',
				};
			}

			const response = await fetch(workerUrl('/admin/extract-knowledge'), {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Internal-Secret': getInternalSecret(),
				},
				body: JSON.stringify({
					workspaceId: ctx.workspaceId,
					mode: parsedInput.mode,
					limit: parsedInput.limit,
				}),
				cache: 'no-store',
			});

			if (!response.ok) {
				return {
					queued: false,
					mode: parsedInput.mode,
					error: workerHttpError(response.status),
				};
			}

			const data = await response.json();
			track(ctx.workspaceId, ctx.session.user.id, 'knowledge.local_analysis_queued', {
				mode: parsedInput.mode,
				limit: parsedInput.limit,
			});

			return {
				queued: data.status === 'started',
				mode: parsedInput.mode,
				status: data.status,
			};
		} catch (err) {
			return {
				queued: false,
				mode: parsedInput.mode,
				error: publicWorkerActionError(err),
			};
		}
	});

export const runLocalKnowledgeInferenceAction = workspaceAction
	.schema(z.object({}))
	.action(async ({ ctx }) => {
		try {
			const calibration = await getCalibration(ctx.session.user.id, ctx.workspaceId, ctx.envelope);
			if (calibration?.consentAiAnalysis !== true) {
				return {
					status: 'skipped',
					error: 'AI analysis consent is not enabled',
					nodesProcessed: 0,
					candidateRelationships: 0,
					coOccurrenceCandidates: 0,
					coOccurrenceLinks: 0,
					confirmedLinks: 0,
					similarityCandidates: 0,
					similarityLinks: 0,
					totalLinks: 0,
				};
			}

			const response = await fetch(workerUrl('/admin/infer-knowledge'), {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Internal-Secret': getInternalSecret(),
				},
				body: JSON.stringify({
					workspaceId: ctx.workspaceId,
				}),
				cache: 'no-store',
			});

			if (!response.ok) {
				return {
					status: 'error',
					error: workerHttpError(response.status),
					nodesProcessed: 0,
					candidateRelationships: 0,
					coOccurrenceCandidates: 0,
					coOccurrenceLinks: 0,
					confirmedLinks: 0,
					similarityCandidates: 0,
					similarityLinks: 0,
					totalLinks: 0,
				};
			}

			const data = (await response.json()) as {
				status?: string;
				nodesProcessed?: number;
				candidateRelationships?: number;
				coOccurrenceCandidates?: number;
				coOccurrenceLinks?: number;
				confirmedLinks?: number;
				similarityCandidates?: number;
				similarityLinks?: number;
				totalLinks?: number;
				skippedReason?: string;
			};
			track(ctx.workspaceId, ctx.session.user.id, 'knowledge.local_inference_ran', {
				status: data.status,
				nodes_processed: data.nodesProcessed ?? 0,
				candidate_relationships: data.candidateRelationships ?? 0,
				confirmed_links: data.confirmedLinks ?? data.totalLinks ?? 0,
				total_links: data.totalLinks ?? 0,
				skipped_reason: data.skippedReason ?? null,
			});

			return {
				status: data.status ?? 'complete',
				nodesProcessed: data.nodesProcessed ?? 0,
				candidateRelationships: data.candidateRelationships ?? 0,
				coOccurrenceCandidates: data.coOccurrenceCandidates ?? 0,
				coOccurrenceLinks: data.coOccurrenceLinks ?? 0,
				confirmedLinks: data.confirmedLinks ?? data.totalLinks ?? 0,
				similarityCandidates: data.similarityCandidates ?? 0,
				similarityLinks: data.similarityLinks ?? 0,
				totalLinks: data.totalLinks ?? 0,
				skippedReason: data.skippedReason ?? null,
			};
		} catch (err) {
			return {
				status: 'error',
				error: publicWorkerActionError(err),
				nodesProcessed: 0,
				candidateRelationships: 0,
				coOccurrenceCandidates: 0,
				coOccurrenceLinks: 0,
				confirmedLinks: 0,
				similarityCandidates: 0,
				similarityLinks: 0,
				totalLinks: 0,
			};
		}
	});

export const createManualKnowledgeNodeAction = workspaceAction
	.schema(
		z.object({
			type: z.enum(NODE_TYPES),
			name: z.string().min(2).max(80),
			description: z.string().max(240).optional(),
			buildNow: z.boolean().default(true),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const calibration = await getCalibration(ctx.session.user.id, ctx.workspaceId, ctx.envelope);
		if (calibration?.consentAiAnalysis !== true) {
			return {
				created: false,
				buildQueued: false,
				error: 'AI analysis consent is not enabled',
			};
		}

		const runtime = getKnowledgeEmbeddingRuntime(process.env);
		if (!runtime.isLocal) {
			return {
				created: false,
				buildQueued: false,
				error: 'Manual local knowledge build requires local embeddings',
			};
		}

		const displayName = parsedInput.name.trim();
		const description = parsedInput.description?.trim() || undefined;
		const rawEmbeddingInput = description
			? `Type: ${parsedInput.type} | Name: ${displayName} | Context: ${description}`
			: `Type: ${parsedInput.type} | Name: ${displayName}`;
		const wrk = await unwrapWrk(ctx.envelope);
		const keys = await deriveKeys(wrk, ctx.workspaceId, ctx.envelope.wrkVersion);
		const detected = prefilterEntities(rawEmbeddingInput);
		const maskedEmbeddingInput = maskEntities(rawEmbeddingInput, keys.bik, detected).maskedText;
		const embedding = await generateKnowledgeEmbedding(maskedEmbeddingInput, 'dedup');
		if (!embedding) {
			return {
				created: false,
				buildQueued: false,
				error: 'Unable to generate local embedding for manual knowledge node',
			};
		}

		const node = await createKnowledgeNode(
			ctx.workspaceId,
			{
				type: parsedInput.type,
				name: displayName,
				displayName,
				description,
				embedding,
				metadata: {
					source: 'manual',
					localBuildRequested: parsedInput.buildNow,
				},
			},
			ctx.envelope,
		);

		await createKnowledgeEvidence(
			ctx.workspaceId,
			{
				knowledgeNodeId: node.id,
				relationType: 'manual',
				evidenceKind: 'manual',
				confidence: 1,
				metadata: {
					source: 'manual_knowledge_node',
				},
			},
			ctx.envelope,
		);

		let buildQueued = false;
		let buildError: string | undefined;
		let buildStatus: string | undefined;
		let analysis: KnowledgeAnalysisRunData | undefined;
		let inference: KnowledgeInferenceRunData | undefined;
		let manualEvidence: ManualKnowledgeEvidenceRunData | undefined;
		if (parsedInput.buildNow) {
			try {
				const response = await fetch(workerUrl('/admin/build-manual-knowledge-evidence'), {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'X-Internal-Secret': getInternalSecret(),
					},
					body: JSON.stringify({
						workspaceId: ctx.workspaceId,
						nodeId: node.id,
						limit: 500,
						maxEvidence: 200,
						runInference: true,
						waitForResult: true,
					}),
					cache: 'no-store',
				});
				if (response.ok) {
					const data = (await response.json()) as ManualKnowledgeBuildResponse;
					buildStatus = data.status;
					buildQueued = data.status === 'started' || !data.status;
					manualEvidence = data.manualEvidence;
					analysis =
						data.analysis ??
						(data.manualEvidence
							? {
									mode: 'manual_evidence',
									workspaceId: data.manualEvidence.workspaceId,
									contactsProcessed: data.manualEvidence.contactsScanned,
									embeddingMatches: data.manualEvidence.evidenceCreated,
									batchLinked: data.manualEvidence.contactsLinked,
									elapsedMs: data.manualEvidence.elapsedMs,
								}
							: undefined);
					inference = data.inference ?? undefined;
				} else {
					buildError = workerHttpError(response.status);
				}
			} catch (err) {
				buildError = publicWorkerActionError(err);
			}
		}

		track(ctx.workspaceId, ctx.session.user.id, 'knowledge.manual_node_created', {
			type: parsedInput.type,
			has_description: Boolean(description),
			build_queued: buildQueued,
			build_status: buildStatus ?? null,
			contacts_processed: analysis?.contactsProcessed ?? 0,
			messages_scanned: analysis?.messagesScanned ?? 0,
			backfill_contacts_completed: analysis?.backfillContactsCompleted ?? 0,
			backfill_remaining_contacts: analysis?.backfillRemainingContacts ?? 0,
			embedding_matches: analysis?.embeddingMatches ?? 0,
			candidate_relationships: inference?.candidateRelationships ?? 0,
			confirmed_links: inference?.confirmedLinks ?? inference?.totalLinks ?? 0,
			total_links: inference?.totalLinks ?? 0,
		});

		return {
			created: true,
			buildQueued,
			buildError,
			buildStatus,
			analysis,
			manualEvidence,
			inference,
			node: projectKnowledgeNodeForClient(node),
		};
	});

export const reviewKnowledgeNodeAction = workspaceAction
	.schema(
		z.object({
			nodeId: z.string().uuid(),
			type: z.enum(NODE_TYPES).optional(),
			displayName: z.string().min(2).max(80).optional(),
			description: z.string().max(240).nullable().optional(),
			status: z.enum(REVIEW_STATUSES).default('reviewed'),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const node = await getKnowledgeNode(ctx.workspaceId, parsedInput.nodeId, ctx.envelope);
		if (!node) {
			return { updated: false, error: 'Knowledge node not found' };
		}

		const displayName = parsedInput.displayName?.trim();
		const description =
			parsedInput.description === undefined ? undefined : parsedInput.description?.trim() || null;
		const nextType = parsedInput.type ?? node.type;
		const nextDisplayName = displayName || node.displayName;
		const nextDescription = description === undefined ? node.description : description;
		const changedCoreFields =
			nextType !== node.type ||
			nextDisplayName !== node.displayName ||
			nextDescription !== node.description;

		let embedding: number[] | undefined;
		if (changedCoreFields) {
			const rawEmbeddingInput = nextDescription
				? `Type: ${nextType} | Name: ${nextDisplayName} | Context: ${nextDescription}`
				: `Type: ${nextType} | Name: ${nextDisplayName}`;
			const wrk = await unwrapWrk(ctx.envelope);
			const keys = await deriveKeys(wrk, ctx.workspaceId, ctx.envelope.wrkVersion);
			const detected = prefilterEntities(rawEmbeddingInput);
			const maskedEmbeddingInput = maskEntities(rawEmbeddingInput, keys.bik, detected).maskedText;
			embedding = await generateKnowledgeEmbedding(maskedEmbeddingInput, 'dedup');
		}

		const existingMetadata =
			node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
				? node.metadata
				: {};
		const reviewedAt = new Date().toISOString();
		const updated = await updateKnowledgeNode(
			ctx.workspaceId,
			node.id,
			{
				...(changedCoreFields
					? {
							type: nextType,
							name: nextDisplayName,
							displayName: nextDisplayName,
							description: nextDescription,
						}
					: {}),
				embedding,
				metadata: {
					...existingMetadata,
					review: {
						status: parsedInput.status,
						reviewedAt,
						source: 'manual',
					},
				},
			},
			ctx.envelope,
		);

		track(ctx.workspaceId, ctx.session.user.id, 'knowledge.node_reviewed', {
			status: parsedInput.status,
			changed_core_fields: changedCoreFields,
			embedding_refreshed: Boolean(embedding),
		});

		return {
			updated: Boolean(updated),
			node: updated
				? {
						...projectKnowledgeNodeForClient(updated),
						reviewStatus: parsedInput.status,
						reviewedAt,
					}
				: null,
		};
	});

function relationshipExplanationLabel(input: {
	linkType: string;
	weight?: number | null;
	evidenceCount: number;
	direction: 'outbound' | 'inbound';
}) {
	const relation = input.linkType.replace(/_/g, ' ');
	if (input.evidenceCount > 0) {
		return `Connected by ${relation} with ${pluralize(input.evidenceCount, 'supporting evidence row')}.`;
	}
	if (input.linkType === 'related_to') {
		const strength =
			typeof input.weight === 'number' && input.weight >= 0.8
				? 'strong'
				: typeof input.weight === 'number' && input.weight >= 0.6
					? 'moderate'
					: 'weak';
		return `A ${strength} inferred relationship from shared contacts or semantic similarity.`;
	}
	return `Connected by ${relation}; no source snippet is attached yet.`;
}

export const getKnowledgeRelationshipExplanationsAction = workspaceAction
	.schema(z.object({ nodeId: z.string().uuid(), limit: z.number().min(1).max(10).default(5) }))
	.action(async ({ parsedInput, ctx }) => {
		const node = await getKnowledgeNode(ctx.workspaceId, parsedInput.nodeId, ctx.envelope);
		if (!node) return { explanations: [] };

		const neighbors = await getKnowledgeNeighbors(
			parsedInput.nodeId,
			ctx.workspaceId,
			ctx.envelope,
		);
		const topNeighbors = neighbors
			.slice()
			.sort((a, b) => (b.link.weight ?? 0) - (a.link.weight ?? 0))
			.slice(0, parsedInput.limit);

		const explanations = await Promise.all(
			topNeighbors.map(async (neighbor) => {
				const sourceNodeId =
					neighbor.direction === 'outbound' ? parsedInput.nodeId : neighbor.link.sourceNodeId;
				const targetNodeId =
					neighbor.direction === 'outbound' ? neighbor.link.targetNodeId : parsedInput.nodeId;
				const evidenceRows = await listEvidenceForKnowledgeLink(
					ctx.workspaceId,
					sourceNodeId,
					targetNodeId,
					ctx.envelope,
					{
						relationType: neighbor.link.linkType,
						limit: 2,
					},
				);
				return {
					id: neighbor.link.id,
					direction: neighbor.direction,
					linkType: neighbor.link.linkType,
					weight: neighbor.link.weight,
					neighbor: projectKnowledgeNodeForClient(neighbor.node),
					explanation: relationshipExplanationLabel({
						linkType: neighbor.link.linkType,
						weight: neighbor.link.weight,
						evidenceCount: evidenceRows.length,
						direction: neighbor.direction,
					}),
					evidence: evidenceRows.map(projectEvidenceForClient),
				};
			}),
		);

		track(ctx.workspaceId, ctx.session.user.id, 'knowledge.relationships_explained', {
			node_type: node.type,
			explanation_count: explanations.length,
		});

		return { explanations };
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
 * Return recent evidence snippets for a knowledge node.
 * CRITICAL: Uses workspaceAction — workspaceId never from client.
 */
export const getKnowledgeEvidenceAction = workspaceAction
	.schema(
		z.object({
			nodeId: z.string().uuid(),
			contactId: z.string().uuid().optional(),
			limit: z.number().max(50).default(25),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const node = await getKnowledgeNode(ctx.workspaceId, parsedInput.nodeId, ctx.envelope);
		if (!node) return [];

		const projectEvidence = (rows: Awaited<ReturnType<typeof listEvidenceForKnowledgeNode>>) =>
			rows.map((e) => ({
				id: e.id,
				knowledgeNodeId: e.knowledgeNodeId,
				relatedKnowledgeNodeId: e.relatedKnowledgeNodeId,
				contactId: e.contactId,
				messageId: e.messageId,
				relationType: e.relationType,
				evidenceKind: e.evidenceKind,
				claimLabel: claimLabelForEvidenceKind(e.evidenceKind),
				confidence: e.confidence,
				snippet: e.snippet,
				occurredAt: e.occurredAt,
				createdAt: e.createdAt,
				metadata: e.metadata,
			}));

		if (parsedInput.contactId) {
			const rows = await listEvidenceForKnowledgeContact(
				ctx.workspaceId,
				parsedInput.nodeId,
				parsedInput.contactId,
				ctx.envelope,
				{ limit: parsedInput.limit },
			);
			return projectEvidence(rows);
		}

		const rows = await listEvidenceForKnowledgeNode(
			ctx.workspaceId,
			parsedInput.nodeId,
			ctx.envelope,
			{
				limit: parsedInput.limit,
			},
		);
		return projectEvidence(rows);
	});

/**
 * Return contacts linked to a knowledge node with supporting evidence.
 * CRITICAL: Uses workspaceAction — workspaceId never from client.
 */
export const getKnowledgeContactsWithEvidenceAction = workspaceAction
	.schema(z.object({ nodeId: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		const node = await getKnowledgeNode(ctx.workspaceId, parsedInput.nodeId, ctx.envelope);
		if (!node) return [];

		const rows = await listContactsWithEvidenceForKnowledgeNode(
			parsedInput.nodeId,
			ctx.workspaceId,
			ctx.envelope,
		);

		return rows.map((row) => ({
			contact: {
				id: row.contact.id,
				firstName: row.contact.firstName,
				lastName: row.contact.lastName,
			},
			relationType: row.link.relationType,
			strength: row.link.strength,
			evidenceCount: row.link.evidenceCount,
			lastEvidenceAt: row.link.lastEvidenceAt,
			evidence: row.evidence.map((e) => ({
				id: e.id,
				messageId: e.messageId,
				relationType: e.relationType,
				evidenceKind: e.evidenceKind,
				claimLabel: claimLabelForEvidenceKind(e.evidenceKind),
				confidence: e.confidence,
				snippet: e.snippet,
				occurredAt: e.occurredAt,
				createdAt: e.createdAt,
				metadata: e.metadata,
			})),
		}));
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
