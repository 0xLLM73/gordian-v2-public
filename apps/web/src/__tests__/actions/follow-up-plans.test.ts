import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
	headers: vi.fn(() => Promise.resolve(new Headers())),
}));

vi.mock('@/lib/auth', () => ({
	auth: {
		api: {
			getSession: vi.fn(() =>
				Promise.resolve({
					user: { id: 'user-1', email: 'test@test.com', name: 'Test' },
					session: { id: 'session-1' },
				}),
			),
		},
	},
}));

const WORKSPACE_ID = '550e8400-e29b-41d4-a716-446655440000';
const CONTACT_ID = '550e8400-e29b-41d4-a716-446655440001';
const FOLLOW_UP_PLAN_ID = '550e8400-e29b-41d4-a716-446655440002';

vi.mock('@/lib/workspace', () => ({
	getUserWorkspaceId: vi.fn(() => Promise.resolve(WORKSPACE_ID)),
	getWorkspaceEnvelope: vi.fn(() =>
		Promise.resolve({
			encryptedWrk: Buffer.from('mock'),
			kmsContext: { WorkspaceID: 'mock' },
			wrkVersion: 1,
		}),
	),
}));

const mockList = vi.fn(() =>
	Promise.resolve([{ id: FOLLOW_UP_PLAN_ID, title: 'VC Follow-up', status: 'active' }]),
);
const mockGet = vi.fn(() =>
	Promise.resolve({ id: FOLLOW_UP_PLAN_ID, title: 'VC Follow-up', status: 'active' }),
);
const mockGetSteps = vi.fn(() =>
	Promise.resolve([{ id: 'step-1', stepNumber: 1, prompt: 'Follow up' }]),
);
const mockCreate = vi.fn(() =>
	Promise.resolve({ id: FOLLOW_UP_PLAN_ID, title: 'New Follow-up Plan', status: 'draft' }),
);
const mockActivate = vi.fn(() => Promise.resolve({ id: FOLLOW_UP_PLAN_ID, status: 'active' }));
const mockPause = vi.fn(() => Promise.resolve({ id: FOLLOW_UP_PLAN_ID, status: 'paused' }));
const mockResume = vi.fn(() => Promise.resolve({ id: FOLLOW_UP_PLAN_ID, status: 'active' }));
const mockCancel = vi.fn(() => Promise.resolve({ id: FOLLOW_UP_PLAN_ID, status: 'cancelled' }));

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	listFollowUpPlans: mockList,
	getFollowUpPlan: mockGet,
	getFollowUpPlanSteps: mockGetSteps,
	createFollowUpPlan: mockCreate,
	activateFollowUpPlan: mockActivate,
	pauseFollowUpPlan: mockPause,
	resumeFollowUpPlan: mockResume,
	cancelFollowUpPlan: mockCancel,
	FOLLOW_UP_PLAN_TEMPLATES: [
		{ id: 'vc-followup', title: 'VC Follow-up', description: 'Post-meeting', steps: [] },
	],
}));

describe('follow-up plan actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('listFollowUpPlansAction returns plans', async () => {
		const { listFollowUpPlansAction } = await import('@/app/actions/follow-up-plans');
		const result = await listFollowUpPlansAction({});
		expect(result?.data).toBeDefined();
		expect(mockList).toHaveBeenCalledWith(
			WORKSPACE_ID,
			{ status: undefined, contactId: undefined, limit: undefined },
			expect.objectContaining({ wrkVersion: 1 }),
		);
	});

	it('listFollowUpPlansAction accepts status filter', async () => {
		const { listFollowUpPlansAction } = await import('@/app/actions/follow-up-plans');
		await listFollowUpPlansAction({ status: 'active' });
		expect(mockList).toHaveBeenCalledWith(
			WORKSPACE_ID,
			expect.objectContaining({ status: 'active' }),
			expect.objectContaining({ wrkVersion: 1 }),
		);
	});

	it('getFollowUpPlanAction returns a plan', async () => {
		const { getFollowUpPlanAction } = await import('@/app/actions/follow-up-plans');
		const result = await getFollowUpPlanAction({ followUpPlanId: FOLLOW_UP_PLAN_ID });
		expect(result?.data).toBeDefined();
		expect(mockGet).toHaveBeenCalledWith(
			WORKSPACE_ID,
			FOLLOW_UP_PLAN_ID,
			expect.objectContaining({ wrkVersion: 1 }),
		);
	});

	it('createFollowUpPlanAction creates with schema validation', async () => {
		const { createFollowUpPlanAction } = await import('@/app/actions/follow-up-plans');
		const result = await createFollowUpPlanAction({
			contactId: CONTACT_ID,
			title: 'New Follow-up Plan',
			steps: [{ prompt: 'Follow up', delayHours: 24 }],
		});
		expect(result?.data).toBeDefined();
		expect(mockCreate).toHaveBeenCalledWith(
			WORKSPACE_ID,
			expect.objectContaining({
				contactId: CONTACT_ID,
				title: 'New Follow-up Plan',
				steps: [{ prompt: 'Follow up', delayHours: 24 }],
			}),
			expect.objectContaining({ wrkVersion: 1 }),
		);
	});

	it('createFollowUpPlanAction rejects empty title', async () => {
		const { createFollowUpPlanAction } = await import('@/app/actions/follow-up-plans');
		const result = await createFollowUpPlanAction({
			contactId: CONTACT_ID,
			title: '',
			steps: [{ prompt: 'Hello', delayHours: 0 }],
		});
		expect(result?.validationErrors).toBeDefined();
	});

	it('activateFollowUpPlanAction activates plan', async () => {
		const { activateFollowUpPlanAction } = await import('@/app/actions/follow-up-plans');
		const result = await activateFollowUpPlanAction({ followUpPlanId: FOLLOW_UP_PLAN_ID });
		expect(result?.data).toBeDefined();
		expect(mockActivate).toHaveBeenCalledWith(WORKSPACE_ID, FOLLOW_UP_PLAN_ID);
	});

	it('pauseFollowUpPlanAction pauses plan', async () => {
		const { pauseFollowUpPlanAction } = await import('@/app/actions/follow-up-plans');
		const result = await pauseFollowUpPlanAction({ followUpPlanId: FOLLOW_UP_PLAN_ID });
		expect(result?.data).toBeDefined();
		expect(mockPause).toHaveBeenCalledWith(WORKSPACE_ID, FOLLOW_UP_PLAN_ID);
	});

	it('resumeFollowUpPlanAction resumes plan', async () => {
		const { resumeFollowUpPlanAction } = await import('@/app/actions/follow-up-plans');
		const result = await resumeFollowUpPlanAction({ followUpPlanId: FOLLOW_UP_PLAN_ID });
		expect(result?.data).toBeDefined();
		expect(mockResume).toHaveBeenCalledWith(WORKSPACE_ID, FOLLOW_UP_PLAN_ID);
	});

	it('cancelFollowUpPlanAction cancels plan', async () => {
		const { cancelFollowUpPlanAction } = await import('@/app/actions/follow-up-plans');
		const result = await cancelFollowUpPlanAction({ followUpPlanId: FOLLOW_UP_PLAN_ID });
		expect(result?.data).toBeDefined();
		expect(mockCancel).toHaveBeenCalledWith(WORKSPACE_ID, FOLLOW_UP_PLAN_ID);
	});

	it('getFollowUpPlanTemplatesAction returns templates', async () => {
		const { getFollowUpPlanTemplatesAction } = await import('@/app/actions/follow-up-plans');
		const result = await getFollowUpPlanTemplatesAction({});
		expect(result?.data).toBeDefined();
		expect(result?.data).toHaveLength(1);
	});
});
