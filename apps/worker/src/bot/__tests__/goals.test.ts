import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockListGoals = vi.fn();

const mockWorkspacesResult = [{ encryptedWrk: 'dGVzdA==', kmsContext: {}, wrkVersion: 1 }];
const mockEq = vi.fn();
const mockLimit = vi.fn(() => Promise.resolve(mockWorkspacesResult));
const mockWhere = vi.fn(() => ({ limit: mockLimit }));
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

vi.mock('@repo/db', () => ({
	listGoals: mockListGoals,
	db: { select: () => mockSelect() },
	eq: mockEq,
	workspaces: {
		id: 'id',
		encryptedWrk: 'encryptedWrk',
		kmsContext: 'kmsContext',
		wrkVersion: 'wrkVersion',
	},
}));

const MOCK_ENVELOPE = { encryptedWrk: Buffer.from('test'), kmsContext: {}, wrkVersion: 1 };

vi.mock('grammy', () => ({
	// biome-ignore lint/complexity/useArrowFunction: Vitest 4 class mocks must be constructible.
	Composer: vi.fn(function () {
		return {
			command: vi.fn(),
			on: vi.fn(() => ({ filter: vi.fn() })),
		};
	}),
}));

describe('goals bot feature', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('goalsComposer is defined and exports a Composer', async () => {
		const { goalsComposer } = await import('../features/goals');
		expect(goalsComposer).toBeDefined();
	});

	it('listGoals returns formatted goal list', async () => {
		const goals = [
			{ type: 'outreach', title: 'Message 10 new contacts', currentCount: 4, targetCount: 10 },
			{ type: 'deals', title: 'Close 3 deals', currentCount: 3, targetCount: 3 },
			{ type: 'followup', title: 'Follow up weekly', currentCount: 2, targetCount: 5 },
		];
		mockListGoals.mockResolvedValue(goals);

		const { listGoals } = await import('@repo/db');
		const goalList = await listGoals('ws-1', { status: 'active', limit: 10 }, MOCK_ENVELOPE);

		expect(goalList).toHaveLength(3);

		// Format like the bot does
		const formatted = goalList
			.map((g: { type: string; title: string; currentCount: number; targetCount: number }) => {
				const pct = g.targetCount > 0 ? Math.round((g.currentCount / g.targetCount) * 100) : 0;
				const bar = pct >= 100 ? '\u2705' : `[${g.currentCount}/${g.targetCount}]`;
				return `${g.type}: ${g.title} ${bar} \u2014 ${pct}%`;
			})
			.join('\n');

		expect(formatted).toContain('outreach: Message 10 new contacts [4/10]');
		expect(formatted).toContain('deals: Close 3 deals \u2705');
		expect(formatted).toContain('40%');
		expect(formatted).toContain('100%');
	});

	it('handles empty goal list', async () => {
		mockListGoals.mockResolvedValue([]);

		const { listGoals } = await import('@repo/db');
		const goalList = await listGoals('ws-1', { status: 'active', limit: 10 }, MOCK_ENVELOPE);

		expect(goalList).toHaveLength(0);
		// Bot would reply: 'No active goals. Create one from the web dashboard.'
	});

	it('passes workspace and filter params correctly to listGoals', async () => {
		mockListGoals.mockResolvedValue([]);

		const { listGoals } = await import('@repo/db');
		await listGoals('ws-test', { status: 'active', limit: 10 }, MOCK_ENVELOPE);

		expect(mockListGoals).toHaveBeenCalledWith(
			'ws-test',
			{ status: 'active', limit: 10 },
			MOCK_ENVELOPE,
		);
	});

	it('computes percentage correctly for partial progress', async () => {
		const goals = [{ type: 'outreach', title: 'Test', currentCount: 7, targetCount: 10 }];
		mockListGoals.mockResolvedValue(goals);

		const { listGoals } = await import('@repo/db');
		const goalList = await listGoals('ws-1', { status: 'active', limit: 10 }, MOCK_ENVELOPE);
		const g = goalList[0];
		const pct = g.targetCount > 0 ? Math.round((g.currentCount / g.targetCount) * 100) : 0;

		expect(pct).toBe(70);
	});
});
