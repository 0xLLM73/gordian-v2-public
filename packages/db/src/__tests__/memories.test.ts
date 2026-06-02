import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock DB client — chain: select().from().where().limit().orderBy()
const mockOrderBy = vi.fn(() => Promise.resolve([] as unknown[]));
const mockLimit = vi.fn(() => ({ orderBy: mockOrderBy }));
const mockSelectWhere = vi.fn(() => ({ limit: mockLimit }));
const mockFrom = vi.fn(() => ({ where: mockSelectWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

// execute() for raw SQL (hybridSearch, updateMemoryEmbedding)
const mockExecute = vi.fn((): Promise<unknown[]> => Promise.resolve([]));

vi.mock('../client', () => ({
	db: {
		select: mockSelect,
		execute: mockExecute,
	},
}));

vi.mock('@repo/crypto', () => ({
	withKeys: vi.fn((_envelope: unknown, fn: () => unknown) => fn()),
}));

const mockEnvelope = {
	encryptedWrk: Buffer.from('test'),
	kmsContext: { workspaceId: 'ws-1' },
	wrkVersion: 1,
};

const WORKSPACE_ID = 'ws-1';
const WS_1 = '550e8400-e29b-41d4-a716-446655440001';
const WS_2 = '550e8400-e29b-41d4-a716-446655440002';
const CONTACT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MSG_1 = '11111111-1111-4111-8111-111111111111';
const MSG_2 = '22222222-2222-4222-8222-222222222222';
const MSG_MISSING = '33333333-3333-4333-8333-333333333333';

describe('memories DAL', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('getUnembeddedMemories', () => {
		it('returns decrypted memories with no embedding', async () => {
			const mockRows = [
				{
					id: 'mem-1',
					content: 'Alice called about the deal',
					category: 'general',
				},
				{
					id: 'mem-2',
					content: 'Bob mentioned a new project',
					category: 'commitment',
				},
			];
			mockOrderBy.mockResolvedValue(mockRows);

			const { getUnembeddedMemories } = await import('../dal/memories');
			const result = await getUnembeddedMemories(WORKSPACE_ID, mockEnvelope, 50);

			expect(mockSelect).toHaveBeenCalled();
			expect(mockFrom).toHaveBeenCalled();
			expect(mockSelectWhere).toHaveBeenCalled();
			expect(mockLimit).toHaveBeenCalledWith(50);
			expect(result).toHaveLength(2);
			expect(result[0]).toEqual({
				id: 'mem-1',
				content: 'Alice called about the deal',
				category: 'general',
			});
			expect(result[1]).toEqual({
				id: 'mem-2',
				content: 'Bob mentioned a new project',
				category: 'commitment',
			});
		});

		it('returns empty array when all memories have embeddings', async () => {
			mockOrderBy.mockResolvedValue([]);

			const { getUnembeddedMemories } = await import('../dal/memories');
			const result = await getUnembeddedMemories(WORKSPACE_ID, mockEnvelope);

			expect(result).toHaveLength(0);
		});

		it('uses default limit of 100 when not specified', async () => {
			mockOrderBy.mockResolvedValue([]);

			const { getUnembeddedMemories } = await import('../dal/memories');
			await getUnembeddedMemories(WORKSPACE_ID, mockEnvelope);

			expect(mockLimit).toHaveBeenCalledWith(100);
		});

		it('calls withKeys to decrypt content', async () => {
			const { withKeys } = await import('@repo/crypto');
			const mockWithKeys = vi.mocked(withKeys);
			mockOrderBy.mockResolvedValue([]);

			const { getUnembeddedMemories } = await import('../dal/memories');
			await getUnembeddedMemories(WORKSPACE_ID, mockEnvelope, 25);

			expect(mockWithKeys).toHaveBeenCalledWith(mockEnvelope, expect.any(Function));
		});
	});

	describe('memory message metadata backfill', () => {
		beforeEach(() => {
			mockExecute.mockReset();
		});

		it('reports deterministic legacy candidates without writing in dry-run mode', async () => {
			mockExecute
				.mockResolvedValueOnce([
					{
						id: 'mem-eligible',
						workspaceId: WS_1,
						contactId: CONTACT_ID,
						category: 'general',
						metadata: { sourceMessageId: MSG_1, keywords: ['helium'] },
						createdAt: new Date('2026-05-01T00:00:00Z'),
					},
					{
						id: 'mem-already',
						workspaceId: WS_1,
						contactId: CONTACT_ID,
						category: 'general',
						metadata: { messageId: MSG_2 },
						createdAt: new Date('2026-05-01T00:00:00Z'),
					},
					{
						id: 'mem-ambiguous',
						workspaceId: WS_1,
						contactId: CONTACT_ID,
						category: 'general',
						metadata: { sourceMessageIds: [MSG_1, MSG_2] },
						createdAt: new Date('2026-05-01T00:00:00Z'),
					},
					{
						id: 'mem-no-source',
						workspaceId: WS_1,
						contactId: null,
						category: 'general',
						metadata: { keywords: ['crm'] },
						createdAt: new Date('2026-05-01T00:00:00Z'),
					},
					{
						id: 'mem-no-message',
						workspaceId: WS_1,
						contactId: CONTACT_ID,
						category: 'general',
						metadata: { source_message_id: MSG_MISSING },
						createdAt: new Date('2026-05-01T00:00:00Z'),
					},
				])
				.mockResolvedValueOnce([{ id: MSG_1, workspaceId: WS_1 }])
				.mockResolvedValueOnce([
					{
						evidenceId: 'evidence-1',
						workspaceId: WS_1,
						messageId: MSG_1,
						knowledgeNodeId: 'node-1',
					},
					{
						evidenceId: 'evidence-2',
						workspaceId: WS_1,
						messageId: MSG_1,
						knowledgeNodeId: 'node-1',
					},
				]);

			const { backfillMemoryMessageMetadata } = await import('../dal/memories');
			const report = await backfillMemoryMessageMetadata({
				now: new Date('2026-05-07T00:00:00Z'),
			});

			expect(report.mode).toBe('dry-run');
			expect(report.totalMemories).toBe(5);
			expect(report.memoriesMissingMessageId).toBe(4);
			expect(report.eligibleForBackfill).toBe(1);
			expect(report.skippedAlreadyHasMessageId).toBe(1);
			expect(report.skippedAmbiguous).toBe(1);
			expect(report.skippedNoDeterministicSource).toBe(1);
			expect(report.skippedNoMatchingMessage).toBe(1);
			expect(report.estimatedUnlockedEvidenceRows).toBe(2);
			expect(report.estimatedUnlockedKnowledgeNodes).toBe(1);
			expect(report.updated).toBe(0);
			expect(report.candidates[0]).toMatchObject({
				memoryId: 'mem-eligible',
				messageId: MSG_1,
				sourceKey: 'sourceMessageId',
			});
			expect(JSON.stringify(report)).not.toContain('embedding');
			expect(mockExecute).toHaveBeenCalledTimes(3);
		});

		it('requires explicit write mode before updating metadata', async () => {
			mockExecute
				.mockResolvedValueOnce([
					{
						id: 'mem-eligible',
						workspaceId: WS_1,
						contactId: CONTACT_ID,
						category: 'general',
						metadata: { sourceMessageId: MSG_1 },
						createdAt: new Date('2026-05-01T00:00:00Z'),
					},
				])
				.mockResolvedValueOnce([{ id: MSG_1, workspaceId: WS_1 }])
				.mockResolvedValueOnce([]);

			const { backfillMemoryMessageMetadata } = await import('../dal/memories');
			const report = await backfillMemoryMessageMetadata();

			expect(report.mode).toBe('dry-run');
			expect(report.eligibleForBackfill).toBe(1);
			expect(report.updated).toBe(0);
			expect(mockExecute).toHaveBeenCalledTimes(3);
		});

		it('writes deterministic single-message mappings when write mode is explicit', async () => {
			mockExecute
				.mockResolvedValueOnce([
					{
						id: 'mem-eligible',
						workspaceId: WS_1,
						contactId: CONTACT_ID,
						category: 'general',
						metadata: { sourceMessageIds: [MSG_1] },
						createdAt: new Date('2026-05-01T00:00:00Z'),
					},
				])
				.mockResolvedValueOnce([{ id: MSG_1, workspaceId: WS_1 }])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([{ id: 'mem-eligible' }]);

			const { backfillMemoryMessageMetadata } = await import('../dal/memories');
			const report = await backfillMemoryMessageMetadata({
				write: true,
				now: new Date('2026-05-07T00:00:00Z'),
			});

			expect(report.mode).toBe('write');
			expect(report.eligibleForBackfill).toBe(1);
			expect(report.updated).toBe(1);
			expect(mockExecute).toHaveBeenCalledTimes(4);
		});

		it('skips cross-workspace message ids instead of backfilling them', async () => {
			mockExecute
				.mockResolvedValueOnce([
					{
						id: 'mem-cross-workspace',
						workspaceId: WS_2,
						contactId: CONTACT_ID,
						category: 'general',
						metadata: { sourceMessageId: MSG_1 },
						createdAt: new Date('2026-05-01T00:00:00Z'),
					},
				])
				.mockResolvedValueOnce([{ id: MSG_1, workspaceId: WS_1 }])
				.mockResolvedValueOnce([]);

			const { backfillMemoryMessageMetadata } = await import('../dal/memories');
			const report = await backfillMemoryMessageMetadata({ write: true });

			expect(report.eligibleForBackfill).toBe(0);
			expect(report.skippedNoMatchingMessage).toBe(1);
			expect(report.updated).toBe(0);
			expect(mockExecute).toHaveBeenCalledTimes(3);
		});

		it('preserves existing metadata keys when creating the backfill patch', async () => {
			const { mergeMemoryMessageBackfillMetadata } = await import('../dal/memories');
			const merged = mergeMemoryMessageBackfillMetadata(
				{ keywords: ['helium'], sourceMessageId: MSG_1 },
				MSG_1,
				'sourceMessageId',
				new Date('2026-05-07T00:00:00Z'),
			);

			expect(merged).toEqual({
				keywords: ['helium'],
				sourceMessageId: MSG_1,
				messageId: MSG_1,
				messageIdBackfilledAt: '2026-05-07T00:00:00.000Z',
				messageIdBackfillSource: 'sourceMessageId',
			});
		});

		it('does not enter encrypted decrypt context or raw message scanning', async () => {
			mockExecute.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);

			const { withKeys } = await import('@repo/crypto');
			const { backfillMemoryMessageMetadata } = await import('../dal/memories');
			await backfillMemoryMessageMetadata();

			expect(withKeys).not.toHaveBeenCalled();
		});
	});
});
