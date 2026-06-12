import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { knowledgeRecallFixture as fixture } from './fixtures/knowledge-recall-fixture';
import {
	type FixtureSearchInput,
	resetFixtureSearchMocks,
	runFixtureSearch,
} from './fixtures/knowledge-recall-harness';
import {
	DEFAULT_RECALL_QUALITY_CASES,
	formatKnowledgeRecallQualitySummary,
	type KnowledgeRecallQualityCase,
	runKnowledgeRecallQualityGate,
	toStableQualitySnapshot,
} from './fixtures/knowledge-recall-quality';

const baselinePath = new URL('./fixtures/knowledge-recall-quality-baseline.json', import.meta.url);

function loadBaseline() {
	return JSON.parse(readFileSync(baselinePath, 'utf8'));
}

function caseById(id: string): KnowledgeRecallQualityCase {
	const testCase = DEFAULT_RECALL_QUALITY_CASES.find((item) => item.id === id);
	if (!testCase) throw new Error(`Missing recall quality case: ${id}`);
	return testCase;
}

function shouldPrintQualityOutput() {
	return (
		process.env.KG_RECALL_QUALITY_PRINT === '1' ||
		process.argv.some((arg) => arg.includes('knowledge-recall-quality'))
	);
}

describe('knowledge recall quality gate', () => {
	beforeEach(() => {
		resetFixtureSearchMocks();
	});

	it('passes on the deterministic fixture and matches the stable baseline', async () => {
		const report = await runKnowledgeRecallQualityGate();

		if (shouldPrintQualityOutput()) {
			console.info(formatKnowledgeRecallQualitySummary(report));
			console.info(`KNOWLEDGE_RECALL_QUALITY_JSON=${JSON.stringify(report)}`);
		}

		expect(report.status).toBe('passed');
		expect(report.failedQueries).toBe(0);
		expect(report.queries.every((query) => query.latencyMs >= 0)).toBe(true);
		expect(toStableQualitySnapshot(report)).toEqual(loadBaseline());
	});

	it('fails when the expected node is missing', async () => {
		const report = await runKnowledgeRecallQualityGate({
			cases: [caseById('exact_ai_agents')],
			search: async () => [],
			measureLatency: false,
		});

		expect(report.status).toBe('failed');
		expect(report.queries[0]?.failures).toEqual(
			expect.arrayContaining(['missing expected node: AI agents']),
		);
	});

	it('fails when the expected node rank is too low', async () => {
		const report = await runKnowledgeRecallQualityGate({
			cases: [caseById('exact_ai_agents')],
			search: async (input: FixtureSearchInput) => {
				const expected = await runFixtureSearch(input);
				const distractor = await runFixtureSearch({
					query: 'CRM automation',
					messageRecallQueryText: null,
				});
				return [distractor[0], ...expected].filter(Boolean);
			},
			measureLatency: false,
		});

		expect(report.status).toBe('failed');
		expect(report.queries[0]?.actualRank).toBe(2);
		expect(report.queries[0]?.failures).toEqual(
			expect.arrayContaining(['expected rank <= 1, got 2']),
		);
	});

	it('fails when evidence is missing', async () => {
		const report = await runKnowledgeRecallQualityGate({
			cases: [caseById('message_recall_helium')],
			search: async (input: FixtureSearchInput) => {
				const results = await runFixtureSearch(input);
				return results.map((result) => ({
					...result,
					evidence: [],
					contacts: [],
					evidenceCount: 0,
					connectedContactCount: 0,
					topConfidence: null,
					latestEvidenceAt: null,
					messageMatchedAt: null,
				}));
			},
			measureLatency: false,
		});

		expect(report.status).toBe('failed');
		expect(report.queries[0]?.failures).toEqual(
			expect.arrayContaining([
				'evidence count below threshold: expected >= 1, got 0',
				'missing evidence snippet',
				'missing timestamp',
				'missing confidence',
			]),
		);
	});

	it('fails when a required match reason is missing', async () => {
		const report = await runKnowledgeRecallQualityGate({
			cases: [caseById('message_recall_helium')],
			search: async (input: FixtureSearchInput) => {
				const results = await runFixtureSearch(input);
				return results.map((result) => ({
					...result,
					matchReasons: result.matchReasons.filter(
						(reason) => reason !== 'matched in message evidence',
					),
				}));
			},
			measureLatency: false,
		});

		expect(report.status).toBe('failed');
		expect(report.queries[0]?.failures).toEqual(
			expect.arrayContaining(['missing match reason: matched in message evidence']),
		);
	});

	it('ignores ambiguous legacy memory rows in the passing fixture', async () => {
		const report = await runKnowledgeRecallQualityGate({
			cases: [caseById('ambiguous_legacy_skipped')],
			measureLatency: false,
		});

		expect(report.status).toBe('passed');
		expect(report.queries[0]).toEqual(
			expect.objectContaining({
				resultCount: 0,
				ambiguousLegacyIgnored: true,
			}),
		);
	});

	it('fails when ambiguous legacy memory rows affect results', async () => {
		const report = await runKnowledgeRecallQualityGate({
			cases: [caseById('ambiguous_legacy_skipped')],
			search: () => runFixtureSearch({ query: 'Base L2' }),
			measureLatency: false,
		});

		expect(report.status).toBe('failed');
		expect(report.queries[0]?.failures).toEqual(
			expect.arrayContaining([
				'expected no confident results',
				'ambiguous legacy memory affected results',
			]),
		);
	});

	it('catches cross-workspace leakage', async () => {
		const report = await runKnowledgeRecallQualityGate({
			cases: [caseById('exact_ai_agents')],
			search: async (input: FixtureSearchInput) => {
				const results = await runFixtureSearch(input);
				return results.map((result) => ({
					...result,
					evidence: result.evidence.map((evidence) => ({
						...evidence,
						snippet: 'Decoy workspace AI agents evidence must never leak.',
					})),
				}));
			},
			measureLatency: false,
		});

		expect(report.status).toBe('failed');
		expect(report.queries[0]?.crossWorkspaceDecoysExcluded).toBe(false);
		expect(report.queries[0]?.failures.join('\n')).toContain('cross-workspace decoy data');
	});

	it('emits valid machine-readable output without embeddings, workspace ids, or raw internals', async () => {
		const report = await runKnowledgeRecallQualityGate({ measureLatency: false });
		const serialized = JSON.stringify(report);
		const parsed = JSON.parse(serialized);

		expect(parsed).toEqual(
			expect.objectContaining({
				suite: 'knowledge-recall',
				status: 'passed',
				queries: expect.any(Array),
			}),
		);
		expect(serialized).not.toContain('"embedding"');
		expect(serialized).not.toContain(fixture.workspaceId);
		expect(serialized).not.toContain(fixture.decoyWorkspaceId);
		expect(serialized).not.toContain('encryptedWrk');
		expect(serialized).not.toContain('kmsContext');
		expect(serialized).not.toContain('nameBlindIndex');
		expect(serialized).not.toContain('metadata');
	});
});
