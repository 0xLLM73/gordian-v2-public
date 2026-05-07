import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@repo/crypto', () => ({
	withKeys: vi.fn((_envelope: unknown, fn: () => unknown) => fn()),
	keyStore: { getStore: vi.fn(() => null) },
	computeBlindIndex: vi.fn((val: string) => `bidx:${val}`),
}));

const MOCK_ENVELOPE = { encryptedWrk: Buffer.from('test'), kmsContext: {}, wrkVersion: 1 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock chain
const mockReturning = vi.fn<any>();
const mockLimit = vi.fn<any>(() => Promise.resolve([]));
const mockOrderBy = vi.fn<any>(() => ({ limit: mockLimit }));
const mockWhere = vi.fn<any>(() => ({
	returning: mockReturning,
	orderBy: mockOrderBy,
	limit: mockLimit,
}));
const mockFrom = vi.fn<any>(() => ({ where: mockWhere }));
const mockSelect = vi.fn<any>(() => ({ from: mockFrom }));
const mockValues = vi.fn<any>(() => ({ returning: mockReturning }));
const mockInsert = vi.fn<any>(() => ({ values: mockValues }));
const mockSetWhere = vi.fn<any>(() => ({ returning: mockReturning }));
const mockSet = vi.fn<any>(() => ({ where: mockSetWhere }));
const mockUpdate = vi.fn<any>(() => ({ set: mockSet }));
const mockInnerJoin = vi.fn<any>(() => ({ where: mockWhere }));

// SEC-105: db.transaction mock — executes callback with the same mock chain
const mockDb = {
	insert: mockInsert,
	update: mockUpdate,
	select: mockSelect,
	transaction: vi.fn<any>((fn: (tx: any) => Promise<any>) => fn(mockDb)),
};

vi.mock('../client', () => ({
	db: mockDb,
}));

function setupChain() {
	mockSelect.mockReturnValue({ from: mockFrom });
	mockFrom.mockReturnValue({ where: mockWhere, innerJoin: mockInnerJoin });
	mockWhere.mockReturnValue({ returning: mockReturning, orderBy: mockOrderBy, limit: mockLimit });
	mockOrderBy.mockReturnValue({ limit: mockLimit });
	mockLimit.mockResolvedValue([]);
	mockInsert.mockReturnValue({ values: mockValues });
	mockValues.mockReturnValue({ returning: mockReturning });
	mockUpdate.mockReturnValue({ set: mockSet });
	mockSet.mockReturnValue({ where: mockSetWhere });
	mockSetWhere.mockReturnValue({ returning: mockReturning });
	// SEC-105: Restore transaction mock after resetAllMocks clears it
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock chain
	mockDb.transaction.mockImplementation(((fn: any) => fn(mockDb)) as any);
}

describe('follow-up plans DAL', () => {
	beforeEach(async () => {
		vi.resetAllMocks();
		setupChain();
		// Restore withKeys mock after resetAllMocks clears it
		const crypto = await import('@repo/crypto');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(crypto.withKeys as any).mockImplementation((_env: unknown, fn: () => unknown) => fn());
	});

	describe('createFollowUpPlan', () => {
		it('enforces MAX_ACTIVE_FOLLOW_UP_PLANS limit', async () => {
			// SEC-106: contact validation → found (1st mockFrom call uses default chain)
			mockLimit.mockResolvedValueOnce([{ id: 'c-1' }]);
			// Count query (2nd mockFrom call): override with count result
			mockFrom
				.mockReturnValueOnce({ where: mockWhere }) // 1st: contact validation (default)
				.mockReturnValueOnce({
					// 2nd: count query
					where: vi.fn(() => Promise.resolve([{ count: 10 }])),
				});

			const { createFollowUpPlan } = await import('../dal/follow-up-plans');
			await expect(
				createFollowUpPlan(
					'ws-1',
					{
						contactId: 'c-1',
						title: 'Test',
						steps: [{ prompt: 'Hello', delayHours: 0 }],
					},
					MOCK_ENVELOPE,
				),
			).rejects.toThrow('Maximum of 10 active follow-up plans');
		});

		it('rejects cross-workspace contactId (SEC-106)', async () => {
			// Contact validation → not found
			mockLimit.mockResolvedValueOnce([]);

			const { createFollowUpPlan } = await import('../dal/follow-up-plans');
			await expect(
				createFollowUpPlan(
					'ws-1',
					{
						contactId: 'c-other-workspace',
						title: 'Test',
						steps: [{ prompt: 'Hello', delayHours: 0 }],
					},
					MOCK_ENVELOPE,
				),
			).rejects.toThrow('Not found');
		});

		it('inserts plan and steps', async () => {
			// SEC-106: contact validation → found (1st mockFrom), count (2nd mockFrom)
			mockLimit.mockResolvedValueOnce([{ id: 'c-1' }]);
			mockFrom
				.mockReturnValueOnce({ where: mockWhere }) // 1st: contact validation
				.mockReturnValueOnce({
					// 2nd: count query
					where: vi.fn(() => Promise.resolve([{ count: 0 }])),
				});
			// Plan insert
			mockReturning.mockResolvedValueOnce([{ id: 'plan-1', workspaceId: 'ws-1', title: 'Test' }]);

			const { createFollowUpPlan } = await import('../dal/follow-up-plans');
			const result = await createFollowUpPlan(
				'ws-1',
				{
					contactId: 'c-1',
					title: 'Test',
					steps: [
						{ prompt: 'Step 1', delayHours: 0 },
						{ prompt: 'Step 2', delayHours: 24 },
					],
				},
				MOCK_ENVELOPE,
			);

			expect(mockInsert).toHaveBeenCalled();
			expect(result).toEqual(expect.objectContaining({ id: 'plan-1' }));
		});
	});

	describe('activateFollowUpPlan', () => {
		it('transitions draft to active and schedules first step', async () => {
			// Count query: 0 active
			mockFrom.mockReturnValueOnce({
				where: vi.fn(() => Promise.resolve([{ count: 0 }])),
			});
			// Update returning activated plan
			mockReturning.mockResolvedValueOnce([{ id: 'plan-1', status: 'active' }]);
			// SEC-112: First step select (workspace-scoped)
			mockLimit.mockResolvedValueOnce([{ id: 'step-1', delayHours: 2 }]);

			const { activateFollowUpPlan } = await import('../dal/follow-up-plans');
			const result = await activateFollowUpPlan('ws-1', 'plan-1');

			expect(result).toEqual(expect.objectContaining({ id: 'plan-1', status: 'active' }));
		});

		it('returns null for non-draft plan', async () => {
			// Count query: 0 active
			mockFrom.mockReturnValueOnce({
				where: vi.fn(() => Promise.resolve([{ count: 0 }])),
			});
			// Update returning empty (status guard failed)
			mockReturning.mockResolvedValueOnce([]);

			const { activateFollowUpPlan } = await import('../dal/follow-up-plans');
			const result = await activateFollowUpPlan('ws-1', 'plan-1');

			expect(result).toBeNull();
		});
	});

	describe('pauseFollowUpPlan', () => {
		it('transitions active to paused', async () => {
			mockReturning.mockResolvedValueOnce([{ id: 'plan-1', status: 'paused' }]);

			const { pauseFollowUpPlan } = await import('../dal/follow-up-plans');
			const result = await pauseFollowUpPlan('ws-1', 'plan-1');

			expect(result).toEqual(expect.objectContaining({ status: 'paused' }));
		});

		it('returns null for non-active plan', async () => {
			mockReturning.mockResolvedValueOnce([]);

			const { pauseFollowUpPlan } = await import('../dal/follow-up-plans');
			const result = await pauseFollowUpPlan('ws-1', 'plan-1');

			expect(result).toBeNull();
		});
	});

	describe('resumeFollowUpPlan', () => {
		it('transitions paused to active', async () => {
			// Count query: 0 active
			mockFrom.mockReturnValueOnce({
				where: vi.fn(() => Promise.resolve([{ count: 0 }])),
			});
			mockReturning.mockResolvedValueOnce([{ id: 'plan-1', status: 'active' }]);

			const { resumeFollowUpPlan } = await import('../dal/follow-up-plans');
			const result = await resumeFollowUpPlan('ws-1', 'plan-1');

			expect(result).toEqual(expect.objectContaining({ status: 'active' }));
		});

		it('enforces max active plans on resume', async () => {
			mockFrom.mockReturnValueOnce({
				where: vi.fn(() => Promise.resolve([{ count: 10 }])),
			});

			const { resumeFollowUpPlan } = await import('../dal/follow-up-plans');
			await expect(resumeFollowUpPlan('ws-1', 'plan-1')).rejects.toThrow('Maximum of 10');
		});
	});

	describe('cancelFollowUpPlan', () => {
		it('cancels plan regardless of current status', async () => {
			mockReturning.mockResolvedValueOnce([{ id: 'plan-1', status: 'cancelled' }]);

			const { cancelFollowUpPlan } = await import('../dal/follow-up-plans');
			const result = await cancelFollowUpPlan('ws-1', 'plan-1');

			expect(result).toEqual(expect.objectContaining({ status: 'cancelled' }));
		});
	});

	describe('advanceStep', () => {
		it('marks step as sent and advances to next', async () => {
			// Current step update
			mockReturning.mockResolvedValueOnce([{ id: 'step-1', cadenceId: 'plan-1', stepNumber: 1 }]);
			// SEC-113: Next step query (workspace-scoped)
			mockLimit.mockResolvedValueOnce([{ id: 'step-2', delayHours: 24 }]);

			const { advanceStep } = await import('../dal/follow-up-plans');
			const result = await advanceStep(
				'ws-1',
				'step-1',
				'Draft text',
				'casual_nudge',
				MOCK_ENVELOPE,
			);

			expect(result).toEqual(expect.objectContaining({ id: 'step-1' }));
		});

		it('completes plan when no more steps', async () => {
			// Current step update (last step)
			mockReturning.mockResolvedValueOnce([{ id: 'step-3', cadenceId: 'plan-1', stepNumber: 3 }]);
			// Next step query: none found
			mockLimit.mockResolvedValueOnce([]);

			const { advanceStep } = await import('../dal/follow-up-plans');
			const result = await advanceStep('ws-1', 'step-3', 'Final draft', undefined, MOCK_ENVELOPE);

			expect(result).toEqual(expect.objectContaining({ id: 'step-3' }));
		});
	});

	describe('listFollowUpPlans', () => {
		it('queries with workspace filter', async () => {
			mockLimit.mockResolvedValueOnce([{ id: 'plan-1' }]);

			const { listFollowUpPlans } = await import('../dal/follow-up-plans');
			const result = await listFollowUpPlans('ws-1', undefined, MOCK_ENVELOPE);

			expect(mockSelect).toHaveBeenCalled();
			expect(result).toHaveLength(1);
		});
	});
});
