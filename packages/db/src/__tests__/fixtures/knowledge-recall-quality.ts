import type { KnowledgeSearchResultWithEvidence } from '../../dal/knowledge';
import { knowledgeRecallFixture as fixture } from './knowledge-recall-fixture';
import { type FixtureSearchInput, runFixtureSearch } from './knowledge-recall-harness';

export interface KnowledgeRecallQualityCase {
	id: string;
	query: string;
	description: string;
	search: Omit<FixtureSearchInput, 'query'>;
	expectedNodeName: string | null;
	expectedNodeId?: string;
	maxRank?: number;
	requiredMatchReasons?: string[];
	requiredMessageRecallReasons?: string[];
	minEvidenceCount?: number;
	minMessageHitCount?: number;
	minConnectedContactCount?: number;
	requireEvidenceSnippets?: boolean;
	requireTimestamps?: boolean;
	requireConfidence?: boolean;
	expectNoConfidentResults?: boolean;
	expectDecoyExcluded?: boolean;
	expectAmbiguousIgnored?: boolean;
	forbiddenText?: string[];
}

export interface KnowledgeRecallQueryMetric {
	id: string;
	query: string;
	expectedNode: string | null;
	expectedRank: number | null;
	actualRank: number | null;
	actualTopNode: string | null;
	resultCount: number;
	matchReasons: string[];
	messageRecallReasons: string[];
	evidenceCount: number;
	messageHitCount: number;
	connectedContactCount: number;
	hasEvidenceSnippets: boolean;
	hasTimestamps: boolean;
	hasConfidence: boolean;
	crossWorkspaceDecoysExcluded: boolean;
	ambiguousLegacyIgnored: boolean | null;
	latencyMs: number;
	passed: boolean;
	failures: string[];
	warnings: string[];
}

export interface KnowledgeRecallQualityReport {
	suite: 'knowledge-recall';
	status: 'passed' | 'failed';
	totalQueries: number;
	passedQueries: number;
	failedQueries: number;
	averageLatencyMs: number;
	slowestQuery: { query: string; latencyMs: number } | null;
	evidenceCoverage: {
		queriesRequiringEvidence: number;
		queriesWithEvidence: number;
		totalEvidenceCount: number;
	};
	messageRecallCoverage: {
		queriesRequiringMessageRecall: number;
		queriesWithMessageRecall: number;
		totalMessageHits: number;
	};
	privacyIsolation: {
		passed: boolean;
		checkedCategories: string[];
		failures: string[];
	};
	queries: KnowledgeRecallQueryMetric[];
}

export interface KnowledgeRecallQualityOptions {
	cases?: KnowledgeRecallQualityCase[];
	search?: (input: FixtureSearchInput) => Promise<KnowledgeSearchResultWithEvidence[]>;
	measureLatency?: boolean;
}

export const DEFAULT_RECALL_QUALITY_CASES: KnowledgeRecallQualityCase[] = [
	{
		id: 'exact_ai_agents',
		query: 'AI agents',
		description: 'Exact topic search returns the AI agents node with people and evidence.',
		search: {},
		expectedNodeName: 'AI agents',
		expectedNodeId: fixture.nodeIds.aiAgents,
		maxRank: 1,
		requiredMatchReasons: ['exact name', 'message evidence', 'contact evidence'],
		minEvidenceCount: 1,
		minConnectedContactCount: 1,
		requireEvidenceSnippets: true,
		requireTimestamps: true,
		requireConfidence: true,
		expectDecoyExcluded: true,
		forbiddenText: ['Decoy workspace', fixture.decoyWorkspaceId, '555-0101', 'alice@example.com'],
	},
	{
		id: 'alias_depin_infra',
		query: 'DePIN infra',
		description: 'Alias search resolves DePIN infra to Solana DePIN.',
		search: {},
		expectedNodeName: 'Solana DePIN',
		expectedNodeId: fixture.nodeIds.solanaDepin,
		maxRank: 1,
		requiredMatchReasons: ['alias', 'matched in message evidence'],
		requiredMessageRecallReasons: ['evidence_message_match', 'memory_full_text'],
		minEvidenceCount: 1,
		minMessageHitCount: 1,
		minConnectedContactCount: 1,
		requireEvidenceSnippets: true,
		requireTimestamps: true,
		requireConfidence: true,
	},
	{
		id: 'semantic_sales_workflows',
		query: 'autonomous sales workflows',
		description: 'Semantic node recall finds CRM automation without exact or alias recall.',
		search: { useEmbedding: true, messageRecallQueryText: null },
		expectedNodeName: 'CRM automation',
		expectedNodeId: fixture.nodeIds.crmAutomation,
		maxRank: 1,
		requiredMatchReasons: ['semantic similarity', 'message evidence'],
		minEvidenceCount: 1,
		minConnectedContactCount: 1,
		requireEvidenceSnippets: true,
		requireTimestamps: true,
		requireConfidence: true,
	},
	{
		id: 'message_recall_helium',
		query: 'wireless hotspot rollout',
		description: 'Message/memory recall discovers Helium through deterministic message metadata.',
		search: { messageRecallQueryText: 'wireless hotspot rollout' },
		expectedNodeName: 'Helium',
		expectedNodeId: fixture.nodeIds.helium,
		maxRank: 1,
		requiredMatchReasons: ['evidence_message_match', 'matched in message evidence'],
		requiredMessageRecallReasons: ['evidence_message_match', 'memory_full_text'],
		minEvidenceCount: 1,
		minMessageHitCount: 1,
		minConnectedContactCount: 1,
		requireEvidenceSnippets: true,
		requireTimestamps: true,
		requireConfidence: true,
	},
	{
		id: 'legacy_source_message_recall',
		query: 'DePIN infra pilots',
		description:
			'Legacy sourceMessageId memories participate when the message mapping is deterministic.',
		search: { messageRecallQueryText: 'DePIN infra pilots' },
		expectedNodeName: 'Solana DePIN',
		expectedNodeId: fixture.nodeIds.solanaDepin,
		maxRank: 1,
		requiredMatchReasons: ['evidence_message_match', 'matched in message evidence'],
		requiredMessageRecallReasons: ['evidence_message_match', 'memory_full_text'],
		minEvidenceCount: 1,
		minMessageHitCount: 1,
		minConnectedContactCount: 1,
		requireEvidenceSnippets: true,
		requireTimestamps: true,
		requireConfidence: true,
	},
	{
		id: 'node_and_message_boost',
		query: 'rollup migration',
		description: 'Node semantic recall plus message recall ranks Base L2 above node-only matches.',
		search: { useEmbedding: true, messageRecallQueryText: 'consumer payments rollout' },
		expectedNodeName: 'Base L2',
		expectedNodeId: fixture.nodeIds.baseL2,
		maxRank: 1,
		requiredMatchReasons: ['semantic similarity', 'matched in message evidence'],
		requiredMessageRecallReasons: ['evidence_message_match', 'memory_full_text'],
		minEvidenceCount: 1,
		minMessageHitCount: 1,
		minConnectedContactCount: 1,
		requireEvidenceSnippets: true,
		requireTimestamps: true,
		requireConfidence: true,
	},
	{
		id: 'weak_memory_no_result',
		query: 'weak vague topic',
		description: 'Weak memory-only hits do not create confident search results.',
		search: { messageRecallQueryText: 'weak vague topic' },
		expectedNodeName: null,
		expectNoConfidentResults: true,
	},
	{
		id: 'unrelated_no_result',
		query: 'totally unrelated query',
		description: 'Low-similarity semantic nearest neighbors do not pass the confidence threshold.',
		search: { useEmbedding: true, messageRecallQueryText: null },
		expectedNodeName: null,
		expectNoConfidentResults: true,
	},
	{
		id: 'ambiguous_legacy_skipped',
		query: 'ambiguous base',
		description: 'Multi-message legacy memories are ignored instead of becoming recall candidates.',
		search: { messageRecallQueryText: 'ambiguous base' },
		expectedNodeName: null,
		expectNoConfidentResults: true,
		expectAmbiguousIgnored: true,
	},
];

function roundLatency(value: number): number {
	return Math.round(value * 100) / 100;
}

function resultContainsTimestamp(result: KnowledgeSearchResultWithEvidence | undefined): boolean {
	if (!result) return false;
	if (result.latestEvidenceAt || result.messageMatchedAt) return true;
	if (result.evidence.some((row) => row.occurredAt || row.createdAt)) return true;
	return result.contacts.some(
		(contact) =>
			Boolean(contact.lastEvidenceAt) ||
			contact.evidence.some((row) => row.occurredAt || row.createdAt),
	);
}

function resultContainsConfidence(result: KnowledgeSearchResultWithEvidence | undefined): boolean {
	if (!result) return false;
	if (typeof result.topConfidence === 'number') return true;
	if (result.evidence.some((row) => typeof row.confidence === 'number')) return true;
	return result.contacts.some(
		(contact) =>
			typeof contact.strength === 'number' ||
			contact.evidence.some((row) => typeof row.confidence === 'number'),
	);
}

function resultContainsEvidenceSnippet(
	result: KnowledgeSearchResultWithEvidence | undefined,
): boolean {
	if (!result) return false;
	if (result.evidence.some((row) => typeof row.snippet === 'string' && row.snippet.length > 0)) {
		return true;
	}
	return result.contacts.some((contact) =>
		contact.evidence.some((row) => typeof row.snippet === 'string' && row.snippet.length > 0),
	);
}

function hasForbiddenText(results: KnowledgeSearchResultWithEvidence[], forbidden: string[]) {
	const serialized = JSON.stringify(results);
	return forbidden.filter((value) => serialized.includes(value));
}

async function evaluateCase(
	testCase: KnowledgeRecallQualityCase,
	search: (input: FixtureSearchInput) => Promise<KnowledgeSearchResultWithEvidence[]>,
	measureLatency: boolean,
): Promise<KnowledgeRecallQueryMetric> {
	const startedAt = performance.now();
	const results = await search({ query: testCase.query, ...testCase.search });
	const latencyMs = measureLatency ? roundLatency(performance.now() - startedAt) : 0;
	const failures: string[] = [];
	const warnings: string[] = [];
	const expectedIndex = testCase.expectedNodeId
		? results.findIndex((result) => result.node.id === testCase.expectedNodeId)
		: -1;
	const expectedResult = expectedIndex >= 0 ? results[expectedIndex] : undefined;
	const topResult = results[0];
	const metricResult = expectedResult ?? topResult;
	const actualRank = expectedIndex >= 0 ? expectedIndex + 1 : null;
	const maxRank = testCase.maxRank ?? 1;
	const forbiddenTerms = hasForbiddenText(results, testCase.forbiddenText ?? []);
	const decoyTerms = hasForbiddenText(results, ['Decoy workspace', fixture.decoyWorkspaceId]);
	const crossWorkspaceDecoysExcluded = decoyTerms.length === 0;
	const ambiguousLegacyIgnored =
		testCase.expectAmbiguousIgnored === true ? results.length === 0 : null;
	const matchReasons = metricResult?.matchReasons ?? [];
	const messageRecallReasons = metricResult?.messageRecallReasons ?? [];
	const evidenceCount = metricResult?.evidenceCount ?? 0;
	const messageHitCount = metricResult?.messageHitCount ?? 0;
	const connectedContactCount = metricResult?.connectedContactCount ?? 0;
	const hasEvidenceSnippets = resultContainsEvidenceSnippet(metricResult);
	const hasTimestamps = resultContainsTimestamp(metricResult);
	const hasConfidence = resultContainsConfidence(metricResult);

	if (testCase.expectNoConfidentResults) {
		if (results.length > 0) failures.push('expected no confident results');
	} else {
		if (!expectedResult) failures.push(`missing expected node: ${testCase.expectedNodeName}`);
		if (actualRank !== null && actualRank > maxRank) {
			failures.push(`expected rank <= ${maxRank}, got ${actualRank}`);
		}
	}

	for (const reason of testCase.requiredMatchReasons ?? []) {
		if (!matchReasons.includes(reason)) failures.push(`missing match reason: ${reason}`);
	}

	for (const reason of testCase.requiredMessageRecallReasons ?? []) {
		if (!messageRecallReasons.includes(reason)) {
			failures.push(`missing message recall reason: ${reason}`);
		}
	}

	if (evidenceCount < (testCase.minEvidenceCount ?? 0)) {
		failures.push(
			`evidence count below threshold: expected >= ${testCase.minEvidenceCount}, got ${evidenceCount}`,
		);
	}
	if (messageHitCount < (testCase.minMessageHitCount ?? 0)) {
		failures.push(
			`message hit count below threshold: expected >= ${testCase.minMessageHitCount}, got ${messageHitCount}`,
		);
	}
	if (connectedContactCount < (testCase.minConnectedContactCount ?? 0)) {
		failures.push(
			`connected contact count below threshold: expected >= ${testCase.minConnectedContactCount}, got ${connectedContactCount}`,
		);
	}
	if (testCase.requireEvidenceSnippets && !hasEvidenceSnippets) {
		failures.push('missing evidence snippet');
	}
	if (testCase.requireTimestamps && !hasTimestamps) failures.push('missing timestamp');
	if (testCase.requireConfidence && !hasConfidence) failures.push('missing confidence');
	if (testCase.expectDecoyExcluded && !crossWorkspaceDecoysExcluded) {
		failures.push(`cross-workspace decoy data appeared: ${decoyTerms.join(', ')}`);
	}
	if (testCase.expectAmbiguousIgnored && !ambiguousLegacyIgnored) {
		failures.push('ambiguous legacy memory affected results');
	}
	if (forbiddenTerms.length > 0) {
		failures.push(`forbidden text appeared: ${forbiddenTerms.join(', ')}`);
	}

	return {
		id: testCase.id,
		query: testCase.query,
		expectedNode: testCase.expectedNodeName,
		expectedRank: testCase.expectNoConfidentResults ? null : maxRank,
		actualRank,
		actualTopNode: topResult?.node.displayName ?? null,
		resultCount: results.length,
		matchReasons,
		messageRecallReasons,
		evidenceCount,
		messageHitCount,
		connectedContactCount,
		hasEvidenceSnippets,
		hasTimestamps,
		hasConfidence,
		crossWorkspaceDecoysExcluded,
		ambiguousLegacyIgnored,
		latencyMs,
		passed: failures.length === 0,
		failures,
		warnings,
	};
}

function buildPrivacyIsolationCheck(queries: KnowledgeRecallQueryMetric[]) {
	const stableOutput = JSON.stringify({ suite: 'knowledge-recall', queries });
	const forbiddenTokens = [
		fixture.workspaceId,
		fixture.decoyWorkspaceId,
		'workspaceId',
		'embedding',
		'encryptedWrk',
		'kmsContext',
		'nameBlindIndex',
		'metadata',
		'fixture-bik',
		'555-0101',
		'alice@example.com',
	];
	const failures = forbiddenTokens
		.filter((token) => stableOutput.includes(token))
		.map((token) => `quality output contains forbidden token: ${token}`);
	return {
		passed: failures.length === 0,
		checkedCategories: [
			'embeddings',
			'encryption keys',
			'workspace identifiers',
			'internal-only fields',
			'private raw-message details',
		],
		failures,
	};
}

export async function runKnowledgeRecallQualityGate(
	options: KnowledgeRecallQualityOptions = {},
): Promise<KnowledgeRecallQualityReport> {
	const cases = options.cases ?? DEFAULT_RECALL_QUALITY_CASES;
	const search = options.search ?? runFixtureSearch;
	const measureLatency = options.measureLatency ?? true;
	const queries: KnowledgeRecallQueryMetric[] = [];

	for (const testCase of cases) {
		queries.push(await evaluateCase(testCase, search, measureLatency));
	}

	const privacyIsolation = buildPrivacyIsolationCheck(queries);
	const totalLatency = queries.reduce((sum, query) => sum + query.latencyMs, 0);
	const slowestQuery = queries.reduce<KnowledgeRecallQueryMetric | null>((slowest, query) => {
		if (!slowest || query.latencyMs > slowest.latencyMs) return query;
		return slowest;
	}, null);
	const evidenceRequired = cases.filter((testCase) => (testCase.minEvidenceCount ?? 0) > 0);
	const messageRecallRequired = cases.filter((testCase) => (testCase.minMessageHitCount ?? 0) > 0);
	const failedQueries = queries.filter((query) => !query.passed).length;
	const status = failedQueries === 0 && privacyIsolation.passed ? 'passed' : 'failed';

	return {
		suite: 'knowledge-recall',
		status,
		totalQueries: queries.length,
		passedQueries: queries.length - failedQueries,
		failedQueries,
		averageLatencyMs: queries.length === 0 ? 0 : roundLatency(totalLatency / queries.length),
		slowestQuery: slowestQuery
			? { query: slowestQuery.query, latencyMs: slowestQuery.latencyMs }
			: null,
		evidenceCoverage: {
			queriesRequiringEvidence: evidenceRequired.length,
			queriesWithEvidence: queries.filter((query) => query.evidenceCount > 0).length,
			totalEvidenceCount: queries.reduce((sum, query) => sum + query.evidenceCount, 0),
		},
		messageRecallCoverage: {
			queriesRequiringMessageRecall: messageRecallRequired.length,
			queriesWithMessageRecall: queries.filter((query) => query.messageHitCount > 0).length,
			totalMessageHits: queries.reduce((sum, query) => sum + query.messageHitCount, 0),
		},
		privacyIsolation,
		queries,
	};
}

export function toStableQualitySnapshot(report: KnowledgeRecallQualityReport) {
	return {
		suite: report.suite,
		status: report.status,
		totalQueries: report.totalQueries,
		passedQueries: report.passedQueries,
		failedQueries: report.failedQueries,
		evidenceCoverage: report.evidenceCoverage,
		messageRecallCoverage: report.messageRecallCoverage,
		privacyIsolation: {
			passed: report.privacyIsolation.passed,
			checkedCategories: report.privacyIsolation.checkedCategories,
			failures: report.privacyIsolation.failures,
		},
		queries: report.queries.map((query) => ({
			id: query.id,
			query: query.query,
			expectedNode: query.expectedNode,
			expectedRank: query.expectedRank,
			actualRank: query.actualRank,
			actualTopNode: query.actualTopNode,
			resultCount: query.resultCount,
			matchReasons: query.matchReasons,
			messageRecallReasons: query.messageRecallReasons,
			evidenceCount: query.evidenceCount,
			messageHitCount: query.messageHitCount,
			connectedContactCount: query.connectedContactCount,
			hasEvidenceSnippets: query.hasEvidenceSnippets,
			hasTimestamps: query.hasTimestamps,
			hasConfidence: query.hasConfidence,
			crossWorkspaceDecoysExcluded: query.crossWorkspaceDecoysExcluded,
			ambiguousLegacyIgnored: query.ambiguousLegacyIgnored,
			passed: query.passed,
			failures: query.failures,
		})),
	};
}

export function formatKnowledgeRecallQualitySummary(report: KnowledgeRecallQualityReport): string {
	const lines = [
		`Knowledge recall quality gate: ${report.status}`,
		`Queries: ${report.passedQueries}/${report.totalQueries} passed`,
		`Average latency: ${report.averageLatencyMs} ms`,
		`Slowest query: ${report.slowestQuery?.query ?? 'n/a'} (${report.slowestQuery?.latencyMs ?? 0} ms)`,
		`Evidence coverage: ${report.evidenceCoverage.queriesWithEvidence}/${report.evidenceCoverage.queriesRequiringEvidence} required queries, ${report.evidenceCoverage.totalEvidenceCount} total evidence rows surfaced`,
		`Message recall coverage: ${report.messageRecallCoverage.queriesWithMessageRecall}/${report.messageRecallCoverage.queriesRequiringMessageRecall} required queries, ${report.messageRecallCoverage.totalMessageHits} total message hits`,
		`Privacy/isolation checks: ${report.privacyIsolation.passed ? 'passed' : 'failed'}`,
	];

	const failures = [
		...report.privacyIsolation.failures,
		...report.queries.flatMap((query) =>
			query.failures.map((failure) => `${query.id}: ${failure}`),
		),
	];
	if (failures.length > 0) {
		lines.push('Failures:');
		for (const failure of failures) lines.push(`- ${failure}`);
	}

	return lines.join('\n');
}
