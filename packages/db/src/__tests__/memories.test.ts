import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock DB client — chain: select().from().where().limit().orderBy()
const mockOrderBy = vi.fn(() => Promise.resolve([] as unknown[]));
const mockLimit = vi.fn(() => ({ orderBy: mockOrderBy }));
const mockSelectWhere = vi.fn(() => ({ limit: mockLimit }));
const mockFrom = vi.fn(() => ({ where: mockSelectWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

// execute() for raw SQL (hybridSearch, updateMemoryEmbedding)
const mockExecute = vi.fn(() => Promise.resolve([]));

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
});
