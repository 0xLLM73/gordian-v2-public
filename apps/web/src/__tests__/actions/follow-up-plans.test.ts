import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetForTesting as resetRateLimit } from '@/lib/rate-limit';

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
const STEP_ID = '550e8400-e29b-41d4-a716-446655440003';
const GOAL_ID = '550e8400-e29b-41d4-a716-446655440004';

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
const mockListTemplates = vi.fn(() =>
	Promise.resolve([
		{
			id: 'vc-followup',
			title: 'VC Follow-up',
			description: 'Post-meeting',
			version: 1,
			source: 'built_in',
			category: 'Investor',
			steps: [],
		},
	]),
);
const mockCreate = vi.fn(() =>
	Promise.resolve({ id: FOLLOW_UP_PLAN_ID, title: 'New Follow-up Plan', status: 'draft' }),
);
const mockCreateTemplate = vi.fn(() =>
	Promise.resolve({
		id: 'local-template-1',
		title: 'Local VC Follow-up',
		version: 1,
		source: 'user',
		steps: [{ prompt: 'Local prompt', delayHours: 24 }],
	}),
);
const mockCreateTemplateVersion = vi.fn(() =>
	Promise.resolve({
		id: 'local-template-1',
		title: 'Local VC Follow-up v2',
		version: 2,
		source: 'user',
		steps: [{ prompt: 'Updated local prompt', delayHours: 48 }],
	}),
);
const mockCreateTemplateFromPlan = vi.fn(() =>
	Promise.resolve({
		id: 'local-template-from-plan',
		title: 'Plan template',
		version: 1,
		source: 'user',
		steps: [{ prompt: 'Plan prompt', delayHours: 24 }],
	}),
);
const mockActivate = vi.fn(() => Promise.resolve({ id: FOLLOW_UP_PLAN_ID, status: 'active' }));
const mockPause = vi.fn(() => Promise.resolve({ id: FOLLOW_UP_PLAN_ID, status: 'paused' }));
const mockResume = vi.fn(() => Promise.resolve({ id: FOLLOW_UP_PLAN_ID, status: 'active' }));
const mockCancel = vi.fn(() => Promise.resolve({ id: FOLLOW_UP_PLAN_ID, status: 'cancelled' }));
const mockApproveStep = vi.fn(() => Promise.resolve({ id: STEP_ID, status: 'sent' }));
const mockEditAndApproveStep = vi.fn(() => Promise.resolve({ id: STEP_ID, status: 'sent' }));
const mockRejectStep = vi.fn(() => Promise.resolve({ id: STEP_ID, status: 'skipped' }));
const mockRescheduleStep = vi.fn(() =>
	Promise.resolve({
		id: STEP_ID,
		status: 'ready',
		scheduledAt: new Date('2026-06-10T12:00:00Z'),
	}),
);
const mockRegenerateStep = vi.fn(() => Promise.resolve({ id: STEP_ID, status: 'ready' }));
const mockRecordStepCopied = vi.fn(() =>
	Promise.resolve({ followUpPlanId: FOLLOW_UP_PLAN_ID, stepId: STEP_ID, status: 'copied' }),
);
const mockRecordTelegramOpened = vi.fn(() =>
	Promise.resolve({
		followUpPlanId: FOLLOW_UP_PLAN_ID,
		stepId: STEP_ID,
		status: 'telegram_opened',
	}),
);

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	listFollowUpPlans: mockList,
	getFollowUpPlan: mockGet,
	getFollowUpPlanSteps: mockGetSteps,
	listFollowUpPlanTemplates: mockListTemplates,
	createFollowUpPlan: mockCreate,
	createFollowUpPlanTemplate: mockCreateTemplate,
	createFollowUpPlanTemplateVersion: mockCreateTemplateVersion,
	createFollowUpPlanTemplateFromPlan: mockCreateTemplateFromPlan,
	activateFollowUpPlan: mockActivate,
	pauseFollowUpPlan: mockPause,
	resumeFollowUpPlan: mockResume,
	cancelFollowUpPlan: mockCancel,
	approveStep: mockApproveStep,
	editAndApproveStep: mockEditAndApproveStep,
	rejectStep: mockRejectStep,
	rescheduleFollowUpPlanStep: mockRescheduleStep,
	requestFollowUpPlanStepRegeneration: mockRegenerateStep,
	recordFollowUpPlanStepCopied: mockRecordStepCopied,
	recordFollowUpPlanTelegramOpened: mockRecordTelegramOpened,
}));

describe('follow-up plan actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetRateLimit();
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
			templateId: 'vc-followup',
			templateVersion: 1,
			templateSource: 'built_in',
			steps: [{ prompt: 'Follow up', delayHours: 24 }],
		});
		expect(result?.data).toBeDefined();
		expect(mockCreate).toHaveBeenCalledWith(
			WORKSPACE_ID,
			expect.objectContaining({
				contactId: CONTACT_ID,
				title: 'New Follow-up Plan',
				templateId: 'vc-followup',
				templateVersion: 1,
				templateSource: 'built_in',
				steps: [{ prompt: 'Follow up', delayHours: 24 }],
			}),
			expect.objectContaining({ wrkVersion: 1 }),
		);
	});

	it('createFollowUpPlanAction forwards local/manual configuration', async () => {
		const { createFollowUpPlanAction } = await import('@/app/actions/follow-up-plans');
		await createFollowUpPlanAction({
			contactId: CONTACT_ID,
			title: 'Manual VC follow-up',
			config: {
				objective: 'Schedule a second meeting',
				tone: 'Warm',
				channel: 'Telegram',
				aiMode: 'local_ai',
				sendingMode: 'manual',
				sourceGoalId: GOAL_ID,
			},
			steps: [{ prompt: 'Follow up', delayHours: 24 }],
		});

		expect(mockCreate).toHaveBeenCalledWith(
			WORKSPACE_ID,
			expect.objectContaining({
				objective: 'Schedule a second meeting',
				config: expect.objectContaining({
					aiMode: 'local_ai',
					sendingMode: 'manual',
					sourceGoalId: GOAL_ID,
				}),
			}),
			expect.objectContaining({ wrkVersion: 1 }),
		);
		const createCalls = mockCreate.mock.calls as unknown as Array<
			[string, { config: Record<string, unknown> }, unknown]
		>;
		expect(createCalls[0]?.[1].config).not.toEqual(
			expect.objectContaining({ objective: 'Schedule a second meeting' }),
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
		expect(mockListTemplates).toHaveBeenCalledWith(
			WORKSPACE_ID,
			expect.objectContaining({ wrkVersion: 1 }),
		);
	});

	it('createFollowUpPlanTemplateAction creates a workspace-scoped local template copy', async () => {
		const { createFollowUpPlanTemplateAction } = await import('@/app/actions/follow-up-plans');
		const result = await createFollowUpPlanTemplateAction({
			title: 'Local VC Follow-up',
			description: 'Personal investor sequence',
			category: 'Investor',
			steps: [{ prompt: 'Local prompt', delayHours: 24 }],
		});

		expect(result?.data).toBeDefined();
		expect(mockCreateTemplate).toHaveBeenCalledWith(
			WORKSPACE_ID,
			expect.objectContaining({
				title: 'Local VC Follow-up',
				description: 'Personal investor sequence',
				category: 'Investor',
				steps: [{ prompt: 'Local prompt', delayHours: 24 }],
			}),
			expect.objectContaining({ wrkVersion: 1 }),
		);
	});

	it('createFollowUpPlanTemplateVersionAction creates a new workspace-scoped local template version', async () => {
		const { createFollowUpPlanTemplateVersionAction } = await import(
			'@/app/actions/follow-up-plans'
		);
		const result = await createFollowUpPlanTemplateVersionAction({
			templateId: 'local-template-1',
			title: 'Local VC Follow-up v2',
			description: 'Personal investor sequence',
			category: 'Investor',
			steps: [{ prompt: 'Updated local prompt', delayHours: 48 }],
		});

		expect(result?.data).toBeDefined();
		expect(mockCreateTemplateVersion).toHaveBeenCalledWith(
			WORKSPACE_ID,
			'local-template-1',
			expect.objectContaining({
				title: 'Local VC Follow-up v2',
				description: 'Personal investor sequence',
				category: 'Investor',
				steps: [{ prompt: 'Updated local prompt', delayHours: 48 }],
			}),
			expect.objectContaining({ wrkVersion: 1 }),
		);
	});

	it('createFollowUpPlanTemplateFromPlanAction duplicates a plan into a local template', async () => {
		const { createFollowUpPlanTemplateFromPlanAction } = await import(
			'@/app/actions/follow-up-plans'
		);
		const result = await createFollowUpPlanTemplateFromPlanAction({
			followUpPlanId: FOLLOW_UP_PLAN_ID,
			title: 'Plan template',
			category: 'Investor',
		});

		expect(result?.data).toBeDefined();
		expect(mockCreateTemplateFromPlan).toHaveBeenCalledWith(
			WORKSPACE_ID,
			FOLLOW_UP_PLAN_ID,
			expect.objectContaining({
				title: 'Plan template',
				category: 'Investor',
			}),
			expect.objectContaining({ wrkVersion: 1 }),
		);
	});

	it('approveFollowUpPlanStepAction scopes review mutation to the plan', async () => {
		const { approveFollowUpPlanStepAction } = await import('@/app/actions/follow-up-plans');
		const result = await approveFollowUpPlanStepAction({
			followUpPlanId: FOLLOW_UP_PLAN_ID,
			stepId: STEP_ID,
		});
		expect(result?.data).toBeDefined();
		expect(mockApproveStep).toHaveBeenCalledWith(
			WORKSPACE_ID,
			FOLLOW_UP_PLAN_ID,
			STEP_ID,
			expect.objectContaining({ wrkVersion: 1 }),
		);
	});

	it('editAndApproveFollowUpPlanStepAction scopes edited manual send to the plan', async () => {
		const { editAndApproveFollowUpPlanStepAction } = await import('@/app/actions/follow-up-plans');
		const result = await editAndApproveFollowUpPlanStepAction({
			followUpPlanId: FOLLOW_UP_PLAN_ID,
			stepId: STEP_ID,
			editedText: 'Edited draft',
		});
		expect(result?.data).toBeDefined();
		expect(mockEditAndApproveStep).toHaveBeenCalledWith(
			WORKSPACE_ID,
			FOLLOW_UP_PLAN_ID,
			STEP_ID,
			'Edited draft',
			expect.objectContaining({ wrkVersion: 1 }),
		);
	});

	it('rejectFollowUpPlanStepAction scopes skipped review draft to the plan', async () => {
		const { rejectFollowUpPlanStepAction } = await import('@/app/actions/follow-up-plans');
		const result = await rejectFollowUpPlanStepAction({
			followUpPlanId: FOLLOW_UP_PLAN_ID,
			stepId: STEP_ID,
		});
		expect(result?.data).toBeDefined();
		expect(mockRejectStep).toHaveBeenCalledWith(
			WORKSPACE_ID,
			FOLLOW_UP_PLAN_ID,
			STEP_ID,
			expect.objectContaining({ wrkVersion: 1 }),
		);
	});

	it('rejectFollowUpPlanStepAction forwards a skip reason when provided', async () => {
		const { rejectFollowUpPlanStepAction } = await import('@/app/actions/follow-up-plans');
		await rejectFollowUpPlanStepAction({
			followUpPlanId: FOLLOW_UP_PLAN_ID,
			stepId: STEP_ID,
			skipReason: 'Already handled directly',
		});
		expect(mockRejectStep).toHaveBeenCalledWith(
			WORKSPACE_ID,
			FOLLOW_UP_PLAN_ID,
			STEP_ID,
			expect.objectContaining({ wrkVersion: 1 }),
			'Already handled directly',
		);
	});

	it('rescheduleFollowUpPlanStepAction scopes timing changes to the plan and step', async () => {
		const { rescheduleFollowUpPlanStepAction } = await import('@/app/actions/follow-up-plans');
		const result = await rescheduleFollowUpPlanStepAction({
			followUpPlanId: FOLLOW_UP_PLAN_ID,
			stepId: STEP_ID,
			scheduledAt: '2026-06-10T12:00:00.000Z',
			reason: 'Need fresh context tomorrow',
		});

		expect(result?.data).toBeDefined();
		expect(mockRescheduleStep).toHaveBeenCalledWith(
			WORKSPACE_ID,
			FOLLOW_UP_PLAN_ID,
			STEP_ID,
			expect.objectContaining({
				scheduledAt: expect.any(Date),
				reason: 'Need fresh context tomorrow',
			}),
		);
		const rescheduleCalls = mockRescheduleStep.mock.calls as unknown as Array<
			[string, string, string, { scheduledAt: Date; reason?: string }]
		>;
		expect(rescheduleCalls[0]?.[3].scheduledAt.toISOString()).toBe('2026-06-10T12:00:00.000Z');
		expect(mockApproveStep).not.toHaveBeenCalled();
	});

	it('regenerateFollowUpPlanStepAction queues a fresh local draft without manual send', async () => {
		const { regenerateFollowUpPlanStepAction } = await import('@/app/actions/follow-up-plans');
		const result = await regenerateFollowUpPlanStepAction({
			followUpPlanId: FOLLOW_UP_PLAN_ID,
			stepId: STEP_ID,
		});

		expect(result?.data).toEqual(expect.objectContaining({ id: STEP_ID, status: 'ready' }));
		expect(mockRegenerateStep).toHaveBeenCalledWith(WORKSPACE_ID, FOLLOW_UP_PLAN_ID, STEP_ID);
		expect(mockApproveStep).not.toHaveBeenCalled();
	});

	it('recordFollowUpPlanStepCopyAction records copy without an envelope mutation', async () => {
		const { recordFollowUpPlanStepCopyAction } = await import('@/app/actions/follow-up-plans');
		const result = await recordFollowUpPlanStepCopyAction({
			followUpPlanId: FOLLOW_UP_PLAN_ID,
			stepId: STEP_ID,
		});
		expect(result?.data).toEqual(
			expect.objectContaining({
				followUpPlanId: FOLLOW_UP_PLAN_ID,
				stepId: STEP_ID,
				status: 'copied',
			}),
		);
		expect(mockRecordStepCopied).toHaveBeenCalledWith(WORKSPACE_ID, FOLLOW_UP_PLAN_ID, STEP_ID);
	});

	it('recordFollowUpPlanTelegramOpenAction records open without advancing the step', async () => {
		const { recordFollowUpPlanTelegramOpenAction } = await import('@/app/actions/follow-up-plans');
		const result = await recordFollowUpPlanTelegramOpenAction({
			followUpPlanId: FOLLOW_UP_PLAN_ID,
			stepId: STEP_ID,
		});
		expect(result?.data).toEqual(
			expect.objectContaining({
				followUpPlanId: FOLLOW_UP_PLAN_ID,
				stepId: STEP_ID,
				status: 'telegram_opened',
			}),
		);
		expect(mockRecordTelegramOpened).toHaveBeenCalledWith(WORKSPACE_ID, FOLLOW_UP_PLAN_ID, STEP_ID);
	});
});
