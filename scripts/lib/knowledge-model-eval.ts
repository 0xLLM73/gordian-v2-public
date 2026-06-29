import {
	type ExtractedKnowledgeRelation,
	parseKnowledgeInferenceJson,
} from '../../apps/worker/src/ai/knowledge-llm';
import {
	assessKnowledgeRelationshipCandidateForPromotion,
	type KnowledgeLinkType,
} from '../../packages/db/src/dal/knowledge-relationship-promotion';

export type KnowledgeModelEvalModelId = 'gemma4-12b' | 'qwen3.5-9b';

export interface KnowledgeModelEvalFixture {
	id: string;
	description: string;
	sourceMessages: Array<{ id: string; text: string }>;
	expectedEntities: string[];
	expectedRelations: Array<{
		headMention: string;
		relationType: ExtractedKnowledgeRelation['relationType'];
		tailMention: string;
		temporalStatus: ExtractedKnowledgeRelation['temporalStatus'];
		negated: boolean;
		isExplicit: boolean;
		promotable: boolean;
		quote: string;
	}>;
	minEntityRecall: number;
	minRelationRecall: number;
	modelOutputs: Partial<Record<KnowledgeModelEvalModelId, string>>;
}

export interface KnowledgeModelEvalResult {
	fixtureId: string;
	modelId: KnowledgeModelEvalModelId;
	jsonParsed: boolean;
	entityPrecision: number;
	entityRecall: number;
	relationPrecision: number;
	relationRecall: number;
	quoteVerificationRate: number;
	promotableExpected: number;
	promotableActual: number;
	safetyViolations: string[];
	passed: boolean;
}

export interface EvidenceRetrievalEvalCase {
	id: string;
	query: string;
	k: number;
	expectedChunkIds: string[];
	forbiddenChunkIds?: string[];
	results: EvidenceRetrievalEvalResult[];
}

export interface EvidenceRetrievalEvalResult {
	node: { id: string; displayName?: string };
	matchReasons?: string[];
	evidenceChunkMatchedChunkIds?: string[];
	evidenceChunks?: Array<{
		id: string;
		maskedText: string;
		similarity?: number | null;
		[key: string]: unknown;
	}>;
}

export interface EvidenceRetrievalEvalScore {
	caseId: string;
	query: string;
	k: number;
	expectedChunkCount: number;
	matchedExpectedChunkCount: number;
	recallAtK: number;
	topChunkExact: boolean;
	forbiddenChunkSeen: boolean;
	unsafeFieldLeaks: string[];
	passed: boolean;
}

export interface KnowledgeModelEvalReport {
	suite: 'knowledge-model-eval';
	status: 'passed' | 'failed';
	modelResults: KnowledgeModelEvalResult[];
	retrievalResults: EvidenceRetrievalEvalScore[];
	summary: {
		modelCases: number;
		modelCasesPassed: number;
		retrievalCases: number;
		retrievalCasesPassed: number;
		safetyViolations: number;
	};
}

function normalizeLabel(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[\s_-]+/g, ' ');
}

function relationKey(input: {
	headMention: string;
	relationType: string;
	tailMention: string;
}): string {
	return [
		normalizeLabel(input.headMention),
		input.relationType.toLowerCase(),
		normalizeLabel(input.tailMention),
	].join('|');
}

function sourceTextById(fixture: KnowledgeModelEvalFixture): Map<string, string> {
	return new Map(fixture.sourceMessages.map((message) => [message.id, message.text]));
}

function quoteVerified(
	relation: ExtractedKnowledgeRelation,
	sources: Map<string, string>,
): boolean {
	if (!relation.quote?.trim()) return false;
	const sourceText = relation.sourceMessageId ? sources.get(relation.sourceMessageId) : undefined;
	if (!sourceText) return false;
	if (
		typeof relation.charStart === 'number' &&
		typeof relation.charEnd === 'number' &&
		relation.charStart >= 0 &&
		relation.charEnd > relation.charStart &&
		sourceText.slice(relation.charStart, relation.charEnd) === relation.quote
	) {
		return true;
	}
	return sourceText.includes(relation.quote);
}

function setScores(expected: string[], actual: string[]): { precision: number; recall: number } {
	const expectedSet = new Set(expected.map(normalizeLabel));
	const actualSet = new Set(actual.map(normalizeLabel));
	const truePositiveCount = [...actualSet].filter((value) => expectedSet.has(value)).length;
	return {
		precision:
			actualSet.size === 0 ? (expectedSet.size === 0 ? 1 : 0) : truePositiveCount / actualSet.size,
		recall: expectedSet.size === 0 ? 1 : truePositiveCount / expectedSet.size,
	};
}

function assessParsedRelation(
	relation: ExtractedKnowledgeRelation,
	quoteIsVerified: boolean,
): ReturnType<typeof assessKnowledgeRelationshipCandidateForPromotion> {
	return assessKnowledgeRelationshipCandidateForPromotion({
		sourceNodeId: '11111111-1111-4111-8111-111111111111',
		targetNodeId: '22222222-2222-4222-8222-222222222222',
		linkType: relation.relationType as KnowledgeLinkType,
		evidenceKind: 'llm_extracted',
		messageId: relation.sourceMessageId ?? null,
		metadata: {
			confirmedEligible: relation.confirmedEligible,
			isExplicit: relation.isExplicit,
			negated: relation.negated,
			quoteVerified: quoteIsVerified,
			temporalStatus: relation.temporalStatus,
		},
	});
}

export function evaluateKnowledgeModelOutput(
	fixture: KnowledgeModelEvalFixture,
	modelId: KnowledgeModelEvalModelId,
	rawOutput: string,
): KnowledgeModelEvalResult {
	let parsed: ReturnType<typeof parseKnowledgeInferenceJson>;
	try {
		parsed = parseKnowledgeInferenceJson(rawOutput);
	} catch {
		parsed = { entities: [], relations: [] };
	}

	const jsonParsed =
		parsed.entities.length > 0 || parsed.relations.length > 0 || rawOutput.trim() === '{}';
	const entityScores = setScores(
		fixture.expectedEntities,
		parsed.entities.map((entity) => entity.displayName || entity.name),
	);
	const expectedRelationKeys = new Set(fixture.expectedRelations.map(relationKey));
	const actualRelationKeys = new Set(parsed.relations.map(relationKey));
	const matchedRelationCount = [...actualRelationKeys].filter((key) =>
		expectedRelationKeys.has(key),
	).length;
	const relationPrecision =
		actualRelationKeys.size === 0
			? expectedRelationKeys.size === 0
				? 1
				: 0
			: matchedRelationCount / actualRelationKeys.size;
	const relationRecall =
		expectedRelationKeys.size === 0 ? 1 : matchedRelationCount / expectedRelationKeys.size;

	const sources = sourceTextById(fixture);
	const safetyViolations: string[] = [];
	let verifiedQuoteCount = 0;
	let promotableActual = 0;

	for (const relation of parsed.relations) {
		const verified = quoteVerified(relation, sources);
		if (verified) verifiedQuoteCount++;
		const assessment = assessParsedRelation(relation, verified);
		if (assessment.canPromote) promotableActual++;

		const expected = fixture.expectedRelations.find(
			(candidate) => relationKey(candidate) === relationKey(relation),
		);
		if (!expected && assessment.canPromote) {
			safetyViolations.push(`unexpected promotable relation: ${relationKey(relation)}`);
		}
		if (expected && assessment.canPromote !== expected.promotable) {
			safetyViolations.push(
				`promotion mismatch for ${relationKey(relation)}: expected ${expected.promotable}, got ${assessment.canPromote}`,
			);
		}
		if (relation.confirmedEligible && !assessment.canPromote) {
			safetyViolations.push(
				`confirmedEligible relation blocked by promotion gate: ${relationKey(relation)} (${assessment.reason})`,
			);
		}
	}

	const promotableExpected = fixture.expectedRelations.filter(
		(relation) => relation.promotable,
	).length;
	const quoteVerificationRate =
		parsed.relations.length === 0
			? fixture.expectedRelations.length === 0
				? 1
				: 0
			: verifiedQuoteCount / parsed.relations.length;
	const passed =
		jsonParsed &&
		entityScores.recall >= fixture.minEntityRecall &&
		relationRecall >= fixture.minRelationRecall &&
		safetyViolations.length === 0;

	return {
		fixtureId: fixture.id,
		modelId,
		jsonParsed,
		entityPrecision: Number(entityScores.precision.toFixed(4)),
		entityRecall: Number(entityScores.recall.toFixed(4)),
		relationPrecision: Number(relationPrecision.toFixed(4)),
		relationRecall: Number(relationRecall.toFixed(4)),
		quoteVerificationRate: Number(quoteVerificationRate.toFixed(4)),
		promotableExpected,
		promotableActual,
		safetyViolations,
		passed,
	};
}

function unsafeChunkFields(chunk: Record<string, unknown>): string[] {
	return ['embedding', 'metadata', 'nameBlindIndex', 'encryptedWrk'].filter(
		(field) => field in chunk,
	);
}

export function scoreEvidenceRetrievalCase(
	testCase: EvidenceRetrievalEvalCase,
): EvidenceRetrievalEvalScore {
	const chunks = testCase.results
		.flatMap((result) => result.evidenceChunks ?? [])
		.slice(0, testCase.k);
	const chunkIds = chunks.map((chunk) => chunk.id);
	const expected = new Set(testCase.expectedChunkIds);
	const forbidden = new Set(testCase.forbiddenChunkIds ?? []);
	const matchedExpectedChunkCount = chunkIds.filter((id) => expected.has(id)).length;
	const forbiddenChunkSeen = chunkIds.some((id) => forbidden.has(id));
	const unsafeFieldLeaks = chunks.flatMap((chunk) =>
		unsafeChunkFields(chunk).map((field) => `${chunk.id}:${field}`),
	);
	const recallAtK =
		expected.size === 0 ? 1 : matchedExpectedChunkCount / Math.max(1, expected.size);

	return {
		caseId: testCase.id,
		query: testCase.query,
		k: testCase.k,
		expectedChunkCount: expected.size,
		matchedExpectedChunkCount,
		recallAtK: Number(recallAtK.toFixed(4)),
		topChunkExact: chunks[0] ? expected.has(chunks[0].id) : expected.size === 0,
		forbiddenChunkSeen,
		unsafeFieldLeaks,
		passed: recallAtK >= 1 && !forbiddenChunkSeen && unsafeFieldLeaks.length === 0,
	};
}

export const defaultKnowledgeModelEvalFixtures: KnowledgeModelEvalFixture[] = [
	{
		id: 'explicit_affiliation_and_request',
		description: 'Current quote-backed affiliation and request should be promotable',
		sourceMessages: [
			{ id: 'm1', text: 'Alice at Acme asked for the migration plan.' },
			{ id: 'm2', text: 'Cara requested the security review.' },
		],
		expectedEntities: ['Alice', 'Acme', 'migration plan', 'Cara', 'security review'],
		expectedRelations: [
			{
				headMention: 'Alice',
				relationType: 'affiliated_with',
				tailMention: 'Acme',
				temporalStatus: 'current',
				negated: false,
				isExplicit: true,
				promotable: true,
				quote: 'Alice at Acme asked for the migration plan.',
			},
			{
				headMention: 'Cara',
				relationType: 'requested',
				tailMention: 'security review',
				temporalStatus: 'current',
				negated: false,
				isExplicit: true,
				promotable: true,
				quote: 'Cara requested the security review.',
			},
		],
		minEntityRecall: 0.8,
		minRelationRecall: 1,
		modelOutputs: {
			'gemma4-12b': JSON.stringify({
				entities: [
					{ type: 'topic', name: 'Alice', relationship_type: 'knows_about', confidence: 0.9 },
					{ type: 'organization', name: 'Acme', relationship_type: 'member_of', confidence: 0.9 },
					{
						type: 'project',
						name: 'migration plan',
						relationship_type: 'works_on',
						confidence: 0.85,
					},
					{ type: 'topic', name: 'Cara', relationship_type: 'knows_about', confidence: 0.9 },
					{
						type: 'topic',
						name: 'security review',
						relationship_type: 'works_on',
						confidence: 0.9,
					},
				],
				relations: [
					{
						head_mention: 'Alice',
						relation_type: 'AFFILIATED_WITH',
						tail_mention: 'Acme',
						direction: 'head_to_tail',
						source_message_id: 'm1',
						quote: 'Alice at Acme asked for the migration plan.',
						is_explicit: true,
						negated: false,
						temporal_status: 'current',
						confirmed_eligible: true,
					},
					{
						head_mention: 'Cara',
						relation_type: 'REQUESTED',
						tail_mention: 'security review',
						direction: 'head_to_tail',
						source_message_id: 'm2',
						quote: 'Cara requested the security review.',
						is_explicit: true,
						negated: false,
						temporal_status: 'current',
						confirmed_eligible: true,
					},
				],
			}),
			'qwen3.5-9b': JSON.stringify({
				items: [
					{ type: 'topic', name: 'Alice', relationship: 'knows_about', score: 0.91 },
					{ type: 'organization', name: 'Acme', relationship: 'member_of', score: 0.9 },
					{ type: 'project', name: 'migration plan', relationship: 'works_on', score: 0.82 },
					{ type: 'topic', name: 'Cara', relationship: 'knows_about', score: 0.9 },
					{ type: 'topic', name: 'security review', relationship: 'works_on', score: 0.9 },
				],
				relationships: [
					{
						subject: 'Alice',
						predicate: 'affiliated',
						object: 'Acme',
						sourceMessageId: 'm1',
						quote: 'Alice at Acme asked for the migration plan.',
						isExplicit: 'true',
						negated: 'false',
						temporalStatus: 'current',
						promotable: 'true',
					},
					{
						subject: 'Cara',
						predicate: 'requested',
						object: 'security review',
						sourceMessageId: 'm2',
						quote: 'Cara requested the security review.',
						isExplicit: 'true',
						negated: 'false',
						temporalStatus: 'current',
						promotable: 'true',
					},
				],
			}),
		},
	},
	{
		id: 'negated_and_stale_safety',
		description: 'Negated and stale relations must stay review-only',
		sourceMessages: [
			{ id: 'm1', text: 'Alice is not working with Acme anymore.' },
			{ id: 'm2', text: 'We used to use HubSpot before moving to Attio.' },
		],
		expectedEntities: ['Alice', 'Acme', 'HubSpot', 'Attio'],
		expectedRelations: [
			{
				headMention: 'Alice',
				relationType: 'affiliated_with',
				tailMention: 'Acme',
				temporalStatus: 'past',
				negated: true,
				isExplicit: true,
				promotable: false,
				quote: 'Alice is not working with Acme anymore.',
			},
			{
				headMention: 'we',
				relationType: 'uses',
				tailMention: 'HubSpot',
				temporalStatus: 'past',
				negated: false,
				isExplicit: true,
				promotable: false,
				quote: 'We used to use HubSpot before moving to Attio.',
			},
			{
				headMention: 'we',
				relationType: 'uses',
				tailMention: 'Attio',
				temporalStatus: 'current',
				negated: false,
				isExplicit: true,
				promotable: true,
				quote: 'We used to use HubSpot before moving to Attio.',
			},
		],
		minEntityRecall: 0.75,
		minRelationRecall: 1,
		modelOutputs: {
			'gemma4-12b': JSON.stringify({
				entities: [
					{ type: 'topic', name: 'Alice', relationship_type: 'knows_about', confidence: 0.9 },
					{ type: 'organization', name: 'Acme', relationship_type: 'member_of', confidence: 0.9 },
					{ type: 'technology', name: 'HubSpot', relationship_type: 'uses', confidence: 0.9 },
					{ type: 'technology', name: 'Attio', relationship_type: 'uses', confidence: 0.9 },
				],
				relations: [
					{
						head_mention: 'Alice',
						relation_type: 'AFFILIATED_WITH',
						tail_mention: 'Acme',
						direction: 'head_to_tail',
						source_message_id: 'm1',
						quote: 'Alice is not working with Acme anymore.',
						is_explicit: true,
						negated: true,
						temporal_status: 'past',
						confirmed_eligible: false,
					},
					{
						head_mention: 'we',
						relation_type: 'USES',
						tail_mention: 'HubSpot',
						direction: 'head_to_tail',
						source_message_id: 'm2',
						quote: 'We used to use HubSpot before moving to Attio.',
						is_explicit: true,
						negated: false,
						temporal_status: 'past',
						confirmed_eligible: false,
					},
					{
						head_mention: 'we',
						relation_type: 'USES',
						tail_mention: 'Attio',
						direction: 'head_to_tail',
						source_message_id: 'm2',
						quote: 'We used to use HubSpot before moving to Attio.',
						is_explicit: true,
						negated: false,
						temporal_status: 'current',
						confirmed_eligible: true,
					},
				],
			}),
			'qwen3.5-9b': JSON.stringify({
				entities: [
					{ type: 'topic', name: 'Alice', relationshipType: 'knows_about', confidence: 0.9 },
					{ type: 'organization', name: 'Acme', relationshipType: 'member_of', confidence: 0.9 },
					{ type: 'technology', name: 'HubSpot', relationshipType: 'uses', confidence: 0.88 },
					{ type: 'technology', name: 'Attio', relationshipType: 'uses', confidence: 0.89 },
				],
				edges: [
					{
						headMention: 'Alice',
						linkType: 'affiliated',
						tailMention: 'Acme',
						sourceMessageId: 'm1',
						quote: 'Alice is not working with Acme anymore.',
						isExplicit: true,
						negated: true,
						temporalStatus: 'past',
						confirmedEligible: false,
					},
					{
						headMention: 'we',
						linkType: 'used_to_use',
						tailMention: 'HubSpot',
						sourceMessageId: 'm2',
						quote: 'We used to use HubSpot before moving to Attio.',
						isExplicit: true,
						negated: false,
						temporalStatus: 'past',
						confirmedEligible: false,
					},
					{
						headMention: 'we',
						linkType: 'uses',
						tailMention: 'Attio',
						sourceMessageId: 'm2',
						quote: 'We used to use HubSpot before moving to Attio.',
						isExplicit: true,
						negated: false,
						temporalStatus: 'current',
						confirmedEligible: true,
					},
				],
			}),
		},
	},
];

export const defaultEvidenceRetrievalEvalCases: EvidenceRetrievalEvalCase[] = [
	{
		id: 'evidence_chunk_exact_query',
		query: 'Atlas Retrieval embeddings benchmark',
		k: 3,
		expectedChunkIds: ['chunk-atlas-evidence'],
		forbiddenChunkIds: ['chunk-decoy-workspace'],
		results: [
			{
				node: { id: 'node-atlas', displayName: 'Atlas Retrieval' },
				matchReasons: ['evidence_chunk_match', 'matched in evidence chunk'],
				evidenceChunkMatchedChunkIds: ['chunk-atlas-evidence'],
				evidenceChunks: [
					{
						id: 'chunk-atlas-evidence',
						maskedText: 'Alex said Atlas Retrieval should be benchmarked with local embeddings.',
						similarity: 0.94,
					},
				],
			},
		],
	},
];

export function buildKnowledgeModelEvalReport(params?: {
	modelFixtures?: KnowledgeModelEvalFixture[];
	retrievalCases?: EvidenceRetrievalEvalCase[];
}): KnowledgeModelEvalReport {
	const modelFixtures = params?.modelFixtures ?? defaultKnowledgeModelEvalFixtures;
	const retrievalCases = params?.retrievalCases ?? defaultEvidenceRetrievalEvalCases;
	const modelResults = modelFixtures.flatMap((fixture) =>
		(Object.entries(fixture.modelOutputs) as Array<[KnowledgeModelEvalModelId, string]>).map(
			([modelId, rawOutput]) => evaluateKnowledgeModelOutput(fixture, modelId, rawOutput),
		),
	);
	const retrievalResults = retrievalCases.map(scoreEvidenceRetrievalCase);
	const safetyViolations = modelResults.reduce(
		(sum, result) => sum + result.safetyViolations.length,
		0,
	);
	const modelCasesPassed = modelResults.filter((result) => result.passed).length;
	const retrievalCasesPassed = retrievalResults.filter((result) => result.passed).length;
	const status =
		modelCasesPassed === modelResults.length &&
		retrievalCasesPassed === retrievalResults.length &&
		safetyViolations === 0
			? 'passed'
			: 'failed';

	return {
		suite: 'knowledge-model-eval',
		status,
		modelResults,
		retrievalResults,
		summary: {
			modelCases: modelResults.length,
			modelCasesPassed,
			retrievalCases: retrievalResults.length,
			retrievalCasesPassed,
			safetyViolations,
		},
	};
}
