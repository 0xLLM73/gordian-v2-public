import { describe, expect, it } from 'vitest';
import {
	knowledgeRelationshipBenchmarkCases,
	validateKnowledgeRelationshipOutput,
	validateKnowledgeRelationshipSafetyOutput,
} from './local-ai-benchmark-relations.mjs';

function relationFromExpectation(testCase, expectation, quote) {
	const charStart = testCase.sourceText.indexOf(quote);
	if (charStart === -1) throw new Error(`test quote not found: ${quote}`);
	return {
		head_mention: expectation.headMention,
		head_node_id: null,
		relation_type: expectation.relationType,
		tail_mention: expectation.tailMention,
		tail_node_id: null,
		direction: expectation.direction,
		source_message_id: 'm1',
		quote,
		char_start: charStart,
		char_end: charStart + quote.length,
		is_explicit: expectation.isExplicit,
		negated: expectation.negated,
		temporal_status: expectation.temporalStatus,
		confirmed_eligible: expectation.confirmedEligible,
		rationale: 'Grounded in the exact quoted source text.',
	};
}

function caseByName(name) {
	const testCase = knowledgeRelationshipBenchmarkCases.find((candidate) => candidate.name === name);
	if (!testCase) throw new Error(`missing test case: ${name}`);
	return testCase;
}

describe('knowledge relationship benchmark cases', () => {
	it('registers the planned KG relationship guardrail cases', () => {
		expect(knowledgeRelationshipBenchmarkCases.map((testCase) => testCase.name)).toEqual([
			'knowledge_relationship_explicit_affiliation',
			'knowledge_relationship_works_on',
			'knowledge_relationship_negated',
			'knowledge_relationship_past_stale',
			'knowledge_relationship_co_mention_trap',
			'knowledge_relationship_direction',
			'knowledge_relationship_unattributed',
			'knowledge_relationship_quote_mismatch_guard',
		]);
	});

	it('accepts grounded expected relation outputs for every positive fixture', () => {
		const quotesByCase = {
			knowledge_relationship_explicit_affiliation: ['Alice at Acme'],
			knowledge_relationship_works_on: ['Ben is working on the Solana payment rails rollout'],
			knowledge_relationship_negated: ['Alice is not working with Acme anymore'],
			knowledge_relationship_past_stale: ['We used to use HubSpot', 'moving to Attio'],
			knowledge_relationship_direction: ['Northstar owns the onboarding project'],
			knowledge_relationship_unattributed: ['Jordan works with Orbit Labs'],
			knowledge_relationship_quote_mismatch_guard: ['Cara requested the security review'],
		};

		for (const [name, quotes] of Object.entries(quotesByCase)) {
			const testCase = caseByName(name);
			const relations = testCase.expectedRelations.map((expectation, index) =>
				relationFromExpectation(testCase, expectation, quotes[index]),
			);

			expect(() => testCase.validate({ relations }, testCase)).not.toThrow();
		}
	});

	it('accepts no relations for the co-mention trap fixture', () => {
		const testCase = caseByName('knowledge_relationship_co_mention_trap');

		expect(() => testCase.validate({ relations: [] }, testCase)).not.toThrow();
	});

	it('rejects ungrounded quotes', () => {
		const testCase = caseByName('knowledge_relationship_quote_mismatch_guard');
		const relation = relationFromExpectation(
			testCase,
			testCase.expectedRelations[0],
			'Cara requested the security review',
		);
		relation.quote = 'Cara asked for legal review';

		expect(() => validateKnowledgeRelationshipOutput({ relations: [relation] }, testCase)).toThrow(
			/ungrounded relation quote/,
		);
	});

	it('rejects source ids outside the fixture source set', () => {
		const testCase = caseByName('knowledge_relationship_direction');
		const relation = relationFromExpectation(
			testCase,
			testCase.expectedRelations[0],
			'Northstar owns the onboarding project',
		);
		relation.source_message_id = 'm999';

		expect(() => validateKnowledgeRelationshipOutput({ relations: [relation] }, testCase)).toThrow(
			/invalid source_message_id/,
		);
	});

	it('accepts grounded quotes when advisory char offsets are imperfect', () => {
		const testCase = caseByName('knowledge_relationship_works_on');
		const relation = relationFromExpectation(
			testCase,
			testCase.expectedRelations[0],
			'Ben is working on the Solana payment rails rollout',
		);
		relation.char_start += 1;

		expect(() =>
			validateKnowledgeRelationshipOutput({ relations: [relation] }, testCase),
		).not.toThrow();
	});

	it('rejects invalid advisory char offset ranges', () => {
		const testCase = caseByName('knowledge_relationship_works_on');
		const relation = relationFromExpectation(
			testCase,
			testCase.expectedRelations[0],
			'Ben is working on the Solana payment rails rollout',
		);
		relation.char_end = relation.char_start;

		expect(() => validateKnowledgeRelationshipOutput({ relations: [relation] }, testCase)).toThrow(
			/char offsets are invalid/,
		);
	});

	it('rejects confirmed-eligible relations for negated evidence', () => {
		const testCase = caseByName('knowledge_relationship_negated');
		const relation = relationFromExpectation(
			testCase,
			testCase.expectedRelations[0],
			'Alice is not working with Acme anymore',
		);
		relation.confirmed_eligible = true;

		expect(() => validateKnowledgeRelationshipOutput({ relations: [relation] }, testCase)).toThrow(
			/expected confirmed_eligible false|forbids confirmed-eligible/,
		);
	});

	it('rejects relationship promotion from co-mention-only evidence', () => {
		const testCase = caseByName('knowledge_relationship_co_mention_trap');
		const quote = 'Alice mentioned Acme and Stripe';
		const charStart = testCase.sourceText.indexOf(quote);
		const relation = {
			head_mention: 'Acme',
			head_node_id: null,
			relation_type: 'RELATED_TO',
			tail_mention: 'Stripe',
			tail_node_id: null,
			direction: 'undirected',
			source_message_id: 'm1',
			quote,
			char_start: charStart,
			char_end: charStart + quote.length,
			is_explicit: false,
			negated: false,
			temporal_status: 'unknown',
			confirmed_eligible: true,
			rationale: 'They appeared in the same sentence.',
		};

		expect(() => validateKnowledgeRelationshipOutput({ relations: [relation] }, testCase)).toThrow(
			/expected 0 relations|forbids confirmed-eligible/,
		);
	});

	it('normalizes local-model relation and temporal aliases', () => {
		const testCase = caseByName('knowledge_relationship_negated');
		const relation = {
			head_mention: 'Alice',
			relation_type: 'WORKS_WITH',
			tail_mention: 'Acme',
			direction: 'head_to_tail',
			source_message_id: '[source:m1]',
			quote: 'Alice is not working with Acme anymore',
			is_explicit: 'true',
			negated: 'true',
			temporal_status: 'current_state_negation_of_past_affiliation',
			confirmed_eligible: 'false',
			rationale: 'Negated current-state statement.',
		};

		expect(() =>
			validateKnowledgeRelationshipSafetyOutput({ relations: [relation] }, testCase),
		).not.toThrow();
	});

	it('treats safe omissions as safety-pass but strict-quality fail', () => {
		const testCase = caseByName('knowledge_relationship_unattributed');

		expect(() =>
			validateKnowledgeRelationshipSafetyOutput({ relations: [] }, testCase),
		).not.toThrow();
		expect(() => validateKnowledgeRelationshipOutput({ relations: [] }, testCase)).toThrow(
			/expected 1 relations/,
		);
	});

	it('rejects unsafe confirmed-eligible unattributed relations in safety mode', () => {
		const testCase = caseByName('knowledge_relationship_unattributed');
		const relation = relationFromExpectation(
			testCase,
			testCase.expectedRelations[0],
			'Jordan works with Orbit Labs',
		);
		relation.confirmed_eligible = true;

		expect(() =>
			validateKnowledgeRelationshipSafetyOutput({ relations: [relation] }, testCase),
		).toThrow(/forbids confirmed-eligible/);
	});

	it('rejects confirmed-eligible relations without current temporal status in safety mode', () => {
		const testCase = caseByName('knowledge_relationship_quote_mismatch_guard');
		const relation = relationFromExpectation(
			testCase,
			testCase.expectedRelations[0],
			'Cara requested the security review',
		);
		relation.temporal_status = null;

		expect(() =>
			validateKnowledgeRelationshipSafetyOutput({ relations: [relation] }, testCase),
		).toThrow(/non-current temporal status/);
	});
});
