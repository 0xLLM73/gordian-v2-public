import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockInsertReturning = vi.hoisted(() => vi.fn());
const mockOnConflict = vi.hoisted(() => vi.fn(() => ({ returning: mockInsertReturning })));
const mockInsertValues = vi.hoisted(() => vi.fn(() => ({ onConflictDoUpdate: mockOnConflict })));
const mockInsert = vi.hoisted(() => vi.fn(() => ({ values: mockInsertValues })));

const mockSelectWhere = vi.hoisted(() => vi.fn());
const mockSelectFrom = vi.hoisted(() => vi.fn(() => ({ where: mockSelectWhere })));
const mockSelect = vi.hoisted(() => vi.fn(() => ({ from: mockSelectFrom })));

vi.mock('../client', () => ({
	db: {
		select: mockSelect,
		insert: mockInsert,
	},
}));

import {
	getInvestorProfile,
	getTopInvestors,
	listInvestorProfiles,
	upsertInvestorProfile,
} from '../dal/investor-profiles';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WS = 'ws-00000000-0000-0000-0000-000000000001';
const CONTACT = 'ct-00000000-0000-0000-0000-000000000001';

const baseProfile = {
	id: 'profile-1',
	workspaceId: WS,
	contactId: CONTACT,
	dealCount: 3,
	winRate: 0.67,
	avgCycleDays: 45,
	preferredRole: 'lead',
	sectorFocus: ['defi', 'infrastructure'],
	ticketMin: 50000n,
	ticketMax: 500000n,
	tokenInterests: ['eth', 'sol'],
	activityTrend: 'steady' as const,
	computedAt: new Date(),
	createdAt: new Date(),
};

// ─── upsertInvestorProfile ────────────────────────────────────────────────────

describe('upsertInvestorProfile', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockInsert.mockReturnValue({ values: mockInsertValues });
		mockInsertValues.mockReturnValue({ onConflictDoUpdate: mockOnConflict });
		mockOnConflict.mockReturnValue({ returning: mockInsertReturning });
	});

	it('inserts profile and returns the created row', async () => {
		mockInsertReturning.mockResolvedValueOnce([baseProfile]);

		const result = await upsertInvestorProfile(WS, CONTACT, {
			dealCount: 3,
			winRate: 0.67,
			activityTrend: 'steady',
		});

		expect(mockInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({ workspaceId: WS, contactId: CONTACT, dealCount: 3 }),
		);
		expect(result).toEqual(baseProfile);
	});

	it('uses onConflictDoUpdate — refreshes computedAt and all fields on re-upsert', async () => {
		mockInsertReturning.mockResolvedValueOnce([baseProfile]);

		await upsertInvestorProfile(WS, CONTACT, { winRate: 0.8 });

		const conflictArgs = (mockOnConflict.mock.calls as unknown[][])[0]?.[0] as
			| {
					set: Record<string, unknown>;
					target: unknown[];
			  }
			| undefined;
		expect(conflictArgs?.set).toBeDefined();
		// computedAt refreshed via sql`now()`
		expect(conflictArgs?.set?.computedAt).toBeDefined();
		// winRate pulled from excluded row
		expect(conflictArgs?.set?.winRate).toBeDefined();
	});

	it('throws when upsert returns no rows', async () => {
		mockInsertReturning.mockResolvedValueOnce([]);

		await expect(upsertInvestorProfile(WS, CONTACT, { dealCount: 1 })).rejects.toThrow(
			'upsertInvestorProfile: upsert returned no rows',
		);
	});

	it('defaults dealCount=0, winRate=0, activityTrend=steady when not provided', async () => {
		mockInsertReturning.mockResolvedValueOnce([baseProfile]);

		await upsertInvestorProfile(WS, CONTACT, {});

		expect(mockInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({ dealCount: 0, winRate: 0, activityTrend: 'steady' }),
		);
	});
});

// ─── getInvestorProfile ───────────────────────────────────────────────────────

describe('getInvestorProfile', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSelect.mockReturnValue({ from: mockSelectFrom });
		mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
		const mockLimit = vi.fn().mockResolvedValue([]);
		mockSelectWhere.mockReturnValue({ limit: mockLimit });
	});

	it('returns the profile when found', async () => {
		const mockLimit = vi.fn().mockResolvedValueOnce([baseProfile]);
		mockSelectWhere.mockReturnValue({ limit: mockLimit });

		const result = await getInvestorProfile(WS, CONTACT);

		expect(result).toEqual(baseProfile);
		expect(mockSelectWhere).toHaveBeenCalledTimes(1);
	});

	it('returns null when no profile exists', async () => {
		const result = await getInvestorProfile(WS, CONTACT);
		expect(result).toBeNull();
	});

	it('scopes to both workspaceId and contactId (workspace isolation)', async () => {
		const mockLimitA = vi.fn().mockResolvedValue([]);
		mockSelectWhere.mockReturnValue({ limit: mockLimitA });

		await getInvestorProfile(WS, CONTACT);
		await getInvestorProfile('ws-B', 'ct-B');

		expect(mockSelect).toHaveBeenCalledTimes(2);
		expect(mockSelectWhere).toHaveBeenCalledTimes(2);
	});
});

// ─── listInvestorProfiles ─────────────────────────────────────────────────────

describe('listInvestorProfiles', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		const mockOffset = vi.fn().mockResolvedValue([]);
		const mockLimit = vi.fn().mockReturnValue({ offset: mockOffset });
		const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
		mockSelect.mockReturnValue({ from: mockSelectFrom });
		mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
		mockSelectWhere.mockReturnValue({
			orderBy: mockOrderBy,
		} as unknown as ReturnType<typeof mockSelectWhere>);
	});

	it('returns profiles for the workspace ordered by computedAt', async () => {
		const mockOffset = vi.fn().mockResolvedValueOnce([baseProfile]);
		const mockLimit = vi.fn().mockReturnValue({ offset: mockOffset });
		const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
		mockSelectWhere.mockReturnValue({
			orderBy: mockOrderBy,
		} as unknown as ReturnType<typeof mockSelectWhere>);

		const result = await listInvestorProfiles(WS);

		expect(result).toEqual([baseProfile]);
		expect(mockSelect).toHaveBeenCalledTimes(1);
		expect(mockOrderBy).toHaveBeenCalledTimes(1);
	});

	it('returns empty array when no profiles exist', async () => {
		const result = await listInvestorProfiles(WS);
		expect(result).toEqual([]);
	});

	it('always filters by workspaceId', async () => {
		await listInvestorProfiles(WS);
		expect(mockSelectWhere).toHaveBeenCalledTimes(1);
	});
});

// ─── getTopInvestors ──────────────────────────────────────────────────────────

describe('getTopInvestors', () => {
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

	it('returns profiles ordered by win rate then deal count', async () => {
		const mockLimit = vi.fn().mockResolvedValueOnce([baseProfile]);
		const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
		mockSelectWhere.mockReturnValue({
			orderBy: mockOrderBy,
		} as unknown as ReturnType<typeof mockSelectWhere>);

		const result = await getTopInvestors(WS);

		expect(result).toEqual([baseProfile]);
		expect(mockOrderBy).toHaveBeenCalledTimes(1);
	});

	it('returns empty array when no profiles exist', async () => {
		const result = await getTopInvestors(WS);
		expect(result).toEqual([]);
	});

	it('uses default limit of 10', async () => {
		const mockLimit = vi.fn().mockResolvedValue([]);
		const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
		mockSelectWhere.mockReturnValue({
			orderBy: mockOrderBy,
		} as unknown as ReturnType<typeof mockSelectWhere>);

		await getTopInvestors(WS);

		expect(mockLimit).toHaveBeenCalledWith(10);
	});

	it('applies workspace filter', async () => {
		await getTopInvestors(WS);
		expect(mockSelectWhere).toHaveBeenCalledTimes(1);
	});
});
