import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockListFollowUpPlans = vi.fn();
const mockGetFollowUpPlanSteps = vi.fn(
	(): Promise<Array<{ id: string; status: string }>> => Promise.resolve([]),
);

const mockWorkspacesResult = [{ encryptedWrk: 'dGVzdA==', kmsContext: {}, wrkVersion: 1 }];
const mockEq = vi.fn();
const mockLimit = vi.fn(() => Promise.resolve(mockWorkspacesResult));
const mockWhere = vi.fn(() => ({ limit: mockLimit }));
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockDbSelect = vi.fn(() => ({ from: mockFrom }));

vi.mock('@repo/db', () => ({
	listFollowUpPlans: mockListFollowUpPlans,
	getFollowUpPlanSteps: mockGetFollowUpPlanSteps,
	db: { select: () => mockDbSelect() },
	eq: mockEq,
	workspaces: {
		id: 'id',
		encryptedWrk: 'encryptedWrk',
		kmsContext: 'kmsContext',
		wrkVersion: 'wrkVersion',
	},
}));

vi.mock('grammy', () => {
	const handlers = new Map<string, (ctx: unknown) => Promise<void>>();
	return {
		// biome-ignore lint/complexity/useArrowFunction: Vitest 4 class mocks must be constructible.
		Composer: vi.fn().mockImplementation(function () {
			return {
				command: vi.fn((name: string, handler: (ctx: unknown) => Promise<void>) => {
					handlers.set(name, handler);
				}),
				_handlers: handlers,
			};
		}),
	};
});

describe('follow-up plans bot command', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetFollowUpPlanSteps.mockResolvedValue([]);
	});

	async function getHandler() {
		const mod = await import('../../bot/features/follow-up-plans');
		const composer = mod.followUpPlansComposer as unknown as {
			_handlers: Map<string, (ctx: unknown) => Promise<void>>;
		};
		return composer._handlers.get('followups');
	}

	function makeCtx(workspaceId?: string) {
		return {
			session: { data: workspaceId ? { workspaceId } : undefined },
			reply: vi.fn(),
		};
	}

	it('asks to link account when no workspaceId', async () => {
		const handler = await getHandler();
		const ctx = makeCtx();
		await handler!(ctx);
		expect(ctx.reply).toHaveBeenCalledWith('Please link your account first via the web app.');
	});

	it('shows empty message when no follow-up plans', async () => {
		mockListFollowUpPlans.mockResolvedValue([]);
		const handler = await getHandler();
		const ctx = makeCtx('ws-1');
		await handler!(ctx);
		expect(ctx.reply).toHaveBeenCalledWith(
			'No follow-up plans running. Create one from the web dashboard.',
		);
	});

	it('lists active follow-up plans with progress', async () => {
		mockListFollowUpPlans.mockImplementation((_ws: string, opts: { status: string }) => {
			if (opts.status === 'active') {
				return Promise.resolve([
					{ id: 'plan-1', title: 'VC Follow-up', completedSteps: 2, totalSteps: 4 },
					{ id: 'plan-2', title: 'Deal Nurture', completedSteps: 0, totalSteps: 3 },
				]);
			}
			return Promise.resolve([]);
		});

		const handler = await getHandler();
		const ctx = makeCtx('ws-1');
		await handler!(ctx);

		const reply = ctx.reply.mock.calls[0][0] as string;
		expect(reply).toContain('Active follow-up plans:');
		expect(reply).toContain('VC Follow-up — step 2/4');
		expect(reply).toContain('Deal Nurture — step 0/3');
		expect(reply).toContain('Drafts are generated locally and are not sent automatically.');
	});

	it('surfaces pending local drafts before general active plans', async () => {
		mockListFollowUpPlans.mockImplementation((_ws: string, opts: { status: string }) => {
			if (opts.status === 'active') {
				return Promise.resolve([
					{ id: 'plan-1', title: 'VC Follow-up', completedSteps: 1, totalSteps: 4 },
				]);
			}
			return Promise.resolve([]);
		});
		mockGetFollowUpPlanSteps.mockResolvedValue([
			{ id: 'step-1', status: 'pending_review' },
			{ id: 'step-2', status: 'pending_review' },
			{ id: 'step-3', status: 'pending' },
		]);

		const handler = await getHandler();
		const ctx = makeCtx('ws-1');
		await handler!(ctx);

		const reply = ctx.reply.mock.calls[0][0] as string;
		expect(reply.startsWith('Needs review:')).toBe(true);
		expect(reply).toContain('VC Follow-up — 2 local drafts waiting');
		expect(reply).toContain('VC Follow-up — step 1/4, 2 needs review');
	});

	it('lists both active and paused follow-up plans', async () => {
		mockListFollowUpPlans.mockImplementation((_ws: string, opts: { status: string }) => {
			if (opts.status === 'active') {
				return Promise.resolve([
					{ id: 'plan-1', title: 'VC Follow-up', completedSteps: 1, totalSteps: 4 },
				]);
			}
			if (opts.status === 'paused') {
				return Promise.resolve([
					{ id: 'plan-2', title: 'Re-engage', completedSteps: 1, totalSteps: 3 },
				]);
			}
			return Promise.resolve([]);
		});

		const handler = await getHandler();
		const ctx = makeCtx('ws-1');
		await handler!(ctx);

		const reply = ctx.reply.mock.calls[0][0] as string;
		expect(reply).toContain('Active follow-up plans:');
		expect(reply).toContain('VC Follow-up');
		expect(reply).toContain('Paused follow-up plans:');
		expect(reply).toContain('Re-engage');
		expect(reply).toContain('(paused)');
	});

	it('lists draft follow-up plans as not active yet', async () => {
		mockListFollowUpPlans.mockImplementation((_ws: string, opts: { status: string }) => {
			if (opts.status === 'draft') {
				return Promise.resolve([
					{ id: 'plan-1', title: 'Draft VC Plan', completedSteps: 0, totalSteps: 4 },
				]);
			}
			return Promise.resolve([]);
		});

		const handler = await getHandler();
		const ctx = makeCtx('ws-1');
		await handler!(ctx);

		const reply = ctx.reply.mock.calls[0][0] as string;
		expect(reply).toContain('Draft follow-up plans:');
		expect(reply).toContain('Draft VC Plan — not active yet');
		expect(reply).toContain('Drafts are generated locally and are not sent automatically.');
	});
});
