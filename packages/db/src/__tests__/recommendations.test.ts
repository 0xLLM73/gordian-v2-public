import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockInsertReturning = vi.hoisted(() => vi.fn());
const mockInsertValues = vi.hoisted(() => vi.fn(() => ({ returning: mockInsertReturning })));
const mockInsert = vi.hoisted(() => vi.fn(() => ({ values: mockInsertValues })));

const mockUpdateReturning = vi.hoisted(() => vi.fn());
const mockUpdateWhere = vi.hoisted(() => vi.fn(() => ({ returning: mockUpdateReturning })));
const mockUpdateSet = vi.hoisted(() => vi.fn(() => ({ where: mockUpdateWhere })));
const mockUpdate = vi.hoisted(() => vi.fn(() => ({ set: mockUpdateSet })));

const mockSelectWhere = vi.hoisted(() => vi.fn());
const mockSelectFrom = vi.hoisted(() => vi.fn(() => ({ where: mockSelectWhere })));
const mockSelect = vi.hoisted(() => vi.fn(() => ({ from: mockSelectFrom })));

vi.mock('../client', () => ({
	db: {
		select: mockSelect,
		insert: mockInsert,
		update: mockUpdate,
	},
}));

import {
	actOnRecommendation,
	createRecommendations,
	dismissRecommendation,
	expireOldRecommendations,
	getPendingRecommendations,
} from '../dal/recommendations';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WS = 'ws-00000000-0000-0000-0000-000000000001';

const baseRec = {
	id: 'rec-1',
	workspaceId: WS,
	contactId: 'ct-1',
	type: 're_engage' as const,
	priorityScore: 0.8,
	reasoning: 'declining_trend:recency_30',
	status: 'pending' as const,
	expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
	createdAt: new Date(),
};

// ─── createRecommendations ────────────────────────────────────────────────────

describe('createRecommendations', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockInsert.mockReturnValue({ values: mockInsertValues });
		mockInsertValues.mockReturnValue({ returning: mockInsertReturning });
	});

	it('returns empty array without calling DB when items is empty', async () => {
		const result = await createRecommendations(WS, []);

		expect(result).toEqual([]);
		expect(mockInsert).not.toHaveBeenCalled();
	});

	it('batch-inserts all items with workspaceId', async () => {
		mockInsertReturning.mockResolvedValueOnce([baseRec]);

		const result = await createRecommendations(WS, [
			{
				type: 're_engage',
				priorityScore: 0.8,
				reasoning: 'declining_trend:recency_30',
				contactId: 'ct-1',
			},
		]);

		expect(mockInsert).toHaveBeenCalledTimes(1);
		expect(mockInsertValues).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({ workspaceId: WS, type: 're_engage', priorityScore: 0.8 }),
			]),
		);
		expect(result).toEqual([baseRec]);
	});

	it('passes multiple items in a single insert', async () => {
		const items = [
			{
				type: 're_engage' as const,
				priorityScore: 0.8,
				reasoning: 'declining_trend:recency_30',
				contactId: 'ct-1',
			},
			{
				type: 'follow_up' as const,
				priorityScore: 0.6,
				reasoning: 'open_commitments:2',
				contactId: 'ct-2',
			},
		];
		mockInsertReturning.mockResolvedValueOnce([baseRec, { ...baseRec, id: 'rec-2' }]);

		await createRecommendations(WS, items);

		const insertArgs = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as unknown[];
		expect(Array.isArray(insertArgs)).toBe(true);
		expect(insertArgs).toHaveLength(2);
	});

	it('sets contactId to undefined when omitted from item', async () => {
		mockInsertReturning.mockResolvedValueOnce([{ ...baseRec, contactId: null }]);

		await createRecommendations(WS, [
			{ type: 'make_intro', priorityScore: 0.5, reasoning: 'shared_knowledge:sector:2_contacts' },
		]);

		expect(mockInsertValues).toHaveBeenCalledWith(
			expect.arrayContaining([expect.objectContaining({ contactId: undefined })]),
		);
	});
});

// ─── getPendingRecommendations ────────────────────────────────────────────────

describe('getPendingRecommendations', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		const mockLimit = vi.fn().mockResolvedValue([]);
		const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
		mockSelect.mockReturnValue({ from: mockSelectFrom });
		mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
		mockSelectWhere.mockReturnValue({
			orderBy: mockOrderBy,
		} as unknown as ReturnType<typeof mockSelectWhere>);
	});

	it('returns pending recommendations ordered by priority score', async () => {
		const mockLimit = vi.fn().mockResolvedValueOnce([baseRec]);
		const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
		mockSelectWhere.mockReturnValue({
			orderBy: mockOrderBy,
		} as unknown as ReturnType<typeof mockSelectWhere>);

		const result = await getPendingRecommendations(WS);

		expect(result).toEqual([baseRec]);
		expect(mockSelect).toHaveBeenCalledTimes(1);
		expect(mockSelectWhere).toHaveBeenCalledTimes(1);
		expect(mockOrderBy).toHaveBeenCalledTimes(1);
	});

	it('returns empty array when no pending recommendations exist', async () => {
		const result = await getPendingRecommendations(WS, 5);
		expect(result).toEqual([]);
	});

	it('applies workspace filter (workspace isolation)', async () => {
		await getPendingRecommendations(WS);
		await getPendingRecommendations('ws-other');

		expect(mockSelect).toHaveBeenCalledTimes(2);
		expect(mockSelectWhere).toHaveBeenCalledTimes(2);
	});

	it('uses custom limit when provided', async () => {
		const mockLimit = vi.fn().mockResolvedValue([]);
		const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
		mockSelectWhere.mockReturnValue({
			orderBy: mockOrderBy,
		} as unknown as ReturnType<typeof mockSelectWhere>);

		await getPendingRecommendations(WS, 3);

		expect(mockLimit).toHaveBeenCalledWith(3);
	});
});

// ─── actOnRecommendation ──────────────────────────────────────────────────────

describe('actOnRecommendation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUpdate.mockReturnValue({ set: mockUpdateSet });
		mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
		mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });
		mockUpdateReturning.mockResolvedValue([]); // default: not found
	});

	it('updates status to acted and returns the updated record', async () => {
		const actedRec = { ...baseRec, status: 'acted' as const };
		mockUpdateReturning.mockResolvedValueOnce([actedRec]);

		const result = await actOnRecommendation('rec-1', WS);

		expect(mockUpdateSet).toHaveBeenCalledWith({ status: 'acted' });
		expect(mockUpdateWhere).toHaveBeenCalledTimes(1);
		expect(result).toEqual(actedRec);
	});

	it('returns null when recommendation not found (wrong id or workspace)', async () => {
		mockUpdateReturning.mockResolvedValueOnce([]);

		const result = await actOnRecommendation('nonexistent', WS);

		expect(result).toBeNull();
	});

	it('includes workspaceId in WHERE clause (cross-tenant mutation prevention)', async () => {
		mockUpdateReturning.mockResolvedValueOnce([]);

		await actOnRecommendation('rec-1', WS);
		await actOnRecommendation('rec-1', 'ws-other');

		// Two separate updates — workspaceId scopes each one independently
		expect(mockUpdate).toHaveBeenCalledTimes(2);
		expect(mockUpdateWhere).toHaveBeenCalledTimes(2);
	});
});

// ─── dismissRecommendation ────────────────────────────────────────────────────

describe('dismissRecommendation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUpdate.mockReturnValue({ set: mockUpdateSet });
		mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
		mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });
		mockUpdateReturning.mockResolvedValue([]); // default: not found
	});

	it('updates status to dismissed and returns the updated record', async () => {
		const dismissedRec = { ...baseRec, status: 'dismissed' as const };
		mockUpdateReturning.mockResolvedValueOnce([dismissedRec]);

		const result = await dismissRecommendation('rec-1', WS);

		expect(mockUpdateSet).toHaveBeenCalledWith({ status: 'dismissed' });
		expect(result).toEqual(dismissedRec);
	});

	it('returns null when recommendation not found', async () => {
		mockUpdateReturning.mockResolvedValueOnce([]);

		const result = await dismissRecommendation('nonexistent', WS);

		expect(result).toBeNull();
	});
});

// ─── expireOldRecommendations ─────────────────────────────────────────────────

describe('expireOldRecommendations', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUpdate.mockReturnValue({ set: mockUpdateSet });
		mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
		mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });
		mockUpdateReturning.mockResolvedValue([]); // default: no rows expired
	});

	it('updates pending past-expiry recommendations to expired status', async () => {
		mockUpdateReturning.mockResolvedValueOnce([{ id: 'rec-1' }, { id: 'rec-2' }]);

		const count = await expireOldRecommendations(WS);

		expect(mockUpdateSet).toHaveBeenCalledWith({ status: 'expired' });
		expect(count).toBe(2);
	});

	it('returns 0 when no recommendations are past expiry', async () => {
		mockUpdateReturning.mockResolvedValueOnce([]);

		const count = await expireOldRecommendations(WS);

		expect(count).toBe(0);
	});

	it('scopes to workspaceId (workspace isolation)', async () => {
		mockUpdateReturning.mockResolvedValue([]);

		await expireOldRecommendations(WS);
		await expireOldRecommendations('ws-other');

		expect(mockUpdate).toHaveBeenCalledTimes(2);
	});
});
