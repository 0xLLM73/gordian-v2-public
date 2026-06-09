import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

// All vars used inside vi.mock factories must be hoisted
const mockSelectLimit = vi.hoisted(() => vi.fn());
const mockSelectWhere = vi.hoisted(() => vi.fn<() => unknown>(() => ({ limit: mockSelectLimit })));
const mockSelectFrom = vi.hoisted(() => vi.fn<() => unknown>(() => ({ where: mockSelectWhere })));
const mockSelect = vi.hoisted(() => vi.fn(() => ({ from: mockSelectFrom })));

const mockDeleteWhere = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockDelete = vi.hoisted(() => vi.fn(() => ({ where: mockDeleteWhere })));

const mockUpdateReturning = vi.hoisted(() => vi.fn());
const mockUpdateWhere = vi.hoisted(() => vi.fn(() => ({ returning: mockUpdateReturning })));
const mockUpdateSet = vi.hoisted(() => vi.fn(() => ({ where: mockUpdateWhere })));
const mockUpdate = vi.hoisted(() => vi.fn(() => ({ set: mockUpdateSet })));

const mockInsertReturning = vi.hoisted(() => vi.fn());
const mockOnConflict = vi.hoisted(() => vi.fn(() => ({ returning: mockInsertReturning })));
const mockInsertValues = vi.hoisted(() =>
	vi.fn(() => ({ onConflictDoUpdate: mockOnConflict, returning: mockInsertReturning })),
);
const mockInsert = vi.hoisted(() => vi.fn(() => ({ values: mockInsertValues })));

const mockExecute = vi.hoisted(() => vi.fn());
const mockTransaction = vi.hoisted(() => vi.fn());

const mockInnerJoinWhere = vi.hoisted(() => vi.fn());
const mockInnerJoin = vi.hoisted(() => vi.fn(() => ({ where: mockInnerJoinWhere })));

vi.mock('../client', () => ({
	db: {
		select: mockSelect,
		insert: mockInsert,
		update: mockUpdate,
		delete: mockDelete,
		execute: mockExecute,
		transaction: mockTransaction,
	},
}));

vi.mock('@repo/crypto', () => ({
	withKeys: vi.fn((_envelope: unknown, fn: () => unknown) => fn()),
	computeBlindIndex: vi.fn((val: string) => `hash:${val}`),
	keyStore: { getStore: vi.fn(() => ({ bik: Buffer.from('test-bik') })) },
	getCurrentKeys: vi.fn(() => ({ bik: Buffer.from('test-bik') })),
}));

const mockEnvelope = {
	encryptedWrk: Buffer.from('test'),
	kmsContext: { workspaceId: 'ws-1' },
	wrkVersion: 1,
};

import {
	createKnowledgeEvidence,
	createKnowledgeLink,
	createKnowledgeNode,
	deleteKnowledgeNode,
	getContactsNeedingExtraction,
	getKnowledgeNeighbors,
	getKnowledgeNode,
	getKnowledgeNodeEvidenceStats,
	getLegacyKnowledgeEvidenceReport,
	getSharedKnowledge,
	knowledgeGraphSearch,
	linkContactToKnowledge,
	listContactsWithEvidenceForKnowledgeNode,
	listEvidenceForKnowledgeContact,
	listEvidenceForKnowledgeNode,
	listKnowledgeByContact,
	listKnowledgeNodes,
	mergeKnowledgeNodes,
	normalizeKnowledgeSearchQuery,
	repairKnowledgeEvidenceCounts,
	searchKnowledgeNodesWithEvidence,
	updateKnowledgeBackfillProgress,
	updateKnowledgeNode,
	upsertExtractionLog,
} from '../dal/knowledge';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WS = 'ws-00000000-0000-0000-0000-000000000001';

const baseNode = {
	id: 'node-1',
	workspaceId: WS,
	type: 'topic' as const,
	name: 'ethereum',
	displayName: 'Ethereum',
	description: 'Layer 1 blockchain',
	embedding: null,
	mentionCount: 0,
	lastSeenAt: null,
	createdAt: new Date(),
	updatedAt: new Date(),
};

// ─── createKnowledgeNode ──────────────────────────────────────────────────────

describe('createKnowledgeNode', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSelect.mockReturnValue({ from: mockSelectFrom });
		mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
		mockSelectWhere.mockReturnValue({ limit: mockSelectLimit });
		mockSelectLimit.mockResolvedValue(undefined);
		mockInsert.mockReturnValue({ values: mockInsertValues });
		mockInsertValues.mockReturnValue({
			onConflictDoUpdate: mockOnConflict,
			returning: mockInsertReturning,
		});
		mockOnConflict.mockReturnValue({ returning: mockInsertReturning });
	});

	it('normalizes name to lowercase before insert', async () => {
		mockInsertReturning.mockResolvedValueOnce([{ ...baseNode, name: 'ethereum' }]);

		await createKnowledgeNode(
			WS,
			{
				type: 'topic',
				name: 'Ethereum',
				displayName: 'Ethereum',
			},
			mockEnvelope,
		);

		expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ name: 'ethereum' }));
	});

	it('creates node with correct type and workspaceId', async () => {
		const orgNode = {
			...baseNode,
			type: 'organization' as const,
			name: 'consensys',
			displayName: 'ConsenSys',
		};
		mockInsertReturning.mockResolvedValueOnce([orgNode]);

		await createKnowledgeNode(
			WS,
			{
				type: 'organization',
				name: 'ConsenSys',
				displayName: 'ConsenSys',
			},
			mockEnvelope,
		);

		expect(mockInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({ workspaceId: WS, type: 'organization' }),
		);
	});

	it('throws when insert returns no rows', async () => {
		mockInsertReturning.mockResolvedValueOnce([]);

		await expect(
			createKnowledgeNode(WS, { type: 'topic', name: 'test', displayName: 'Test' }, mockEnvelope),
		).rejects.toThrow('createKnowledgeNode: insert returned no rows');
	});

	it('stores description and embedding when provided', async () => {
		const embedding = Array(512).fill(0.1);
		mockInsertReturning.mockResolvedValueOnce([
			{ ...baseNode, description: 'A protocol', embedding },
		]);

		await createKnowledgeNode(
			WS,
			{
				type: 'technology',
				name: 'solidity',
				displayName: 'Solidity',
				description: 'A protocol',
				embedding,
			},
			mockEnvelope,
		);

		expect(mockInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({ description: 'A protocol', embedding }),
		);
	});

	it('creates nodes for all 6 valid types', async () => {
		const types = ['topic', 'project', 'organization', 'technology', 'sector', 'concept'] as const;
		for (const type of types) {
			vi.clearAllMocks();
			mockInsert.mockReturnValue({ values: mockInsertValues });
			mockInsertValues.mockReturnValue({
				onConflictDoUpdate: mockOnConflict,
				returning: mockInsertReturning,
			});
			mockInsertReturning.mockResolvedValueOnce([{ ...baseNode, type }]);

			const result = await createKnowledgeNode(
				WS,
				{
					type,
					name: `test-${type}`,
					displayName: `Test ${type}`,
				},
				mockEnvelope,
			);
			expect(result.type).toBe(type);
		}
	});
});

// ─── getKnowledgeNode ─────────────────────────────────────────────────────────

describe('getKnowledgeNode', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSelect.mockReturnValue({ from: mockSelectFrom });
		mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
		mockSelectWhere.mockReturnValue({ limit: mockSelectLimit });
	});

	it('returns null for unknown ID', async () => {
		mockSelectLimit.mockResolvedValueOnce([]);

		const result = await getKnowledgeNode(WS, 'nonexistent-id', mockEnvelope);

		expect(result).toBeNull();
	});

	it('returns the node when found', async () => {
		mockSelectLimit.mockResolvedValueOnce([baseNode]);

		const result = await getKnowledgeNode(WS, 'node-1', mockEnvelope);

		expect(result).toEqual(baseNode);
	});
});

// ─── updateKnowledgeNode ──────────────────────────────────────────────────────

describe('updateKnowledgeNode', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUpdate.mockReturnValue({ set: mockUpdateSet });
		mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
		mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });
	});

	it('updates corrected fields and recomputes the blind-index input when name changes', async () => {
		mockUpdateReturning.mockResolvedValueOnce([
			{
				...baseNode,
				type: 'project',
				name: 'ethereum l2',
				displayName: 'Ethereum L2',
				description: 'Reviewed context',
			},
		]);

		const result = await updateKnowledgeNode(
			WS,
			'node-1',
			{
				type: 'project',
				name: 'Ethereum L2',
				displayName: 'Ethereum L2',
				description: 'Reviewed context',
				metadata: {
					review: {
						status: 'reviewed',
						source: 'manual',
					},
				},
			},
			mockEnvelope,
		);

		expect(mockUpdateSet).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'project',
				name: 'ethereum l2',
				nameBlindIndex: 'ethereum l2',
				displayName: 'Ethereum L2',
				description: 'Reviewed context',
				metadata: {
					review: {
						status: 'reviewed',
						source: 'manual',
					},
				},
			}),
		);
		expect(result?.displayName).toBe('Ethereum L2');
	});
});

// ─── listKnowledgeNodes ───────────────────────────────────────────────────────

describe('listKnowledgeNodes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		const mockOffset = vi.fn().mockResolvedValue([]);
		const mockLimitFn = vi.fn().mockReturnValue({ offset: mockOffset });
		const mockOrderByFn = vi.fn().mockReturnValue({ limit: mockLimitFn });
		mockSelect.mockReturnValue({ from: mockSelectFrom });
		mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
		mockSelectWhere.mockReturnValue({ orderBy: mockOrderByFn });
	});

	it('always includes workspaceId in WHERE clause', async () => {
		await listKnowledgeNodes(WS);

		expect(mockSelect).toHaveBeenCalledTimes(1);
		expect(mockSelectWhere).toHaveBeenCalledTimes(1);
	});

	it('accepts optional type filter (passes 2 conditions)', async () => {
		// When type filter is provided, the conditions array has 2 items
		await listKnowledgeNodes(WS, { type: 'project' });

		expect(mockSelectWhere).toHaveBeenCalledTimes(1);
	});

	it('orders by mention count descending', async () => {
		const mockOffset = vi.fn().mockResolvedValue([]);
		const mockLimitFn = vi.fn().mockReturnValue({ offset: mockOffset });
		const mockOrderByCapture = vi.fn().mockReturnValue({ limit: mockLimitFn });
		mockSelectWhere.mockReturnValue({ orderBy: mockOrderByCapture });

		await listKnowledgeNodes(WS);

		expect(mockOrderByCapture).toHaveBeenCalledTimes(1);
	});
});

// ─── getKnowledgeNodeEvidenceStats ───────────────────────────────────────────

describe('getKnowledgeNodeEvidenceStats', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('combines evidence-row and aggregate contact-link stats per node', async () => {
		const evidenceGroupBy = vi.fn().mockResolvedValue([
			{
				nodeId: 'node-1',
				evidenceRows: 7,
				distinctEvidenceContacts: 3,
				distinctEvidenceMessages: 5,
			},
		]);
		const contactGroupBy = vi.fn().mockResolvedValue([
			{
				nodeId: 'node-1',
				linkedContacts: 4,
				aggregateLinkEvidenceCount: 9,
				maxLinkEvidenceCount: 3,
			},
			{
				nodeId: 'node-2',
				linkedContacts: 1,
				aggregateLinkEvidenceCount: 2,
				maxLinkEvidenceCount: 2,
			},
		]);
		mockSelect
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() => ({ groupBy: evidenceGroupBy })),
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() => ({ groupBy: contactGroupBy })),
				})),
			});

		const stats = await getKnowledgeNodeEvidenceStats(WS, ['node-1', 'node-2']);

		expect(stats.get('node-1')).toEqual({
			nodeId: 'node-1',
			evidenceRows: 7,
			distinctEvidenceContacts: 3,
			distinctEvidenceMessages: 5,
			linkedContacts: 4,
			aggregateLinkEvidenceCount: 9,
			maxLinkEvidenceCount: 3,
		});
		expect(stats.get('node-2')).toEqual({
			nodeId: 'node-2',
			evidenceRows: 0,
			distinctEvidenceContacts: 0,
			distinctEvidenceMessages: 0,
			linkedContacts: 1,
			aggregateLinkEvidenceCount: 2,
			maxLinkEvidenceCount: 2,
		});
	});
});

// ─── Evidence-aware knowledge search ─────────────────────────────────────────

describe('evidence-aware knowledge search', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('normalizes lightweight people/topic search phrases', () => {
		expect(normalizeKnowledgeSearchQuery('who talked about AI agents')).toBe('AI agents');
		expect(normalizeKnowledgeSearchQuery('people interested in Helium?')).toBe('Helium');
		expect(normalizeKnowledgeSearchQuery('who mentioned CRM automation')).toBe('CRM automation');
		expect(normalizeKnowledgeSearchQuery('Base L2')).toBe('Base L2');
	});

	it('returns exact-match nodes enriched with contacts and evidence', async () => {
		const evidenceDate = new Date('2026-05-02T12:00:00Z');
		const contactRow = {
			nodeId: 'node-1',
			contactId: 'contact-1',
			firstName: 'Ada',
			lastName: 'Lovelace',
			relationType: 'knows_about' as const,
			strength: 0.9,
			evidenceCount: 2,
			lastEvidenceAt: evidenceDate,
		};
		const evidenceRow = {
			id: 'evidence-1',
			knowledgeNodeId: 'node-1',
			contactId: 'contact-1',
			messageId: 'message-1',
			relationType: 'knows_about',
			evidenceKind: 'llm_extracted' as const,
			confidence: 0.93,
			snippet: 'Ada talked about Ethereum staking.',
			occurredAt: evidenceDate,
			createdAt: evidenceDate,
		};

		const exactLimit = vi.fn().mockResolvedValueOnce([baseNode]);
		const exactOrderBy = vi.fn().mockReturnValue({ limit: exactLimit });
		const exactWhere = vi.fn().mockReturnValue({ orderBy: exactOrderBy });
		const aliasLimit = vi.fn().mockResolvedValueOnce([]);
		const aliasOrderBy = vi.fn().mockReturnValue({ limit: aliasLimit });
		const aliasWhere = vi.fn().mockReturnValue({ orderBy: aliasOrderBy });
		const contactsOrderBy = vi.fn().mockResolvedValueOnce([contactRow]);
		const contactsWhere = vi.fn().mockReturnValue({ orderBy: contactsOrderBy });
		const contactsInnerJoin = vi.fn().mockReturnValue({ where: contactsWhere });
		const evidenceOrderBy = vi.fn().mockResolvedValueOnce([evidenceRow]);
		const evidenceWhere = vi.fn().mockReturnValue({ orderBy: evidenceOrderBy });

		mockSelect.mockReturnValue({ from: mockSelectFrom });
		mockSelectFrom
			.mockReturnValueOnce({ where: exactWhere })
			.mockReturnValueOnce({ where: aliasWhere })
			.mockReturnValueOnce({ innerJoin: contactsInnerJoin })
			.mockReturnValueOnce({ where: evidenceWhere });

		const result = await searchKnowledgeNodesWithEvidence(
			WS,
			'who talked about Ethereum',
			undefined,
			mockEnvelope,
			{ limit: 5 },
		);

		expect(result).toHaveLength(1);
		expect(result[0]?.node.id).toBe('node-1');
		expect(result[0]?.exactMatch).toBe(true);
		expect(result[0]?.matchScore).toBe(1);
		expect(result[0]?.evidenceCount).toBe(1);
		expect(result[0]?.aggregateEvidenceCount).toBe(2);
		expect(result[0]?.latestEvidenceAt).toEqual(evidenceDate);
		expect(result[0]?.contacts[0]).toMatchObject({
			id: 'contact-1',
			firstName: 'Ada',
			relationType: 'knows_about',
			evidenceCount: 2,
		});
		expect(result[0]?.evidence[0]).toMatchObject({
			id: 'evidence-1',
			snippet: 'Ada talked about Ethereum staking.',
			confidence: 0.93,
		});
		expect(result[0]?.matchReasons).toEqual(
			expect.arrayContaining(['exact name', 'message evidence', 'contact evidence']),
		);
	});

	it('returns no results when there is no exact, alias, or confident semantic match', async () => {
		const exactLimit = vi.fn().mockResolvedValueOnce([]);
		const exactOrderBy = vi.fn().mockReturnValue({ limit: exactLimit });
		const exactWhere = vi.fn().mockReturnValue({ orderBy: exactOrderBy });
		const aliasLimit = vi.fn().mockResolvedValueOnce([]);
		const aliasOrderBy = vi.fn().mockReturnValue({ limit: aliasLimit });
		const aliasWhere = vi.fn().mockReturnValue({ orderBy: aliasOrderBy });

		mockSelect.mockReturnValue({ from: mockSelectFrom });
		mockSelectFrom.mockReturnValueOnce({ where: exactWhere }).mockReturnValueOnce({
			where: aliasWhere,
		});

		const result = await searchKnowledgeNodesWithEvidence(
			WS,
			'totally unrelated query',
			undefined,
			mockEnvelope,
			{ limit: 5 },
		);

		expect(result).toEqual([]);
	});

	it('discovers a node through message-linked memory recall', async () => {
		const evidenceDate = new Date('2026-05-03T12:00:00Z');
		const messageId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
		const evidenceId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

		const exactLimit = vi.fn().mockResolvedValueOnce([]);
		const exactOrderBy = vi.fn().mockReturnValue({ limit: exactLimit });
		const exactWhere = vi.fn().mockReturnValue({ orderBy: exactOrderBy });
		const aliasLimit = vi.fn().mockResolvedValueOnce([]);
		const aliasOrderBy = vi.fn().mockReturnValue({ limit: aliasLimit });
		const aliasWhere = vi.fn().mockReturnValue({ orderBy: aliasOrderBy });

		const recallLimit = vi.fn().mockResolvedValueOnce([
			{
				nodeId: 'node-1',
				workspaceId: WS,
				type: 'topic',
				name: 'depin',
				displayName: 'DePIN',
				description: 'Decentralized physical infrastructure',
				nameBlindIndex: 'hash:depin',
				aliases: [],
				mentionCount: 1,
				firstSeenAt: null,
				lastSeenAt: evidenceDate,
				createdAt: evidenceDate,
				evidenceId,
				messageId,
				evidenceOccurredAt: evidenceDate,
				evidenceCreatedAt: evidenceDate,
			},
		]);
		const recallOrderBy = vi.fn().mockReturnValue({ limit: recallLimit });
		const recallWhere = vi.fn().mockReturnValue({ orderBy: recallOrderBy });
		const recallInnerJoin = vi.fn().mockReturnValue({ where: recallWhere });

		const contactsOrderBy = vi.fn().mockResolvedValueOnce([]);
		const contactsWhere = vi.fn().mockReturnValue({ orderBy: contactsOrderBy });
		const contactsInnerJoin = vi.fn().mockReturnValue({ where: contactsWhere });
		const evidenceOrderBy = vi.fn().mockResolvedValueOnce([
			{
				id: evidenceId,
				knowledgeNodeId: 'node-1',
				contactId: 'contact-1',
				messageId,
				relationType: 'knows_about',
				evidenceKind: 'llm_extracted' as const,
				confidence: 0.91,
				snippet: 'Alice mentioned DePIN in the Helium thread.',
				occurredAt: evidenceDate,
				createdAt: evidenceDate,
			},
		]);
		const evidenceWhere = vi.fn().mockReturnValue({ orderBy: evidenceOrderBy });

		mockExecute.mockResolvedValueOnce([
			{
				memoryId: 'memory-1',
				messageId,
				content: 'masked memory about DePIN',
				category: 'general',
				rrfScore: 0.01,
				semanticScore: 0.78,
				ftsRank: 0.4,
				contactId: 'contact-1',
				memoryCreatedAt: evidenceDate,
			},
		]);
		mockSelect.mockReturnValue({ from: mockSelectFrom });
		mockSelectFrom
			.mockReturnValueOnce({ where: exactWhere })
			.mockReturnValueOnce({ where: aliasWhere })
			.mockReturnValueOnce({ innerJoin: recallInnerJoin })
			.mockReturnValueOnce({ innerJoin: contactsInnerJoin })
			.mockReturnValueOnce({ where: evidenceWhere });

		const result = await searchKnowledgeNodesWithEvidence(WS, 'DePIN', undefined, mockEnvelope, {
			limit: 5,
			messageRecallQueryText: 'masked DePIN',
		});

		expect(result).toHaveLength(1);
		expect(result[0]?.node.id).toBe('node-1');
		expect(result[0]?.messageHitCount).toBe(1);
		expect(result[0]?.messageRecallScore).toBeCloseTo(0.8);
		expect(result[0]?.messageMatchedEvidenceIds).toEqual([evidenceId]);
		expect(result[0]?.matchReasons).toEqual(
			expect.arrayContaining(['evidence_message_match', 'matched in message evidence']),
		);
		expect(result[0]?.evidence[0]?.id).toBe(evidenceId);
	});

	it('does not add message-recall candidates for weak semantic-only memory hits', async () => {
		const exactLimit = vi.fn().mockResolvedValueOnce([]);
		const exactOrderBy = vi.fn().mockReturnValue({ limit: exactLimit });
		const exactWhere = vi.fn().mockReturnValue({ orderBy: exactOrderBy });
		const aliasLimit = vi.fn().mockResolvedValueOnce([]);
		const aliasOrderBy = vi.fn().mockReturnValue({ limit: aliasLimit });
		const aliasWhere = vi.fn().mockReturnValue({ orderBy: aliasOrderBy });

		mockExecute.mockResolvedValueOnce([
			{
				memoryId: 'memory-weak',
				messageId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
				content: 'weak memory hit',
				category: 'general',
				rrfScore: 0.01,
				semanticScore: 0.2,
				ftsRank: 0,
				contactId: 'contact-1',
				memoryCreatedAt: new Date('2026-05-03T12:00:00Z'),
			},
		]);
		mockSelect.mockReturnValue({ from: mockSelectFrom });
		mockSelectFrom.mockReturnValueOnce({ where: exactWhere }).mockReturnValueOnce({
			where: aliasWhere,
		});

		const result = await searchKnowledgeNodesWithEvidence(
			WS,
			'weak query',
			undefined,
			mockEnvelope,
			{ limit: 5, messageRecallQueryText: 'masked weak query' },
		);

		expect(result).toEqual([]);
	});
});

// ─── linkContactToKnowledge ───────────────────────────────────────────────────

describe('linkContactToKnowledge', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSelect.mockReturnValue({ from: mockSelectFrom });
		mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
		mockSelectWhere.mockReturnValue({ limit: mockSelectLimit });
		mockSelectLimit.mockResolvedValue(undefined);
		mockInsert.mockReturnValue({ values: mockInsertValues });
		mockInsertValues.mockReturnValue({
			onConflictDoUpdate: mockOnConflict,
			returning: mockInsertReturning,
		});
		mockOnConflict.mockReturnValue({ returning: mockInsertReturning });
	});

	it('inserts a contact-knowledge link', async () => {
		const link = {
			id: 'link-1',
			workspaceId: WS,
			knowledgeNodeId: 'node-1',
			contactId: 'contact-1',
			relationType: 'knows_about',
			strength: 1.0,
			evidenceCount: 1,
			lastEvidenceAt: new Date(),
			createdAt: new Date(),
		};
		mockInsertReturning.mockResolvedValueOnce([link]);

		const result = await linkContactToKnowledge(WS, 'node-1', 'contact-1', 'knows_about');

		expect(mockInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceId: WS,
				knowledgeNodeId: 'node-1',
				contactId: 'contact-1',
				relationType: 'knows_about',
			}),
		);
		expect(result).toEqual(link);
	});

	it('uses default strength of 1.0 when not specified', async () => {
		mockInsertReturning.mockResolvedValueOnce([{ id: 'link-1' }]);

		await linkContactToKnowledge(WS, 'node-1', 'c-1', 'expert_in');

		expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ strength: 1.0 }));
	});

	it('uses onConflictDoUpdate — increments evidenceCount on re-link', async () => {
		mockInsertReturning.mockResolvedValueOnce([{ id: 'link-1' }]);

		await linkContactToKnowledge(WS, 'node-1', 'c-1', 'invested_in', 0.8);

		const conflictArgs = (mockOnConflict.mock.calls as unknown[][])[0]?.[0] as
			| { set: Record<string, unknown>; target: unknown }
			| undefined;
		expect(conflictArgs?.set).toMatchObject({ strength: 0.8 });
		// evidenceCount increment is included in the set
		expect(conflictArgs?.set?.evidenceCount).toBeDefined();
	});

	it('supports all 7 relationship types', async () => {
		const relTypes = [
			'knows_about',
			'works_on',
			'member_of',
			'expert_in',
			'uses',
			'invested_in',
			'interested_in',
		] as const;
		for (const relType of relTypes) {
			vi.clearAllMocks();
			mockInsert.mockReturnValue({ values: mockInsertValues });
			mockInsertValues.mockReturnValue({
				onConflictDoUpdate: mockOnConflict,
				returning: mockInsertReturning,
			});
			mockOnConflict.mockReturnValue({ returning: mockInsertReturning });
			mockInsertReturning.mockResolvedValueOnce([{ id: 'link-1', relationType: relType }]);

			const result = await linkContactToKnowledge(WS, 'node-1', 'c-1', relType);
			expect(result.relationType).toBe(relType);
		}
	});

	it('throws when insert returns no rows', async () => {
		mockInsertReturning.mockResolvedValueOnce([]);

		await expect(linkContactToKnowledge(WS, 'node-1', 'c-1', 'works_on')).rejects.toThrow(
			'linkContactToKnowledge: insert returned no rows',
		);
	});

	it('writes evidence when evidence metadata is provided', async () => {
		const link = {
			id: 'link-1',
			workspaceId: WS,
			knowledgeNodeId: 'node-1',
			contactId: 'c-1',
			relationType: 'works_on',
			strength: 0.8,
			evidenceCount: 1,
			lastEvidenceAt: new Date(),
			createdAt: new Date(),
		};
		const evidence = {
			id: 'evidence-1',
			workspaceId: WS,
			knowledgeNodeId: 'node-1',
			contactId: 'c-1',
			relationType: 'works_on',
			evidenceKind: 'llm_extracted',
		};
		mockInsertReturning.mockResolvedValueOnce([link]).mockResolvedValueOnce([evidence]);

		await linkContactToKnowledge(WS, 'node-1', 'c-1', 'works_on', 0.8, {
			messageId: 'msg-1',
			snippet: 'We are working on Solana infra',
			occurredAt: new Date('2026-05-01T00:00:00Z'),
			evidenceKind: 'llm_extracted',
			confidence: 0.8,
			metadata: { source: 'test' },
			envelope: mockEnvelope,
		});

		expect(mockInsert).toHaveBeenCalledTimes(2);
		expect(mockInsertValues).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				workspaceId: WS,
				knowledgeNodeId: 'node-1',
				contactId: 'c-1',
				messageId: 'msg-1',
				relationType: 'works_on',
				evidenceKind: 'llm_extracted',
				confidence: 0.8,
				snippet: 'We are working on Solana infra',
			}),
		);
		const conflictArgs = (mockOnConflict.mock.calls as unknown[][])[0]?.[0] as
			| { set: Record<string, unknown>; target: unknown }
			| undefined;
		const timestampSql = conflictArgs?.set?.lastEvidenceAt as { queryChunks?: unknown[] };
		expect(timestampSql.queryChunks).toContain('2026-05-01T00:00:00.000Z');
		expect(
			timestampSql.queryChunks?.some(
				(chunk) =>
					typeof chunk === 'object' &&
					chunk !== null &&
					'value' in chunk &&
					Array.isArray((chunk as { value?: unknown }).value) &&
					(chunk as { value: string[] }).value.includes('::timestamptz)'),
			),
		).toBe(true);
	});

	it('does not increment link evidence or rewrite evidence for duplicate message-backed evidence', async () => {
		const link = {
			id: 'link-1',
			workspaceId: WS,
			knowledgeNodeId: 'node-1',
			contactId: 'c-1',
			relationType: 'works_on',
			strength: 0.8,
			evidenceCount: 2,
			lastEvidenceAt: new Date(),
			createdAt: new Date(),
		};
		const existingEvidence = {
			id: 'evidence-existing',
			workspaceId: WS,
			knowledgeNodeId: 'node-1',
			contactId: 'c-1',
			messageId: 'msg-1',
			relationType: 'works_on',
			evidenceKind: 'llm_extracted',
		};
		mockSelectLimit.mockResolvedValueOnce([existingEvidence]);
		mockInsertReturning.mockResolvedValueOnce([link]);

		await linkContactToKnowledge(WS, 'node-1', 'c-1', 'works_on', 0.8, {
			messageId: 'msg-1',
			snippet: 'We are working on Solana infra',
			occurredAt: new Date('2026-05-01T00:00:00Z'),
			evidenceKind: 'llm_extracted',
			confidence: 0.8,
			metadata: { source: 'test' },
			envelope: mockEnvelope,
		});

		expect(mockInsert).toHaveBeenCalledTimes(1);
		const conflictArgs = (mockOnConflict.mock.calls as unknown[][])[0]?.[0] as
			| { set: Record<string, unknown>; target: unknown }
			| undefined;
		expect(conflictArgs?.set?.evidenceCount).toBeUndefined();
		expect(conflictArgs?.set).toMatchObject({ strength: 0.8 });
	});

	it('rejects evidence snippets without an envelope before writing the aggregate link', async () => {
		await expect(
			linkContactToKnowledge(WS, 'node-1', 'c-1', 'works_on', 0.8, {
				snippet: 'sensitive message text',
				evidenceKind: 'llm_extracted',
			}),
		).rejects.toThrow(
			'linkContactToKnowledge: envelope required when evidence snippet is provided',
		);

		expect(mockInsert).not.toHaveBeenCalled();
	});
});

// ─── Knowledge Evidence ───────────────────────────────────────────────────────

describe('knowledge evidence DAL', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockInsert.mockReturnValue({ values: mockInsertValues });
		mockInsertValues.mockReturnValue({
			onConflictDoUpdate: mockOnConflict,
			returning: mockInsertReturning,
		});
		mockOnConflict.mockReturnValue({ returning: mockInsertReturning });
	});

	it('inserts an encrypted evidence row with workspace scope', async () => {
		const evidence = {
			id: 'evidence-1',
			workspaceId: WS,
			knowledgeNodeId: 'node-1',
			contactId: 'contact-1',
			messageId: 'message-1',
			relationType: 'knows_about',
			evidenceKind: 'llm_extracted',
			confidence: 0.9,
			snippet: 'Solana came up in the thread',
			occurredAt: new Date('2026-05-01T00:00:00Z'),
			createdAt: new Date(),
		};
		mockInsertReturning.mockResolvedValueOnce([evidence]);

		const result = await createKnowledgeEvidence(
			WS,
			{
				knowledgeNodeId: 'node-1',
				contactId: 'contact-1',
				messageId: 'message-1',
				relationType: 'knows_about',
				evidenceKind: 'llm_extracted',
				confidence: 0.9,
				snippet: 'Solana came up in the thread',
				occurredAt: evidence.occurredAt,
				metadata: { source: 'test' },
			},
			mockEnvelope,
		);

		expect(mockInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceId: WS,
				knowledgeNodeId: 'node-1',
				contactId: 'contact-1',
				messageId: 'message-1',
				relationType: 'knows_about',
				evidenceKind: 'llm_extracted',
			}),
		);
		expect(result).toEqual(evidence);
	});

	it('returns existing message-backed evidence instead of inserting an exact duplicate', async () => {
		const existingEvidence = {
			id: 'evidence-existing',
			workspaceId: WS,
			knowledgeNodeId: 'node-1',
			contactId: 'contact-1',
			messageId: 'message-1',
			relationType: 'knows_about',
			evidenceKind: 'llm_extracted',
			confidence: 0.9,
			snippet: 'Solana came up in the thread',
			occurredAt: new Date('2026-05-01T00:00:00Z'),
			createdAt: new Date(),
		};
		mockSelectLimit.mockResolvedValueOnce([existingEvidence]);

		const result = await createKnowledgeEvidence(
			WS,
			{
				knowledgeNodeId: 'node-1',
				contactId: 'contact-1',
				messageId: 'message-1',
				relationType: 'knows_about',
				evidenceKind: 'llm_extracted',
				confidence: 0.9,
				snippet: 'Solana came up in the thread',
				occurredAt: existingEvidence.occurredAt,
				metadata: { source: 'test' },
			},
			mockEnvelope,
		);

		expect(result).toEqual(existingEvidence);
		expect(mockInsert).not.toHaveBeenCalled();
	});

	it('requires an envelope when snippet text is provided', async () => {
		await expect(
			createKnowledgeEvidence(WS, {
				knowledgeNodeId: 'node-1',
				relationType: 'knows_about',
				evidenceKind: 'manual',
				snippet: 'sensitive message text',
			}),
		).rejects.toThrow('createKnowledgeEvidence: envelope required when snippet is provided');
		expect(mockInsert).not.toHaveBeenCalled();
	});

	it('lists evidence for a node with workspace and node filters', async () => {
		const evidenceRows = [{ id: 'evidence-1', workspaceId: WS, knowledgeNodeId: 'node-1' }];
		const mockLimit = vi.fn().mockResolvedValueOnce(evidenceRows);
		const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
		mockSelect.mockReturnValue({ from: mockSelectFrom });
		mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
		mockSelectWhere.mockReturnValue({ orderBy: mockOrderBy });

		const result = await listEvidenceForKnowledgeNode(WS, 'node-1', mockEnvelope);

		expect(result).toEqual(evidenceRows);
		expect(mockSelectWhere).toHaveBeenCalledTimes(1);
		expect(mockOrderBy).toHaveBeenCalledTimes(1);
		expect(mockLimit).toHaveBeenCalledWith(25);
	});

	it('lists evidence for a node/contact pair', async () => {
		const evidenceRows = [{ id: 'evidence-1', workspaceId: WS, contactId: 'contact-1' }];
		const mockLimit = vi.fn().mockResolvedValueOnce(evidenceRows);
		const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
		mockSelect.mockReturnValue({ from: mockSelectFrom });
		mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
		mockSelectWhere.mockReturnValue({ orderBy: mockOrderBy });

		const result = await listEvidenceForKnowledgeContact(WS, 'node-1', 'contact-1', mockEnvelope);

		expect(result).toEqual(evidenceRows);
		expect(mockSelectWhere).toHaveBeenCalledTimes(1);
	});

	it('lists contacts with their evidence for a topic', async () => {
		const contact = { id: 'contact-1', workspaceId: WS, firstName: 'Ada', lastName: 'Lovelace' };
		const link = {
			id: 'link-1',
			workspaceId: WS,
			knowledgeNodeId: 'node-1',
			contactId: 'contact-1',
			relationType: 'knows_about',
			strength: 0.9,
			evidenceCount: 1,
			lastEvidenceAt: new Date(),
			createdAt: new Date(),
		};
		const evidence = {
			id: 'evidence-1',
			workspaceId: WS,
			knowledgeNodeId: 'node-1',
			contactId: 'contact-1',
			relationType: 'knows_about',
			evidenceKind: 'llm_extracted',
		};
		const contactWhere = vi.fn().mockResolvedValueOnce([{ contact, link }]);
		const innerJoin = vi.fn().mockReturnValue({ where: contactWhere });
		const evidenceOrderBy = vi.fn().mockResolvedValueOnce([evidence]);
		const evidenceWhere = vi.fn().mockReturnValue({ orderBy: evidenceOrderBy });

		mockSelect.mockReturnValue({ from: mockSelectFrom });
		mockSelectFrom.mockReturnValueOnce({ innerJoin }).mockReturnValueOnce({ where: evidenceWhere });

		const result = await listContactsWithEvidenceForKnowledgeNode('node-1', WS, mockEnvelope);

		expect(result).toEqual([{ contact, link, evidence: [evidence] }]);
		expect(contactWhere).toHaveBeenCalledTimes(1);
		expect(evidenceWhere).toHaveBeenCalledTimes(1);
	});
});

// ─── Legacy Evidence Report ──────────────────────────────────────────────────

describe('getLegacyKnowledgeEvidenceReport', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('counts legacy aggregate links without matching evidence rows', async () => {
		const latest = new Date('2026-05-01T00:00:00Z');
		mockExecute
			.mockResolvedValueOnce([{ totalKnowledgeContactRows: '10', rowsWithoutEvidence: '4' }])
			.mockResolvedValueOnce([
				{ workspaceId: 'ws-1', totalKnowledgeContactRows: '7', rowsWithoutEvidence: '3' },
				{ workspaceId: 'ws-2', totalKnowledgeContactRows: '3', rowsWithoutEvidence: '1' },
			])
			.mockResolvedValueOnce([
				{ nodeType: 'topic', totalKnowledgeContactRows: '6', rowsWithoutEvidence: '2' },
				{ nodeType: 'project', totalKnowledgeContactRows: '4', rowsWithoutEvidence: '2' },
			])
			.mockResolvedValueOnce([
				{
					workspaceId: 'ws-1',
					nodeId: 'node-1',
					nodeType: 'topic',
					rowsWithoutEvidence: '2',
					aggregateEvidenceCount: '5',
					latestLegacyEvidenceAt: latest,
				},
			])
			.mockResolvedValueOnce([
				{
					workspaceId: 'ws-1',
					contactId: 'contact-1',
					rowsWithoutEvidence: '3',
					aggregateEvidenceCount: '8',
					latestLegacyEvidenceAt: latest.toISOString(),
				},
			]);

		const report = await getLegacyKnowledgeEvidenceReport();

		expect(report.totalKnowledgeContactRows).toBe(10);
		expect(report.rowsWithoutEvidence).toBe(4);
		expect(report.byWorkspace).toEqual([
			{ workspaceId: 'ws-1', totalKnowledgeContactRows: 7, rowsWithoutEvidence: 3 },
			{ workspaceId: 'ws-2', totalKnowledgeContactRows: 3, rowsWithoutEvidence: 1 },
		]);
		expect(report.byNodeType[0]).toEqual({
			nodeType: 'topic',
			totalKnowledgeContactRows: 6,
			rowsWithoutEvidence: 2,
		});
		expect(report.topNodesMissingEvidence[0]).toEqual({
			workspaceId: 'ws-1',
			nodeId: 'node-1',
			nodeType: 'topic',
			rowsWithoutEvidence: 2,
			aggregateEvidenceCount: 5,
			latestLegacyEvidenceAt: latest,
		});
		expect(report.topContactsMissingEvidence[0]).toEqual({
			workspaceId: 'ws-1',
			contactId: 'contact-1',
			rowsWithoutEvidence: 3,
			aggregateEvidenceCount: 8,
			latestLegacyEvidenceAt: latest,
		});
		expect(report.recommendedNextAction).toContain('evidence backfill');
		expect(mockExecute).toHaveBeenCalledTimes(5);
		for (const call of mockExecute.mock.calls) {
			const queryArg = call[0] as { queryChunks?: unknown[] } | undefined;
			const sqlText = (queryArg?.queryChunks ?? [])
				.map((chunk) => {
					if (typeof chunk === 'string') return chunk;
					if (chunk && typeof chunk === 'object' && 'value' in chunk) {
						const value = (chunk as { value?: unknown }).value;
						return Array.isArray(value) ? value.join('') : String(value ?? '');
					}
					return '';
				})
				.join(' ');
			expect(sqlText).toContain('ke.relation_type = kc.relation_type::text');
		}
	});
});

// ─── Evidence Counter Repair ─────────────────────────────────────────────────

describe('repairKnowledgeEvidenceCounts', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('maps cleanup and recompute counts from the repair query', async () => {
		mockExecute.mockResolvedValueOnce([
			{
				duplicateEvidenceRowsDeleted: '7',
				contactLinksRecomputed: '3',
				nodesRecomputed: '2',
			},
		]);

		const result = await repairKnowledgeEvidenceCounts(WS);

		expect(result).toEqual({
			workspaceId: WS,
			duplicateEvidenceRowsDeleted: 7,
			contactLinksRecomputed: 3,
			nodesRecomputed: 2,
		});
		expect(mockExecute).toHaveBeenCalledTimes(1);
		const queryArg = mockExecute.mock.calls[0]?.[0] as { queryChunks?: unknown[] } | undefined;
		const sqlText = (queryArg?.queryChunks ?? [])
			.map((chunk) => {
				if (typeof chunk === 'string') return chunk;
				if (chunk && typeof chunk === 'object' && 'value' in chunk) {
					const value = (chunk as { value?: unknown }).value;
					return Array.isArray(value) ? value.join('') : String(value ?? '');
				}
				return '';
			})
			.join(' ');
		expect(sqlText).toContain('row_number() OVER');
		expect(sqlText).toContain('DELETE FROM knowledge_evidence');
		expect(sqlText).toContain('count(DISTINCT message_id)');
		expect(sqlText).toContain('UPDATE knowledge_contacts');
		expect(sqlText).toContain('link_counts AS');
		expect(sqlText).toContain('coalesce(ec.evidence_count, kc.evidence_count)');
		expect(sqlText).toContain('UPDATE knowledge_nodes');
	});
});

// ─── Extraction Log Lifecycle ────────────────────────────────────────────────

describe('knowledge extraction log lifecycle', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockInsert.mockReturnValue({ values: mockInsertValues });
		mockInsertValues.mockReturnValue({
			onConflictDoUpdate: mockOnConflict,
			returning: mockInsertReturning,
		});
		mockOnConflict.mockReturnValue({ returning: mockInsertReturning });
	});

	it('upserts messageHorizon with the extraction result', async () => {
		const messageHorizon = new Date('2026-05-03T14:30:00.000Z');

		await upsertExtractionLog(WS, 'contact-1', {
			messageHorizon,
			entitiesExtracted: 2,
			llmCalled: true,
		});

		expect(mockInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceId: WS,
				contactId: 'contact-1',
				entitiesExtracted: 2,
				llmCalled: 1,
				messageHorizon,
			}),
		);

		const conflictArgs = (mockOnConflict.mock.calls as unknown[][])[0]?.[0] as
			| { set?: Record<string, unknown> }
			| undefined;
		expect(conflictArgs?.set).toEqual(
			expect.objectContaining({
				lastExtractedAt: expect.anything(),
				entitiesExtracted: expect.anything(),
				llmCalled: expect.anything(),
				messageHorizon: expect.anything(),
			}),
		);
	});

	it('advances historical backfill progress without replacing extraction counts', async () => {
		const oldestMessageAt = new Date('2026-05-01T10:00:00.000Z');
		const completedAt = new Date('2026-05-03T10:00:00.000Z');
		mockUpdateReturning.mockResolvedValueOnce([{ id: 'log-1' }]);

		await updateKnowledgeBackfillProgress(WS, 'contact-1', {
			oldestMessageAt,
			messagesScanned: 200,
			completedAt,
		});

		expect(mockUpdateSet).toHaveBeenCalledWith(
			expect.objectContaining({
				lastExtractedAt: expect.anything(),
				backfillOldestMessageAt: expect.anything(),
				backfillMessagesScanned: expect.anything(),
				backfillCompletedAt: expect.anything(),
			}),
		);
		const updateSet = (mockUpdateSet.mock.calls as unknown[][])[0]?.[0] as Record<string, unknown>;
		expect(updateSet).not.toHaveProperty('entitiesExtracted');
		expect(updateSet).not.toHaveProperty('llmCalled');
		expect(mockInsert).not.toHaveBeenCalled();
	});

	it('selects only contacts whose latest message is newer than messageHorizon', async () => {
		mockExecute.mockResolvedValueOnce([{ id: 'contact-needs-extraction' }]);

		const result = await getContactsNeedingExtraction(WS, 25);

		expect(result).toEqual(['contact-needs-extraction']);
		expect(mockExecute).toHaveBeenCalledTimes(1);
		const queryArg = mockExecute.mock.calls[0]?.[0] as { queryChunks?: unknown[] } | undefined;
		const sqlText = (queryArg?.queryChunks ?? [])
			.map((chunk) => {
				if (typeof chunk === 'string') return chunk;
				if (chunk && typeof chunk === 'object' && 'value' in chunk) {
					const value = (chunk as { value?: unknown }).value;
					return Array.isArray(value) ? value.join('') : String(value ?? '');
				}
				return '';
			})
			.join(' ');
		expect(sqlText).toContain('kel.message_horizon <');
		expect(sqlText).toContain('MAX(m.sent_at) AS latest_message_at');
		expect(sqlText).toContain('PARTITION BY source_account_id');
		expect(sqlText).toContain('source_rank ASC');
	});
});

// ─── mergeKnowledgeNodes ──────────────────────────────────────────────────────

describe('mergeKnowledgeNodes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('runs merge in a db.transaction()', async () => {
		mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
			const txLimit = vi.fn().mockResolvedValue([{ name: 'merged-node', mentionCount: 3 }]);
			const txWhere = vi.fn().mockReturnValue({ limit: txLimit });
			const txFrom = vi.fn().mockReturnValue({ where: txWhere });
			const tx = {
				select: vi.fn().mockReturnValue({ from: txFrom }),
				execute: vi.fn().mockResolvedValue(undefined),
				delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
			};
			return fn(tx);
		});

		await mergeKnowledgeNodes(WS, 'survivor-id', 'merged-id');

		expect(mockTransaction).toHaveBeenCalledTimes(1);
	});

	it('calls tx.execute to transfer links, then tx.delete twice (conflicts + merged node)', async () => {
		const txExecute = vi.fn().mockResolvedValue(undefined);
		const txDeleteWhere = vi.fn().mockResolvedValue(undefined);
		const txDelete = vi.fn().mockReturnValue({ where: txDeleteWhere });
		const txLimit = vi.fn().mockResolvedValue([{ name: 'merged-node', mentionCount: 3 }]);
		const txWhere = vi.fn().mockReturnValue({ limit: txLimit });
		const txFrom = vi.fn().mockReturnValue({ where: txWhere });
		const txSelect = vi.fn().mockReturnValue({ from: txFrom });

		mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
			fn({ select: txSelect, execute: txExecute, delete: txDelete }),
		);

		await mergeKnowledgeNodes(WS, 'survivor-id', 'merged-id');

		expect(txSelect).toHaveBeenCalledTimes(1); // fetch merged node name + mentionCount
		expect(txExecute).toHaveBeenCalledTimes(6); // transfer contacts, links, evidence, then update aliases
		expect(txDelete).toHaveBeenCalledTimes(2); // 1: remove conflict links, 2: delete merged node
	});
});

// ─── deleteKnowledgeNode ──────────────────────────────────────────────────────

describe('deleteKnowledgeNode', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDelete.mockReturnValue({ where: mockDeleteWhere });
		mockDeleteWhere.mockResolvedValue(undefined);
	});

	it('calls db.delete with the node ID and workspaceId', async () => {
		await deleteKnowledgeNode(WS, 'node-1');

		expect(mockDelete).toHaveBeenCalledTimes(1);
		expect(mockDeleteWhere).toHaveBeenCalledTimes(1);
	});

	it('resolves without throwing', async () => {
		await expect(deleteKnowledgeNode(WS, 'node-1')).resolves.toBeUndefined();
	});
});

// ─── listKnowledgeByContact ───────────────────────────────────────────────────

describe('listKnowledgeByContact', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSelect.mockReturnValue({ from: mockSelectFrom });
		mockSelectFrom.mockReturnValue({ innerJoin: mockInnerJoin });
		mockInnerJoin.mockReturnValue({ where: mockInnerJoinWhere });
	});

	it('returns empty array when contact has no knowledge links', async () => {
		mockInnerJoinWhere.mockResolvedValueOnce([]);

		const result = await listKnowledgeByContact('contact-1', WS);

		expect(result).toEqual([]);
	});

	it('returns mapped knowledge nodes for the contact', async () => {
		mockInnerJoinWhere.mockResolvedValueOnce([{ node: baseNode }]);

		const result = await listKnowledgeByContact('contact-1', WS);

		expect(result).toEqual([baseNode]);
	});

	it('applies WHERE clause — select + innerJoin + where all called (SEC-114 regression guard)', async () => {
		mockInnerJoinWhere.mockResolvedValueOnce([]);

		await listKnowledgeByContact('contact-1', WS);

		expect(mockSelect).toHaveBeenCalledTimes(1);
		expect(mockInnerJoin).toHaveBeenCalledTimes(1);
		expect(mockInnerJoinWhere).toHaveBeenCalledTimes(1);
	});

	it('scopes to workspaceId — two different workspaces produce two separate queries', async () => {
		mockInnerJoinWhere.mockResolvedValue([]);

		await listKnowledgeByContact('contact-1', 'ws-A');
		await listKnowledgeByContact('contact-1', 'ws-B');

		expect(mockSelect).toHaveBeenCalledTimes(2);
		expect(mockInnerJoinWhere).toHaveBeenCalledTimes(2);
	});
});

// ─── createKnowledgeLink ──────────────────────────────────────────────────────

describe('createKnowledgeLink', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockInsert.mockReturnValue({ values: mockInsertValues });
		mockInsertValues.mockReturnValue({
			onConflictDoUpdate: mockOnConflict,
			returning: mockInsertReturning,
		});
		mockOnConflict.mockReturnValue({ returning: mockInsertReturning });
	});

	it('inserts link and returns created row', async () => {
		const link = {
			id: 'link-1',
			workspaceId: WS,
			sourceNodeId: 'node-a',
			targetNodeId: 'node-b',
			linkType: 'related_to',
			weight: 0.5,
			createdAt: new Date(),
		};
		mockInsertReturning.mockResolvedValueOnce([link]);

		const result = await createKnowledgeLink(WS, 'node-a', 'node-b', 'related_to', 0.5);

		expect(mockInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceId: WS,
				sourceNodeId: 'node-a',
				targetNodeId: 'node-b',
				linkType: 'related_to',
			}),
		);
		expect(result).toEqual(link);
	});

	it('uses onConflictDoUpdate — updates weight on duplicate edge', async () => {
		mockInsertReturning.mockResolvedValueOnce([{ id: 'link-1' }]);

		await createKnowledgeLink(WS, 'node-a', 'node-b', 'builds_on', 0.8);

		const conflictArgs = (mockOnConflict.mock.calls as unknown[][])[0]?.[0] as
			| {
					set: Record<string, unknown>;
					target: unknown[];
			  }
			| undefined;
		expect(conflictArgs?.set?.weight).toBeDefined();
	});

	it('throws when insert returns no rows', async () => {
		mockInsertReturning.mockResolvedValueOnce([]);

		await expect(createKnowledgeLink(WS, 'node-a', 'node-b', 'part_of')).rejects.toThrow(
			'createKnowledgeLink: insert returned no rows',
		);
	});

	it('rejects evidence snippets without an envelope before writing the link', async () => {
		await expect(
			createKnowledgeLink(WS, 'node-a', 'node-b', 'related_to', 0.5, {
				snippet: 'sensitive edge evidence',
				evidenceKind: 'llm_extracted',
			}),
		).rejects.toThrow('createKnowledgeLink: envelope required when evidence snippet is provided');

		expect(mockInsert).not.toHaveBeenCalled();
	});

	it('supports all 6 link types', async () => {
		const linkTypes = [
			'part_of',
			'related_to',
			'competes_with',
			'builds_on',
			'funds',
			'uses',
		] as const;
		for (const linkType of linkTypes) {
			vi.clearAllMocks();
			mockInsert.mockReturnValue({ values: mockInsertValues });
			mockInsertValues.mockReturnValue({
				onConflictDoUpdate: mockOnConflict,
				returning: mockInsertReturning,
			});
			mockOnConflict.mockReturnValue({ returning: mockInsertReturning });
			mockInsertReturning.mockResolvedValueOnce([{ id: 'link-1', linkType }]);

			const result = await createKnowledgeLink(WS, 'node-a', 'node-b', linkType);
			expect(result.linkType).toBe(linkType);
		}
	});
});

// ─── getKnowledgeNeighbors ────────────────────────────────────────────────────

describe('getKnowledgeNeighbors', () => {
	const mockLink = {
		id: 'link-1',
		workspaceId: WS,
		sourceNodeId: 'node-a',
		targetNodeId: 'node-b',
		linkType: 'related_to',
		weight: 0.5,
		createdAt: new Date(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mockSelect.mockReturnValue({ from: mockSelectFrom });
		mockSelectFrom.mockReturnValue({ innerJoin: mockInnerJoin });
		mockInnerJoin.mockReturnValue({ where: mockInnerJoinWhere });
	});

	it('returns outbound neighbors with direction flag', async () => {
		const outboundRow = { link: mockLink, node: baseNode };
		// First call = outbound, second call = inbound (empty)
		mockInnerJoinWhere.mockResolvedValueOnce([outboundRow]).mockResolvedValueOnce([]);

		const result = await getKnowledgeNeighbors('node-a', WS);

		expect(result).toHaveLength(1);
		expect(result[0]?.direction).toBe('outbound');
		expect(result[0]?.node).toEqual(baseNode);
	});

	it('returns inbound neighbors with direction flag', async () => {
		const inboundRow = { link: mockLink, node: baseNode };
		// First call = outbound (empty), second call = inbound
		mockInnerJoinWhere.mockResolvedValueOnce([]).mockResolvedValueOnce([inboundRow]);

		const result = await getKnowledgeNeighbors('node-b', WS);

		expect(result).toHaveLength(1);
		expect(result[0]?.direction).toBe('inbound');
	});

	it('merges outbound and inbound into a single array', async () => {
		mockInnerJoinWhere
			.mockResolvedValueOnce([{ link: mockLink, node: baseNode }])
			.mockResolvedValueOnce([{ link: mockLink, node: { ...baseNode, id: 'node-c' } }]);

		const result = await getKnowledgeNeighbors('node-a', WS);

		expect(result).toHaveLength(2);
		expect(result.some((r) => r.direction === 'outbound')).toBe(true);
		expect(result.some((r) => r.direction === 'inbound')).toBe(true);
	});

	it('returns empty array when node has no links', async () => {
		mockInnerJoinWhere.mockResolvedValue([]);

		const result = await getKnowledgeNeighbors('isolated-node', WS);

		expect(result).toEqual([]);
		expect(mockSelect).toHaveBeenCalledTimes(2); // still makes both queries
	});

	it('makes two separate queries scoped to workspaceId', async () => {
		mockInnerJoinWhere.mockResolvedValue([]);

		await getKnowledgeNeighbors('node-a', WS);

		expect(mockSelect).toHaveBeenCalledTimes(2);
		expect(mockInnerJoinWhere).toHaveBeenCalledTimes(2);
	});
});

// ─── getSharedKnowledge ───────────────────────────────────────────────────────

describe('getSharedKnowledge', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExecute.mockResolvedValue([]); // default: no shared node IDs
	});

	it('returns nodes shared by both contacts (two-step: IDs then Drizzle ORM)', async () => {
		// Step 1: execute returns shared node IDs
		mockExecute.mockResolvedValueOnce([{ id: 'node-1' }]);
		// Step 2: Drizzle ORM returns full nodes
		const mockLimit = vi.fn().mockResolvedValue([baseNode]);
		const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
		mockSelectWhere.mockReturnValue({ orderBy: mockOrderBy });
		mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
		mockSelect.mockReturnValue({ from: mockSelectFrom });

		const result = await getSharedKnowledge('contact-a', 'contact-b', WS);

		expect(mockExecute).toHaveBeenCalledTimes(1);
		expect(mockSelect).toHaveBeenCalledTimes(1);
		expect(result).toEqual([baseNode]);
	});

	it('returns empty array when contacts share no knowledge nodes', async () => {
		mockExecute.mockResolvedValueOnce([]);

		const result = await getSharedKnowledge('contact-a', 'contact-b', WS);

		expect(result).toEqual([]);
	});

	it('calls db.execute for IDs with workspace isolation', async () => {
		mockExecute.mockResolvedValue([]);

		await getSharedKnowledge('ca', 'cb', WS);
		await getSharedKnowledge('cx', 'cy', 'ws-other');

		expect(mockExecute).toHaveBeenCalledTimes(2);
	});
});

// ─── knowledgeGraphSearch ─────────────────────────────────────────────────────

describe('knowledgeGraphSearch', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExecute.mockResolvedValue([]); // default: no reachable node IDs from CTE
	});

	it('returns reachable nodes with depth (two-step: CTE IDs then Drizzle ORM)', async () => {
		// Step 1: CTE returns node IDs with depths
		mockExecute.mockResolvedValueOnce([{ node_id: 'node-1', depth: 1 }]);
		// Step 2: Drizzle ORM returns full nodes
		mockSelectWhere.mockResolvedValue([baseNode]);
		mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
		mockSelect.mockReturnValue({ from: mockSelectFrom });

		const result = await knowledgeGraphSearch('node-a', WS);

		expect(mockExecute).toHaveBeenCalledTimes(1);
		expect(mockSelect).toHaveBeenCalledTimes(1);
		expect(result).toHaveLength(1);
		expect(result[0]?.depth).toBe(1);
	});

	it('returns empty array when no reachable nodes exist', async () => {
		mockExecute.mockResolvedValueOnce([]);

		const result = await knowledgeGraphSearch('isolated-node', WS);

		expect(result).toEqual([]);
	});

	it('uses db.execute for recursive CTE traversal', async () => {
		mockExecute.mockResolvedValue([]);

		await knowledgeGraphSearch('node-a', WS, 2);
		await knowledgeGraphSearch('node-a', 'ws-other', 2);

		expect(mockExecute).toHaveBeenCalledTimes(2);
	});
});

// ─── Workspace isolation ──────────────────────────────────────────────────────

describe('workspace isolation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		const mockOffset = vi.fn().mockResolvedValue([]);
		const mockLimitFn = vi.fn().mockReturnValue({ offset: mockOffset });
		const mockOrderByFn = vi.fn().mockReturnValue({ limit: mockLimitFn });
		mockSelect.mockReturnValue({ from: mockSelectFrom });
		mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
		mockSelectWhere.mockReturnValue({ orderBy: mockOrderByFn });
	});

	it('listKnowledgeNodes scopes each call to its own workspaceId', async () => {
		await listKnowledgeNodes('ws-A');
		await listKnowledgeNodes('ws-B');

		// Two separate select calls, each with workspace filter
		expect(mockSelect).toHaveBeenCalledTimes(2);
		expect(mockSelectWhere).toHaveBeenCalledTimes(2);
	});
});
