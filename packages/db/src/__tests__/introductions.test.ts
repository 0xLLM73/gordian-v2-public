import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@repo/crypto', () => ({
	withKeys: vi.fn((_envelope: unknown, fn: () => unknown) => fn()),
	keyStore: { getStore: vi.fn(() => null) },
	computeBlindIndex: vi.fn((val: string) => `bidx:${val}`),
}));

const MOCK_ENVELOPE = { encryptedWrk: Buffer.from('test'), kmsContext: {}, wrkVersion: 1 };

// Mock DB client — builder pattern
const mockReturning = vi.fn();
const mockLimit = vi.fn(() => Promise.resolve([]));
const mockWhere = vi.fn(() => ({ limit: mockLimit, returning: mockReturning }));
const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
const mockOffset = vi.fn(() => ({ orderBy: mockOrderBy }));
const _mockLimitChain = vi.fn(() => ({ offset: mockOffset }));
const _mockGroupBy = vi.fn(() => ({ orderBy: mockOrderBy }));
const mockFromSelect = vi.fn(() => ({ where: mockWhere }));
const mockInsertValues = vi.fn(() => ({ returning: mockReturning }));
const mockSet = vi.fn(() => ({ where: vi.fn(() => ({ returning: mockReturning })) }));
const mockUpdate = vi.fn(() => ({ set: mockSet }));
const mockInsert = vi.fn(() => ({ values: mockInsertValues }));
const mockSelect = vi.fn(() => ({ from: mockFromSelect }));

vi.mock('../client', () => ({
	db: {
		insert: mockInsert,
		update: mockUpdate,
		select: mockSelect,
	},
}));

describe('introductions DAL', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset default chain
		mockWhere.mockReturnValue({ limit: mockLimit, returning: mockReturning });
		mockLimit.mockResolvedValue([]);
	});

	it('createIntroduction initializes statusHistory with triage entry', async () => {
		// No duplicate found
		mockLimit.mockResolvedValueOnce([]); // dedup check returns empty
		const mockRow = { id: 'intro-1', workspaceId: 'ws-1', status: 'triage', statusHistory: [] };
		mockReturning.mockResolvedValueOnce([mockRow]);

		const { createIntroduction } = await import('../dal/introductions');
		await createIntroduction(
			'ws-1',
			{
				introducerContactId: 'c-1',
				introducedContactId1: 'c-2',
				introducedContactId2: 'c-3',
				confidence: 0.9,
			},
			MOCK_ENVELOPE,
		);

		expect(mockInsert).toHaveBeenCalled();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const insertedValues = (mockInsertValues.mock.calls as any[])[0][0] as Record<string, unknown>;
		const history = insertedValues.statusHistory as Array<Record<string, unknown>>;
		expect(Array.isArray(history)).toBe(true);
		expect(history[0].status).toBe('triage');
		expect(history[0].timestamp).toBeDefined();
	});

	it('createIntroduction auto-confirms with status=active when passed', async () => {
		mockLimit.mockResolvedValueOnce([]); // dedup check returns empty
		const mockRow = { id: 'intro-2', workspaceId: 'ws-1', status: 'active', autoConfirmed: true };
		mockReturning.mockResolvedValueOnce([mockRow]);

		const { createIntroduction } = await import('../dal/introductions');
		await createIntroduction(
			'ws-1',
			{
				introducerContactId: 'c-1',
				introducedContactId1: 'c-2',
				introducedContactId2: 'c-3',
				confidence: 0.95,
				status: 'active',
				autoConfirmed: true,
			},
			MOCK_ENVELOPE,
		);

		expect(mockInsert).toHaveBeenCalled();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const insertedValues = (mockInsertValues.mock.calls as any[])[0][0] as Record<string, unknown>;
		expect(insertedValues.status).toBe('active');
		expect(insertedValues.autoConfirmed).toBe(true);
		const history = insertedValues.statusHistory as Array<Record<string, unknown>>;
		expect(history[0].status).toBe('active');
	});

	it('createIntroduction returns null for confidence < 0.3', async () => {
		const { createIntroduction } = await import('../dal/introductions');
		const result = await createIntroduction(
			'ws-1',
			{
				introducerContactId: 'c-1',
				introducedContactId1: 'c-2',
				introducedContactId2: 'c-3',
				confidence: 0.2,
			},
			MOCK_ENVELOPE,
		);

		expect(result).toBeNull();
		expect(mockInsert).not.toHaveBeenCalled();
	});

	it('createIntroduction dedup within 7 days returns null without inserting', async () => {
		// Dedup check finds existing
		(mockLimit as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ id: 'existing-intro' }]);

		const { createIntroduction } = await import('../dal/introductions');
		const result = await createIntroduction(
			'ws-1',
			{
				introducerContactId: 'c-1',
				introducedContactId1: 'c-2',
				introducedContactId2: 'c-3',
				confidence: 0.8,
			},
			MOCK_ENVELOPE,
		);

		expect(result).toBeNull();
		expect(mockInsert).not.toHaveBeenCalled();
	});

	it('updateIntroductionStatus appends to history on valid transition', async () => {
		const existing = {
			id: 'intro-1',
			workspaceId: 'ws-1',
			status: 'triage',
			statusHistory: [{ status: 'triage', timestamp: '2026-01-01T00:00:00Z' }],
		};
		(mockLimit as ReturnType<typeof vi.fn>).mockResolvedValueOnce([existing]);
		const updated = { ...existing, status: 'active' };
		mockReturning.mockResolvedValueOnce([updated]);

		const { updateIntroductionStatus } = await import('../dal/introductions');
		const result = await updateIntroductionStatus('ws-1', 'intro-1', 'active');

		expect(result).toBeDefined();
		expect(mockUpdate).toHaveBeenCalled();
		// Verify the set call included history with new entry
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const setArg = (mockSet.mock.calls as any[])[0][0] as Record<string, unknown>;
		const history = setArg.statusHistory as Array<Record<string, unknown>>;
		expect(Array.isArray(history)).toBe(true);
		expect(history.length).toBe(2);
		expect(history[1].status).toBe('active');
	});

	it('updateIntroductionStatus returns null on invalid transition', async () => {
		const existing = {
			id: 'intro-1',
			workspaceId: 'ws-1',
			status: 'archive', // archive has no valid transitions
			statusHistory: [],
		};
		(mockLimit as ReturnType<typeof vi.fn>).mockResolvedValueOnce([existing]);

		const { updateIntroductionStatus } = await import('../dal/introductions');
		const result = await updateIntroductionStatus('ws-1', 'intro-1', 'active');

		expect(result).toBeNull();
		expect(mockUpdate).not.toHaveBeenCalled();
	});
});
