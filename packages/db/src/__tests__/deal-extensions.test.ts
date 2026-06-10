import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@repo/crypto', () => ({
	withKeys: vi.fn((_envelope: unknown, fn: () => unknown) => fn()),
	keyStore: { getStore: vi.fn(() => null) },
	computeBlindIndex: vi.fn((val: string) => `bidx:${val}`),
}));

const MOCK_ENVELOPE = { encryptedWrk: Buffer.from('test'), kmsContext: {}, wrkVersion: 1 };

const mockReturning = vi.fn();
const mockOnConflictDoNothing = vi.fn(() => ({ returning: mockReturning }));
const mockValues = vi.fn(() => ({
	returning: mockReturning,
	onConflictDoNothing: mockOnConflictDoNothing,
}));
const mockInsert = vi.fn(() => ({ values: mockValues }));
const mockLimit = vi.fn<any>(() => Promise.resolve([]));
const mockWhere = vi.fn<any>(() => ({ limit: mockLimit }));
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));
const mockDelete = vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) }));

vi.mock('../client', () => ({
	db: {
		insert: mockInsert,
		select: mockSelect,
		delete: mockDelete,
	},
}));

describe('deal-participants DAL', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('addDealParticipant inserts with onConflictDoNothing', async () => {
		// SEC-107: Mock deal validation query → found
		mockLimit.mockResolvedValueOnce([{ id: 'deal-1' }]);
		// SEC-107: Mock contact validation query → found
		mockLimit.mockResolvedValueOnce([{ id: 'c-1' }]);
		mockReturning.mockResolvedValue([{ id: 'dp-1' }]);

		const { addDealParticipant } = await import('../dal/deal-participants');
		const result = await addDealParticipant(
			'ws-1',
			{
				dealId: 'deal-1',
				contactId: 'c-1',
				role: 'lead',
			},
			MOCK_ENVELOPE,
		);

		expect(mockInsert).toHaveBeenCalled();
		expect(mockOnConflictDoNothing).toHaveBeenCalled();
		expect(result).toEqual({ id: 'dp-1' });
	});

	it('addDealParticipant rejects cross-workspace dealId', async () => {
		// SEC-107: Mock deal validation → not found
		mockLimit.mockResolvedValueOnce([]);

		const { addDealParticipant } = await import('../dal/deal-participants');
		await expect(
			addDealParticipant(
				'ws-1',
				{ dealId: 'deal-other', contactId: 'c-1', role: 'lead' },
				MOCK_ENVELOPE,
			),
		).rejects.toThrow('Not found');
	});

	it('addDealParticipant rejects cross-workspace contactId', async () => {
		// SEC-107: Mock deal validation → found
		mockLimit.mockResolvedValueOnce([{ id: 'deal-1' }]);
		// SEC-107: Mock contact validation → not found
		mockLimit.mockResolvedValueOnce([]);

		const { addDealParticipant } = await import('../dal/deal-participants');
		await expect(
			addDealParticipant('ws-1', { dealId: 'deal-1', contactId: 'c-other' }, MOCK_ENVELOPE),
		).rejects.toThrow('Not found');
	});

	it('listDealParticipants filters by workspace and deal', async () => {
		mockWhere.mockResolvedValueOnce([{ id: 'dp-1' }]);

		const { listDealParticipants } = await import('../dal/deal-participants');
		const result = await listDealParticipants('ws-1', 'deal-1', MOCK_ENVELOPE);

		expect(mockSelect).toHaveBeenCalled();
		expect(result).toHaveLength(1);
	});

	it('removeDealParticipant deletes by id and workspace', async () => {
		const { removeDealParticipant } = await import('../dal/deal-participants');
		await removeDealParticipant('ws-1', 'dp-1');

		expect(mockDelete).toHaveBeenCalled();
	});
});

describe('deal-artifacts DAL', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('addDealArtifact inserts with correct values', async () => {
		// SEC-107: Mock deal validation query → found
		mockLimit.mockResolvedValueOnce([{ id: 'deal-1' }]);
		mockReturning.mockResolvedValue([{ id: 'da-1' }]);

		const { addDealArtifact } = await import('../dal/deal-artifacts');
		const result = await addDealArtifact(
			'ws-1',
			{
				dealId: 'deal-1',
				title: 'SAFT Agreement',
				artifactType: 'saft',
			},
			MOCK_ENVELOPE,
		);

		expect(mockInsert).toHaveBeenCalled();
		expect(result).toEqual({ id: 'da-1' });
	});

	it('addDealArtifact rejects cross-workspace dealId', async () => {
		// SEC-107: Mock deal validation → not found
		mockLimit.mockResolvedValueOnce([]);

		const { addDealArtifact } = await import('../dal/deal-artifacts');
		await expect(
			addDealArtifact('ws-1', { dealId: 'deal-other', title: 'Test' }, MOCK_ENVELOPE),
		).rejects.toThrow('Not found');
	});

	it('listDealArtifacts filters by workspace and deal with an envelope', async () => {
		mockWhere.mockResolvedValueOnce([{ id: 'da-1', title: 'SAFT Agreement' }]);

		const { listDealArtifacts } = await import('../dal/deal-artifacts');
		const result = await listDealArtifacts('ws-1', 'deal-1', MOCK_ENVELOPE);

		expect(mockSelect).toHaveBeenCalled();
		expect(result).toHaveLength(1);
	});

	it('removeDealArtifact deletes by id and workspace', async () => {
		const { removeDealArtifact } = await import('../dal/deal-artifacts');
		await removeDealArtifact('ws-1', 'da-1');

		expect(mockDelete).toHaveBeenCalled();
	});
});
