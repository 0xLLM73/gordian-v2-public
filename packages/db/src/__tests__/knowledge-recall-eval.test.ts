import { beforeEach, describe, expect, it } from 'vitest';
import { knowledgeRecallFixture as fixture } from './fixtures/knowledge-recall-fixture';
import {
	mockExecute,
	mockSetLocal,
	resetFixtureSearchMocks,
	runFixtureSearch,
} from './fixtures/knowledge-recall-harness';

describe('message-backed knowledge recall eval fixture', () => {
	beforeEach(() => {
		resetFixtureSearchMocks();
	});

	it('fixture covers primary and decoy workspaces with contacts, messages, memories, nodes, and evidence', () => {
		expect(new Set(fixture.contacts.map((contact) => contact.workspaceId))).toEqual(
			new Set([fixture.workspaceId, fixture.decoyWorkspaceId]),
		);
		expect(
			fixture.contacts.filter((contact) => contact.workspaceId === fixture.workspaceId),
		).toHaveLength(8);
		expect(
			fixture.messages.filter((message) => message.workspaceId === fixture.workspaceId).length,
		).toBeGreaterThanOrEqual(20);
		expect(fixture.nodes.map((node) => node.type)).toEqual(
			expect.arrayContaining([
				'topic',
				'project',
				'organization',
				'sector',
				'technology',
				'concept',
			]),
		);
		expect(fixture.evidence.length).toBeGreaterThanOrEqual(9);
	});

	it.each([
		['AI agents', fixture.nodeIds.aiAgents, 'Alice said AI agents could automate CRM follow-ups'],
		['CRM automation', fixture.nodeIds.crmAutomation, 'Bob is testing CRM automation'],
		['Solana DePIN', fixture.nodeIds.solanaDepin, 'Carol mentioned DePIN infra on Solana'],
		['Helium', fixture.nodeIds.helium, 'Dan is tracking Helium hotspots'],
	])('returns exact topic recall with evidence for %s', async (query, expectedNodeId, snippet) => {
		const result = await runFixtureSearch({ query });

		expect(result[0]?.node.id).toBe(expectedNodeId);
		expect(result[0]?.exactMatch).toBe(true);
		expect(result[0]?.matchReasons).toEqual(
			expect.arrayContaining(['exact name', 'message evidence', 'contact evidence']),
		);
		expect(result[0]?.contacts[0]).toEqual(
			expect.objectContaining({
				relationType: expect.any(String),
				evidenceCount: 1,
			}),
		);
		expect(result[0]?.evidence[0]).toEqual(
			expect.objectContaining({
				snippet: expect.stringContaining(snippet),
				confidence: expect.any(Number),
				occurredAt: expect.any(Date),
			}),
		);
	});

	it('returns alias recall for DePIN infra and does not confuse Base L2 with base case', async () => {
		const depin = await runFixtureSearch({ query: 'DePIN infra' });
		expect(depin[0]?.node.id).toBe(fixture.nodeIds.solanaDepin);
		expect(depin[0]?.aliasMatch).toBe(true);
		expect(depin[0]?.messageRecallReasons).toEqual(
			expect.arrayContaining(['evidence_message_match', 'memory_full_text']),
		);

		const base = await runFixtureSearch({ query: 'Base L2' });
		expect(base[0]?.node.id).toBe(fixture.nodeIds.baseL2);
		expect(base[0]?.node.id).not.toBe(fixture.nodeIds.baseCase);
		expect(base.map((item) => item.node.id)).not.toContain(fixture.nodeIds.baseCase);
	});

	it('returns semantic node recall when exact and alias recall are absent', async () => {
		const result = await runFixtureSearch({
			query: 'autonomous sales workflows',
			useEmbedding: true,
			messageRecallQueryText: null,
		});

		expect(result.map((item) => item.node.id)).toEqual([
			fixture.nodeIds.crmAutomation,
			fixture.nodeIds.aiAgents,
		]);
		expect(result[0]?.matchReasons).toEqual(expect.arrayContaining(['semantic similarity']));
		expect(result[0]?.similarity).toBeGreaterThanOrEqual(0.62);
	});

	it('discovers a topic through message/memory recall mapped by metadata.messageId', async () => {
		const result = await runFixtureSearch({
			query: 'wireless hotspot rollout',
			messageRecallQueryText: 'wireless hotspot rollout',
		});

		expect(result[0]?.node.id).toBe(fixture.nodeIds.helium);
		expect(result[0]?.messageRecallScore).toBeGreaterThan(0.8);
		expect(result[0]?.messageHitCount).toBe(1);
		expect(result[0]?.messageMatchedEvidenceIds).toEqual([fixture.evidenceIds.helium]);
		expect(result[0]?.messageRecallReasons).toEqual(
			expect.arrayContaining(['evidence_message_match', 'memory_full_text']),
		);
		expect(result[0]?.evidence[0]).toEqual(
			expect.objectContaining({
				id: fixture.evidenceIds.helium,
				snippet: expect.stringContaining('Helium hotspots'),
				occurredAt: expect.any(Date),
			}),
		);
	});

	it('uses deterministic legacy sourceMessageId memories for message recall', async () => {
		const result = await runFixtureSearch({
			query: 'DePIN infra pilots',
			messageRecallQueryText: 'DePIN infra pilots',
		});

		expect(result[0]?.node.id).toBe(fixture.nodeIds.solanaDepin);
		expect(result[0]?.messageMatchedEvidenceIds).toEqual([fixture.evidenceIds.solanaDepin]);
		expect(result[0]?.evidence[0]?.messageId).toBe(fixture.messageIds[2]);
	});

	it('ranks exact matches above weak semantic matches and boosts node plus message recall', async () => {
		const exact = await runFixtureSearch({
			query: 'Base L2',
			useEmbedding: true,
			messageRecallQueryText: 'consumer payments rollout',
		});
		expect(exact[0]?.node.id).toBe(fixture.nodeIds.baseL2);
		expect(exact[0]?.exactMatch).toBe(true);

		const boosted = await runFixtureSearch({
			query: 'rollup migration',
			useEmbedding: true,
			messageRecallQueryText: 'consumer payments rollout',
		});
		expect(boosted[0]?.node.id).toBe(fixture.nodeIds.baseL2);
		expect(boosted[0]?.matchReasons).toEqual(
			expect.arrayContaining(['semantic similarity', 'matched in message evidence']),
		);
		expect(boosted[1]?.node.id).toBe(fixture.nodeIds.ethereumL2);
		expect(boosted[0]?.matchScore).toBeGreaterThan(boosted[1]?.matchScore ?? 0);
	});

	it('does not add candidates for weak memory hits or unrelated semantic nearest neighbors', async () => {
		const weak = await runFixtureSearch({
			query: 'weak vague topic',
			messageRecallQueryText: 'weak vague topic',
		});
		expect(weak).toEqual([]);

		const unrelated = await runFixtureSearch({
			query: 'totally unrelated query',
			useEmbedding: true,
			messageRecallQueryText: null,
		});
		expect(unrelated).toEqual([]);
	});

	it('ignores ambiguous and non-deterministic legacy memories', async () => {
		expect(fixture.memoryHits(fixture.workspaceId, 'ambiguous base')).toEqual([]);
		expect(fixture.memoryHits(fixture.workspaceId, 'keyword only crm')).toEqual([]);
		expect(fixture.memoryHits(fixture.workspaceId, 'contact timestamp crm')).toEqual([]);
		expect(fixture.memoryHits(fixture.workspaceId, 'unmatched source message memory')).toEqual([]);

		const result = await runFixtureSearch({
			query: 'ambiguous base',
			messageRecallQueryText: 'ambiguous base',
		});
		expect(result).toEqual([]);
	});

	it('keeps decoy workspace nodes, memories, evidence, and snippets isolated', async () => {
		const primary = await runFixtureSearch({
			query: 'AI agents',
			workspaceId: fixture.workspaceId,
		});
		expect(primary[0]?.node.id).toBe(fixture.nodeIds.aiAgents);
		expect(JSON.stringify(primary)).not.toContain('Decoy workspace');
		expect(JSON.stringify(primary)).not.toContain(fixture.decoyWorkspaceId);

		const decoy = await runFixtureSearch({
			query: 'AI agents',
			workspaceId: fixture.decoyWorkspaceId,
		});
		expect(decoy[0]?.node.id).toBe(fixture.nodeIds.decoyAiAgents);
		expect(JSON.stringify(decoy)).toContain('Decoy workspace AI agents evidence');
	});

	it('does not expose embeddings or raw private message details in recall results', async () => {
		const result = await runFixtureSearch({ query: 'AI agents' });
		const serialized = JSON.stringify(result);

		expect(serialized).not.toContain('embedding');
		expect(serialized).not.toContain('555-0101');
		expect(serialized).not.toContain('alice@example.com');
		expect(mockExecute).toHaveBeenCalledTimes(1);
		expect(mockSetLocal).not.toHaveBeenCalled();
	});
});
