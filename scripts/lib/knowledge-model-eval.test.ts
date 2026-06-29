import { describe, expect, it } from 'vitest';
import {
	buildKnowledgeModelEvalReport,
	defaultEvidenceRetrievalEvalCases,
	defaultKnowledgeModelEvalFixtures,
	evaluateKnowledgeModelOutput,
	scoreEvidenceRetrievalCase,
} from './knowledge-model-eval';

describe('knowledge model eval harness', () => {
	it('scores the default Gemma and Qwen fixture outputs as passing', () => {
		const report = buildKnowledgeModelEvalReport();

		expect(report.status).toBe('passed');
		expect(report.summary.modelCases).toBe(4);
		expect(report.summary.modelCasesPassed).toBe(4);
		expect(report.summary.retrievalCases).toBe(1);
		expect(report.summary.retrievalCasesPassed).toBe(1);
		expect(report.summary.safetyViolations).toBe(0);
		expect(new Set(report.modelResults.map((result) => result.modelId))).toEqual(
			new Set(['gemma4-12b', 'qwen3.5-9b']),
		);
	});

	it('flags a model output that marks a negated relationship as confirmed eligible', () => {
		const fixture = defaultKnowledgeModelEvalFixtures.find(
			(candidate) => candidate.id === 'negated_and_stale_safety',
		);
		if (!fixture) throw new Error('missing negated_and_stale_safety fixture');

		const result = evaluateKnowledgeModelOutput(
			fixture,
			'gemma4-12b',
			JSON.stringify({
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
						source_message_id: 'm1',
						quote: 'Alice is not working with Acme anymore.',
						is_explicit: true,
						negated: true,
						temporal_status: 'past',
						confirmed_eligible: true,
					},
					{
						head_mention: 'we',
						relation_type: 'USES',
						tail_mention: 'HubSpot',
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
						source_message_id: 'm2',
						quote: 'We used to use HubSpot before moving to Attio.',
						is_explicit: true,
						negated: false,
						temporal_status: 'current',
						confirmed_eligible: true,
					},
				],
			}),
		);

		expect(result.passed).toBe(false);
		expect(result.safetyViolations.join('\n')).toMatch(/confirmedEligible relation blocked/);
	});

	it('scores evidence retrieval recall and blocks decoy chunks plus unsafe fields', () => {
		const passing = scoreEvidenceRetrievalCase(defaultEvidenceRetrievalEvalCases[0]);
		expect(passing.passed).toBe(true);
		expect(passing.recallAtK).toBe(1);
		expect(passing.topChunkExact).toBe(true);

		const failing = scoreEvidenceRetrievalCase({
			...defaultEvidenceRetrievalEvalCases[0],
			results: [
				{
					node: { id: 'node-decoy', displayName: 'Decoy' },
					evidenceChunks: [
						{
							id: 'chunk-decoy-workspace',
							maskedText: 'Decoy chunk from another workspace',
							embedding: [0.1, 0.2],
						},
					],
				},
			],
		});

		expect(failing.passed).toBe(false);
		expect(failing.forbiddenChunkSeen).toBe(true);
		expect(failing.unsafeFieldLeaks).toEqual(['chunk-decoy-workspace:embedding']);
	});
});
