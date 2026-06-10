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
const mockOnConflictDoNothing = vi.fn<any>(() => undefined);
const mockValues = vi.fn<any>(() => ({
	returning: mockReturning,
	onConflictDoNothing: mockOnConflictDoNothing,
}));
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
	mockValues.mockReturnValue({
		returning: mockReturning,
		onConflictDoNothing: mockOnConflictDoNothing,
	});
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

	describe('follow-up plan templates', () => {
		it('seeds built-in templates as idempotent versioned rows', async () => {
			const { seedBuiltInFollowUpPlanTemplates } = await import('../dal/follow-up-plans');
			const result = await seedBuiltInFollowUpPlanTemplates();

			expect(result).toBeGreaterThan(0);
			expect(mockValues).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({
						templateId: 'vc-followup',
						version: 1,
						source: 'built_in',
						title: 'VC Follow-up',
						isActive: true,
						steps: expect.arrayContaining([
							expect.objectContaining({
								prompt: expect.any(String),
								delayHours: expect.any(Number),
							}),
						]),
					}),
				]),
			);
			expect(mockOnConflictDoNothing).toHaveBeenCalled();
		});

		it('lists the latest active built-in template versions from the local table', async () => {
			mockLimit.mockResolvedValueOnce([
				{
					templateId: 'vc-followup',
					version: 2,
					source: 'built_in',
					title: 'VC Follow-up',
					description: 'Updated investor follow-up',
					category: 'Investor',
					steps: [{ prompt: 'Updated first step', delayHours: 4 }],
				},
				{
					templateId: 'vc-followup',
					version: 1,
					source: 'built_in',
					title: 'VC Follow-up',
					description: 'Old version',
					category: 'Investor',
					steps: [{ prompt: 'Old first step', delayHours: 2 }],
				},
			]);

			const { listFollowUpPlanTemplates } = await import('../dal/follow-up-plans');
			const result = await listFollowUpPlanTemplates();

			expect(result).toEqual([
				{
					id: 'vc-followup',
					version: 2,
					source: 'built_in',
					title: 'VC Follow-up',
					description: 'Updated investor follow-up',
					category: 'Investor',
					steps: [{ prompt: 'Updated first step', delayHours: 4 }],
				},
			]);
		});

		it('creates encrypted workspace-local template copies', async () => {
			mockReturning.mockResolvedValueOnce([
				{
					templateId: 'local-template-1',
					title: 'Local VC Follow-up',
					description: 'Personal investor sequence',
					version: 1,
					source: 'user',
					category: 'Investor',
					steps: JSON.stringify([{ prompt: 'Local prompt', delayHours: 24 }]),
				},
			]);

			const { createFollowUpPlanTemplate } = await import('../dal/follow-up-plans');
			const result = await createFollowUpPlanTemplate(
				'ws-1',
				{
					title: 'Local VC Follow-up',
					description: 'Personal investor sequence',
					category: 'Investor',
					steps: [{ prompt: 'Local prompt', delayHours: 24 }],
				},
				MOCK_ENVELOPE,
			);

			expect(result).toEqual(
				expect.objectContaining({
					id: 'local-template-1',
					title: 'Local VC Follow-up',
					description: 'Personal investor sequence',
					version: 1,
					source: 'user',
					steps: [{ prompt: 'Local prompt', delayHours: 24 }],
				}),
			);
			expect(mockValues).toHaveBeenCalledWith(
				expect.objectContaining({
					workspaceId: 'ws-1',
					version: 1,
					title: 'Local VC Follow-up',
					description: 'Personal investor sequence',
					category: 'Investor',
					steps: JSON.stringify([{ prompt: 'Local prompt', delayHours: 24 }]),
					isActive: true,
				}),
			);
		});

		it('creates a new encrypted version for an existing local template copy', async () => {
			mockLimit.mockResolvedValueOnce([
				{
					templateId: 'local-template-1',
					version: 1,
					title: 'Local VC Follow-up',
					description: 'Personal investor sequence',
					category: 'Investor',
					steps: JSON.stringify([{ prompt: 'Old local prompt', delayHours: 24 }]),
				},
			]);
			mockReturning.mockResolvedValueOnce([
				{
					templateId: 'local-template-1',
					title: 'Local VC Follow-up v2',
					description: 'Personal investor sequence',
					version: 2,
					source: 'user',
					category: 'Investor',
					steps: JSON.stringify([{ prompt: 'Updated local prompt', delayHours: 48 }]),
				},
			]);

			const { createFollowUpPlanTemplateVersion } = await import('../dal/follow-up-plans');
			const result = await createFollowUpPlanTemplateVersion(
				'ws-1',
				'local-template-1',
				{
					title: 'Local VC Follow-up v2',
					description: 'Personal investor sequence',
					category: 'Investor',
					steps: [{ prompt: 'Updated local prompt', delayHours: 48 }],
				},
				MOCK_ENVELOPE,
			);

			expect(result).toEqual(
				expect.objectContaining({
					id: 'local-template-1',
					title: 'Local VC Follow-up v2',
					version: 2,
					source: 'user',
					steps: [{ prompt: 'Updated local prompt', delayHours: 48 }],
				}),
			);
			expect(mockValues).toHaveBeenCalledWith(
				expect.objectContaining({
					workspaceId: 'ws-1',
					templateId: 'local-template-1',
					version: 2,
					title: 'Local VC Follow-up v2',
					steps: JSON.stringify([{ prompt: 'Updated local prompt', delayHours: 48 }]),
					metadata: expect.objectContaining({ previousVersion: 1 }),
				}),
			);
		});

		it('rejects local template version updates from another workspace', async () => {
			mockLimit.mockResolvedValueOnce([]);

			const { createFollowUpPlanTemplateVersion } = await import('../dal/follow-up-plans');
			await expect(
				createFollowUpPlanTemplateVersion(
					'ws-2',
					'local-template-1',
					{
						title: 'Cross-workspace edit',
						steps: [{ prompt: 'Nope', delayHours: 24 }],
					},
					MOCK_ENVELOPE,
				),
			).rejects.toThrow('Local template not found');
			expect(mockInsert).not.toHaveBeenCalled();
		});

		it('duplicates an existing plan into an encrypted local template', async () => {
			mockLimit
				.mockResolvedValueOnce([
					{
						id: 'plan-1',
						title: 'Investor plan',
					},
				])
				.mockResolvedValueOnce([
					{
						stepNumber: 1,
						prompt: 'First plan prompt',
						delayHours: 24,
					},
					{
						stepNumber: 2,
						prompt: 'Second plan prompt',
						delayHours: 72,
					},
				]);
			mockReturning.mockResolvedValueOnce([
				{
					templateId: 'local-template-from-plan',
					title: 'Investor plan template',
					description: 'Local template duplicated from Investor plan.',
					version: 1,
					source: 'user',
					category: null,
					steps: JSON.stringify([
						{ prompt: 'First plan prompt', delayHours: 24 },
						{ prompt: 'Second plan prompt', delayHours: 72 },
					]),
				},
			]);

			const { createFollowUpPlanTemplateFromPlan } = await import('../dal/follow-up-plans');
			const result = await createFollowUpPlanTemplateFromPlan('ws-1', 'plan-1', {}, MOCK_ENVELOPE);

			expect(result).toEqual(
				expect.objectContaining({
					id: 'local-template-from-plan',
					title: 'Investor plan template',
					version: 1,
					source: 'user',
					steps: [
						{ prompt: 'First plan prompt', delayHours: 24 },
						{ prompt: 'Second plan prompt', delayHours: 72 },
					],
				}),
			);
			expect(mockValues).toHaveBeenCalledWith(
				expect.objectContaining({
					workspaceId: 'ws-1',
					version: 1,
					title: 'Investor plan template',
					description: 'Local template duplicated from Investor plan.',
					steps: JSON.stringify([
						{ prompt: 'First plan prompt', delayHours: 24 },
						{ prompt: 'Second plan prompt', delayHours: 72 },
					]),
					metadata: expect.objectContaining({
						createdFrom: 'follow_up_plan_detail',
						sourcePlanId: 'plan-1',
					}),
				}),
			);
			expect(mockValues).toHaveBeenCalledWith(
				expect.objectContaining({
					workspaceId: 'ws-1',
					followUpPlanId: 'plan-1',
					eventType: 'template_created',
					summary: 'Plan saved as a local template.',
				}),
			);
		});

		it('does not duplicate a plan from another workspace', async () => {
			mockLimit.mockResolvedValueOnce([]);

			const { createFollowUpPlanTemplateFromPlan } = await import('../dal/follow-up-plans');
			await expect(
				createFollowUpPlanTemplateFromPlan('ws-2', 'plan-1', {}, MOCK_ENVELOPE),
			).rejects.toThrow('Follow-up plan not found');
			expect(mockInsert).not.toHaveBeenCalled();
		});

		it('does not duplicate a plan with no template steps', async () => {
			mockLimit
				.mockResolvedValueOnce([
					{
						id: 'plan-1',
						title: 'Empty plan',
					},
				])
				.mockResolvedValueOnce([]);

			const { createFollowUpPlanTemplateFromPlan } = await import('../dal/follow-up-plans');
			await expect(
				createFollowUpPlanTemplateFromPlan('ws-1', 'plan-1', {}, MOCK_ENVELOPE),
			).rejects.toThrow('At least one template step is required');
			expect(mockInsert).not.toHaveBeenCalled();
		});

		it('lists user templates before built-in templates for one workspace', async () => {
			mockLimit
				.mockResolvedValueOnce([
					{
						templateId: 'vc-followup',
						version: 1,
						source: 'built_in',
						title: 'VC Follow-up',
						description: 'Investor follow-up',
						category: 'Investor',
						steps: [{ prompt: 'Built-in prompt', delayHours: 2 }],
					},
				])
				.mockResolvedValueOnce([
					{
						templateId: 'local-template-1',
						version: 1,
						title: 'Local VC Follow-up',
						description: 'Personal investor sequence',
						category: 'Investor',
						steps: JSON.stringify([{ prompt: 'Local prompt', delayHours: 24 }]),
					},
				]);

			const { listFollowUpPlanTemplates } = await import('../dal/follow-up-plans');
			const result = await listFollowUpPlanTemplates('ws-1', MOCK_ENVELOPE);

			expect(result[0]).toEqual(
				expect.objectContaining({
					id: 'local-template-1',
					source: 'user',
					title: 'Local VC Follow-up',
					steps: [{ prompt: 'Local prompt', delayHours: 24 }],
				}),
			);
			expect(result[1]).toEqual(
				expect.objectContaining({
					id: 'vc-followup',
					source: 'built_in',
				}),
			);
		});
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

		it('stores objective in the encrypted column, not unencrypted config', async () => {
			mockLimit.mockResolvedValueOnce([{ id: 'c-1' }]);
			mockFrom.mockReturnValueOnce({ where: mockWhere }).mockReturnValueOnce({
				where: vi.fn(() => Promise.resolve([{ count: 0 }])),
			});
			mockReturning.mockResolvedValueOnce([{ id: 'plan-1', workspaceId: 'ws-1', title: 'Test' }]);

			const { createFollowUpPlan } = await import('../dal/follow-up-plans');
			await createFollowUpPlan(
				'ws-1',
				{
					contactId: 'c-1',
					title: 'Test',
					config: {
						objective: 'Schedule a second meeting',
						aiMode: 'local_ai',
						sendingMode: 'manual',
					},
					steps: [{ prompt: 'Step 1', delayHours: 0 }],
				},
				MOCK_ENVELOPE,
			);

			const planValues = mockValues.mock.calls
				.map(([values]) => values as Record<string, unknown> | unknown[])
				.find(
					(values): values is Record<string, unknown> =>
						!Array.isArray(values) && values.title === 'Test',
				);
			if (!planValues) throw new Error('Plan insert values were not recorded');
			expect(planValues).toEqual(
				expect.objectContaining({
					objective: 'Schedule a second meeting',
					config: expect.objectContaining({
						aiMode: 'local_ai',
						sendingMode: 'manual',
					}),
				}),
			);
			expect(planValues.config).not.toEqual(
				expect.objectContaining({ objective: 'Schedule a second meeting' }),
			);
		});

		it('stores template version metadata while keeping prompts in encrypted step rows', async () => {
			mockLimit.mockResolvedValueOnce([{ id: 'c-1' }]);
			mockFrom.mockReturnValueOnce({ where: mockWhere }).mockReturnValueOnce({
				where: vi.fn(() => Promise.resolve([{ count: 0 }])),
			});
			mockReturning.mockResolvedValueOnce([{ id: 'plan-1', workspaceId: 'ws-1', title: 'Test' }]);

			const { createFollowUpPlan } = await import('../dal/follow-up-plans');
			await createFollowUpPlan(
				'ws-1',
				{
					contactId: 'c-1',
					title: 'Test',
					templateId: 'vc-followup',
					templateVersion: 2,
					templateSource: 'built_in',
					config: {
						aiMode: 'template_only',
						sendingMode: 'manual',
					},
					steps: [{ prompt: 'Versioned first step', delayHours: 4 }],
				},
				MOCK_ENVELOPE,
			);

			const planValues = mockValues.mock.calls
				.map(([values]) => values as Record<string, unknown> | unknown[])
				.find(
					(values): values is Record<string, unknown> =>
						!Array.isArray(values) && values.templateId === 'vc-followup',
				);
			if (!planValues) throw new Error('Plan insert values were not recorded');
			expect(planValues).toEqual(
				expect.objectContaining({
					templateId: 'vc-followup',
					templateVersion: 2,
					templateSource: 'built_in',
					config: expect.objectContaining({
						aiMode: 'template_only',
						sendingMode: 'manual',
					}),
				}),
			);
			expect(planValues.config).not.toEqual(
				expect.objectContaining({ prompt: 'Versioned first step' }),
			);
			expect(mockValues).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({
						cadenceId: 'plan-1',
						prompt: 'Versioned first step',
						delayHours: 4,
					}),
				]),
			);
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

	describe('markStepPendingReview', () => {
		it('stores the generated draft and waits for review', async () => {
			mockReturning.mockResolvedValueOnce([
				{ id: 'step-1', cadenceId: 'plan-1', status: 'pending_review' },
			]);

			const { markStepPendingReview } = await import('../dal/follow-up-plans');
			const result = await markStepPendingReview(
				'ws-1',
				'step-1',
				'Draft text',
				'casual_nudge',
				MOCK_ENVELOPE,
			);

			expect(result).toEqual(expect.objectContaining({ id: 'step-1', status: 'pending_review' }));
			expect(mockSet).toHaveBeenCalledWith(
				expect.objectContaining({
					status: 'pending_review',
					draftText: 'Draft text',
					armType: 'casual_nudge',
					processingLeaseExpiresAt: null,
					lastProcessingError: null,
				}),
			);
			expect(mockValues).toHaveBeenCalledWith(
				expect.objectContaining({
					followUpPlanId: 'plan-1',
					stepId: 'step-1',
					status: 'pending_review',
					source: 'local_ai',
					draftText: 'Draft text',
					version: 1,
				}),
			);
			expect(mockValues).toHaveBeenCalledWith(
				expect.objectContaining({
					followUpPlanId: 'plan-1',
					stepId: 'step-1',
					eventType: 'draft_pending_review',
				}),
			);
		});

		it('stores non-AI review source and activity metadata', async () => {
			mockReturning.mockResolvedValueOnce([
				{ id: 'step-1', cadenceId: 'plan-1', status: 'pending_review' },
			]);

			const { markStepPendingReview } = await import('../dal/follow-up-plans');
			await markStepPendingReview(
				'ws-1',
				'step-1',
				'Reminder-only follow-up',
				undefined,
				MOCK_ENVELOPE,
				{
					source: 'reminder_only',
					activitySummary: 'Reminder-only follow-up queued for review.',
					metadata: { trigger: 'worker_generation', aiMode: 'reminder_only' },
				},
			);

			expect(mockValues).toHaveBeenCalledWith(
				expect.objectContaining({
					followUpPlanId: 'plan-1',
					stepId: 'step-1',
					status: 'pending_review',
					source: 'reminder_only',
					draftText: 'Reminder-only follow-up',
					metadata: { trigger: 'worker_generation', aiMode: 'reminder_only' },
				}),
			);
			expect(mockValues).toHaveBeenCalledWith(
				expect.objectContaining({
					followUpPlanId: 'plan-1',
					stepId: 'step-1',
					eventType: 'draft_pending_review',
					summary: 'Reminder-only follow-up queued for review.',
					metadata: { trigger: 'worker_generation', aiMode: 'reminder_only' },
				}),
			);
		});
	});

	describe('rescheduleFollowUpPlanStep', () => {
		it('reschedules a review step without marking it sent', async () => {
			const scheduledAt = new Date('2026-06-10T12:00:00Z');
			mockReturning.mockResolvedValueOnce([
				{ id: 'step-1', cadenceId: 'plan-1', status: 'ready', scheduledAt },
			]);

			const { rescheduleFollowUpPlanStep } = await import('../dal/follow-up-plans');
			const result = await rescheduleFollowUpPlanStep('ws-1', 'plan-1', 'step-1', {
				scheduledAt,
				reason: 'Need fresh context tomorrow',
			});

			expect(result).toEqual(expect.objectContaining({ id: 'step-1', status: 'ready' }));
			expect(mockSet).toHaveBeenCalledWith(
				expect.objectContaining({
					status: 'ready',
					scheduledAt,
					draftText: null,
					armType: null,
					sentAt: null,
					processingLeaseExpiresAt: null,
					lastProcessingError: null,
				}),
			);
			expect(mockValues).toHaveBeenCalledWith(
				expect.objectContaining({
					followUpPlanId: 'plan-1',
					stepId: 'step-1',
					eventType: 'step_rescheduled',
					metadata: expect.objectContaining({
						scheduledAt: scheduledAt.toISOString(),
						reason: 'Need fresh context tomorrow',
					}),
				}),
			);
			expect(mockValues).not.toHaveBeenCalledWith(
				expect.objectContaining({ status: 'manual_confirmed' }),
			);
		});

		it('does not reschedule wrong-plan or terminal steps', async () => {
			mockReturning.mockResolvedValueOnce([]);

			const { rescheduleFollowUpPlanStep } = await import('../dal/follow-up-plans');
			const result = await rescheduleFollowUpPlanStep('ws-1', 'plan-1', 'step-other', {
				scheduledAt: new Date('2026-06-10T12:00:00Z'),
			});

			expect(result).toBeNull();
			expect(mockValues).not.toHaveBeenCalled();
		});
	});

	describe('requestFollowUpPlanStepRegeneration', () => {
		it('queues a pending review step for fresh local generation and supersedes the latest draft', async () => {
			mockReturning.mockResolvedValueOnce([{ id: 'step-1', cadenceId: 'plan-1', status: 'ready' }]);
			mockLimit.mockResolvedValueOnce([
				{
					id: 'draft-1',
					version: 1,
					approvedAt: null,
					rejectedAt: null,
					supersededAt: null,
					sentAt: null,
				},
			]);

			const { requestFollowUpPlanStepRegeneration } = await import('../dal/follow-up-plans');
			const result = await requestFollowUpPlanStepRegeneration('ws-1', 'plan-1', 'step-1');

			expect(result).toEqual(expect.objectContaining({ id: 'step-1', status: 'ready' }));
			expect(mockSet).toHaveBeenCalledWith(
				expect.objectContaining({
					status: 'ready',
					draftText: null,
					armType: null,
					lastProcessingError: null,
				}),
			);
			expect(mockSet).toHaveBeenCalledWith(
				expect.objectContaining({
					status: 'superseded',
					supersededAt: expect.any(Date),
				}),
			);
			expect(mockValues).toHaveBeenCalledWith(
				expect.objectContaining({
					workspaceId: 'ws-1',
					followUpPlanId: 'plan-1',
					stepId: 'step-1',
					eventType: 'draft_regeneration_requested',
					summary: 'Draft regeneration requested.',
				}),
			);
		});

		it('does not regenerate wrong-plan or terminal steps', async () => {
			mockReturning.mockResolvedValueOnce([]);

			const { requestFollowUpPlanStepRegeneration } = await import('../dal/follow-up-plans');
			const result = await requestFollowUpPlanStepRegeneration('ws-1', 'plan-1', 'step-other');

			expect(result).toBeNull();
			expect(mockLimit).not.toHaveBeenCalled();
			expect(mockValues).not.toHaveBeenCalled();
		});
	});

	describe('getReadySteps', () => {
		it('uses the default bounded catch-up batch size', async () => {
			mockLimit.mockResolvedValueOnce([]);

			const { getReadySteps } = await import('../dal/follow-up-plans');
			const result = await getReadySteps();

			expect(result).toEqual([]);
			expect(mockOrderBy).toHaveBeenCalled();
			expect(mockLimit).toHaveBeenCalledWith(25);
		});

		it('clamps explicit ready-step batch limits', async () => {
			const { getReadySteps } = await import('../dal/follow-up-plans');

			await getReadySteps({ limit: 0 });
			await getReadySteps({ limit: 250 });

			expect(mockLimit).toHaveBeenNthCalledWith(1, 1);
			expect(mockLimit).toHaveBeenNthCalledWith(2, 100);
		});
	});

	describe('follow-up plan step processing lease', () => {
		it('claims a ready step with a durable lease', async () => {
			const now = new Date('2026-06-09T12:00:00Z');
			mockReturning.mockResolvedValueOnce([
				{
					id: 'step-1',
					workspaceId: 'ws-1',
					status: 'ready',
					processingLeaseExpiresAt: new Date('2026-06-09T12:30:00Z'),
				},
			]);

			const { claimReadyFollowUpPlanStep } = await import('../dal/follow-up-plans');
			const result = await claimReadyFollowUpPlanStep('ws-1', 'step-1', {
				now,
				leaseMs: 30 * 60 * 1000,
			});

			expect(result).toEqual(expect.objectContaining({ id: 'step-1' }));
			expect(mockSet).toHaveBeenCalledWith(
				expect.objectContaining({
					processingStartedAt: now,
					processingLeaseExpiresAt: new Date('2026-06-09T12:30:00Z'),
					lastProcessingError: null,
				}),
			);
		});

		it('returns null when a ready step cannot be claimed', async () => {
			mockReturning.mockResolvedValueOnce([]);

			const { claimReadyFollowUpPlanStep } = await import('../dal/follow-up-plans');
			const result = await claimReadyFollowUpPlanStep('ws-1', 'step-claimed');

			expect(result).toBeNull();
			expect(mockUpdate).toHaveBeenCalled();
		});

		it('records a processing failure without marking the step sent', async () => {
			mockReturning.mockResolvedValueOnce([
				{
					id: 'step-1',
					workspaceId: 'ws-1',
					status: 'ready',
				},
			]);

			const { recordFollowUpPlanStepProcessingFailure } = await import('../dal/follow-up-plans');
			const result = await recordFollowUpPlanStepProcessingFailure('ws-1', 'step-1', {
				errorSummary: 'local AI unavailable',
				now: new Date('2026-06-09T12:00:00Z'),
				retryAfterMs: 60_000,
			});

			expect(result).toEqual(expect.objectContaining({ id: 'step-1' }));
			expect(mockSet).toHaveBeenCalledWith(
				expect.objectContaining({
					processingLeaseExpiresAt: new Date('2026-06-09T12:01:00Z'),
					lastProcessingError: 'local AI unavailable',
				}),
			);
			expect(mockSet).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'sent' }));
		});
	});

	describe('follow-up plan draft revisions', () => {
		it('creates an encrypted draft revision for a workspace-scoped step', async () => {
			mockLimit.mockResolvedValueOnce([{ id: 'step-1' }]).mockResolvedValueOnce([]);

			const { createFollowUpPlanDraftRevision } = await import('../dal/follow-up-plans');
			const result = await createFollowUpPlanDraftRevision(
				'ws-1',
				{
					followUpPlanId: 'plan-1',
					stepId: 'step-1',
					status: 'pending_review',
					source: 'template',
					draftText: 'Draft text',
				},
				MOCK_ENVELOPE,
			);

			expect(result).toEqual({ followUpPlanId: 'plan-1', stepId: 'step-1', version: 1 });
			expect(mockValues).toHaveBeenCalledWith(
				expect.objectContaining({
					followUpPlanId: 'plan-1',
					stepId: 'step-1',
					status: 'pending_review',
					source: 'template',
					draftText: 'Draft text',
					version: 1,
				}),
			);
		});

		it('does not create a draft revision for a wrong-plan step', async () => {
			mockLimit.mockResolvedValueOnce([]);

			const { createFollowUpPlanDraftRevision } = await import('../dal/follow-up-plans');
			const result = await createFollowUpPlanDraftRevision(
				'ws-1',
				{
					followUpPlanId: 'plan-1',
					stepId: 'step-other',
					status: 'pending_review',
					draftText: 'Draft text',
				},
				MOCK_ENVELOPE,
			);

			expect(result).toBeNull();
			expect(mockInsert).not.toHaveBeenCalled();
		});

		it('lists draft revisions through the workspace envelope', async () => {
			mockLimit.mockResolvedValueOnce([{ id: 'revision-1', draftText: 'Draft text' }]);

			const { listFollowUpPlanDraftRevisions } = await import('../dal/follow-up-plans');
			const result = await listFollowUpPlanDraftRevisions('ws-1', 'plan-1', MOCK_ENVELOPE);

			expect(mockSelect).toHaveBeenCalled();
			expect(mockOrderBy).toHaveBeenCalled();
			expect(result).toHaveLength(1);
		});

		it('preserves the original generated draft when an edited draft is manually sent', async () => {
			mockLimit
				.mockResolvedValueOnce([
					{
						id: 'step-1',
						cadenceId: 'plan-1',
						stepNumber: 1,
						draftText: 'Original generated draft',
						armType: 'casual_nudge',
					},
				])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([{ id: 'revision-1', version: 1 }])
				.mockResolvedValueOnce([{ contactId: 'contact-1' }])
				.mockResolvedValueOnce([]);
			mockReturning.mockResolvedValueOnce([
				{ id: 'step-1', cadenceId: 'plan-1', stepNumber: 1, armType: 'casual_nudge' },
			]);

			const { editAndApproveStep } = await import('../dal/follow-up-plans');
			const result = await editAndApproveStep(
				'ws-1',
				'plan-1',
				'step-1',
				'Edited draft that was sent manually',
				MOCK_ENVELOPE,
			);

			expect(result).toEqual(expect.objectContaining({ id: 'step-1' }));
			expect(mockValues).toHaveBeenCalledWith(
				expect.objectContaining({
					followUpPlanId: 'plan-1',
					stepId: 'step-1',
					status: 'superseded',
					source: 'legacy_step_draft',
					draftText: 'Original generated draft',
					version: 1,
				}),
			);
			expect(mockValues).toHaveBeenCalledWith(
				expect.objectContaining({
					followUpPlanId: 'plan-1',
					stepId: 'step-1',
					status: 'sent_version',
					source: 'edit',
					draftText: 'Edited draft that was sent manually',
					version: 2,
				}),
			);
		});
	});

	describe('follow-up plan activity and send records', () => {
		it('records a copied pending-review draft without advancing the step', async () => {
			mockLimit.mockResolvedValueOnce([{ id: 'step-1' }]);

			const { recordFollowUpPlanStepCopied } = await import('../dal/follow-up-plans');
			const result = await recordFollowUpPlanStepCopied('ws-1', 'plan-1', 'step-1');

			expect(result).toEqual({
				followUpPlanId: 'plan-1',
				stepId: 'step-1',
				status: 'copied',
			});
			expect(mockUpdate).not.toHaveBeenCalled();
			expect(mockValues).toHaveBeenCalledWith(
				expect.objectContaining({
					followUpPlanId: 'plan-1',
					stepId: 'step-1',
					status: 'copied',
					copiedAt: expect.any(Date),
				}),
			);
			expect(mockValues).toHaveBeenCalledWith(
				expect.objectContaining({
					followUpPlanId: 'plan-1',
					stepId: 'step-1',
					eventType: 'draft_copied',
				}),
			);
		});

		it('does not record copy activity for a non-review or wrong-plan step', async () => {
			mockLimit.mockResolvedValueOnce([]);

			const { recordFollowUpPlanStepCopied } = await import('../dal/follow-up-plans');
			const result = await recordFollowUpPlanStepCopied('ws-1', 'plan-1', 'step-other');

			expect(result).toBeNull();
			expect(mockInsert).not.toHaveBeenCalled();
		});

		it('records an opened Telegram destination without advancing the step', async () => {
			mockLimit.mockResolvedValueOnce([{ id: 'step-1' }]);

			const { recordFollowUpPlanTelegramOpened } = await import('../dal/follow-up-plans');
			const result = await recordFollowUpPlanTelegramOpened('ws-1', 'plan-1', 'step-1');

			expect(result).toEqual({
				followUpPlanId: 'plan-1',
				stepId: 'step-1',
				status: 'telegram_opened',
			});
			expect(mockUpdate).not.toHaveBeenCalled();
			expect(mockValues).toHaveBeenCalledWith(
				expect.objectContaining({
					followUpPlanId: 'plan-1',
					stepId: 'step-1',
					status: 'telegram_opened',
					channel: 'telegram',
					telegramOpenedAt: expect.any(Date),
				}),
			);
			expect(mockValues).toHaveBeenCalledWith(
				expect.objectContaining({
					followUpPlanId: 'plan-1',
					stepId: 'step-1',
					eventType: 'telegram_opened',
				}),
			);
		});

		it('lists activity events newest first for one workspace plan', async () => {
			mockLimit.mockResolvedValueOnce([{ id: 'event-1', eventType: 'draft_copied' }]);

			const { listFollowUpPlanActivity } = await import('../dal/follow-up-plans');
			const result = await listFollowUpPlanActivity('ws-1', 'plan-1');

			expect(mockSelect).toHaveBeenCalled();
			expect(mockOrderBy).toHaveBeenCalled();
			expect(result).toHaveLength(1);
		});

		it('lists send records for one workspace plan', async () => {
			mockLimit.mockResolvedValueOnce([
				{ id: 'send-1', stepId: 'step-1', status: 'copied' },
				{ id: 'send-2', stepId: 'step-1', status: 'telegram_opened' },
			]);

			const { listFollowUpPlanSendRecords } = await import('../dal/follow-up-plans');
			const result = await listFollowUpPlanSendRecords('ws-1', 'plan-1', { stepId: 'step-1' });

			expect(mockSelect).toHaveBeenCalled();
			expect(mockOrderBy).toHaveBeenCalled();
			expect(result).toHaveLength(2);
		});
	});

	describe('follow-up plan worker heartbeat and health', () => {
		it('updates an existing worker heartbeat', async () => {
			const now = new Date('2026-06-09T12:00:00Z');
			mockReturning.mockResolvedValueOnce([
				{
					workerId: 'follow-up-plan-processor',
					status: 'running',
					processedSteps: 2,
					failedSteps: 1,
				},
			]);

			const { recordFollowUpPlanWorkerHeartbeat } = await import('../dal/follow-up-plans');
			const result = await recordFollowUpPlanWorkerHeartbeat({
				status: 'running',
				processedSteps: 2,
				failedSteps: 1,
				now,
			});

			expect(result).toEqual(expect.objectContaining({ workerId: 'follow-up-plan-processor' }));
			expect(mockUpdate).toHaveBeenCalled();
			expect(mockInsert).not.toHaveBeenCalled();
			expect(mockSet).toHaveBeenCalledWith(
				expect.objectContaining({
					status: 'running',
					lastSeenAt: now,
					lastStartedAt: now,
					processedSteps: 2,
					failedSteps: 1,
				}),
			);
		});

		it('creates a worker heartbeat when none exists', async () => {
			const now = new Date('2026-06-09T12:00:00Z');
			mockReturning
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([{ workerId: 'follow-up-plan-processor', status: 'idle' }]);

			const { recordFollowUpPlanWorkerHeartbeat } = await import('../dal/follow-up-plans');
			const result = await recordFollowUpPlanWorkerHeartbeat({
				status: 'idle',
				processedSteps: 0,
				failedSteps: 0,
				now,
			});

			expect(result).toEqual(expect.objectContaining({ workerId: 'follow-up-plan-processor' }));
			expect(mockInsert).toHaveBeenCalled();
			expect(mockValues).toHaveBeenCalledWith(
				expect.objectContaining({
					workerId: 'follow-up-plan-processor',
					status: 'idle',
					lastSeenAt: now,
					lastCompletedAt: now,
				}),
			);
		});

		it('reports unknown health before the worker has reported', async () => {
			mockLimit.mockResolvedValueOnce([]);

			const { getFollowUpPlanWorkerHealth } = await import('../dal/follow-up-plans');
			const result = await getFollowUpPlanWorkerHealth({
				now: new Date('2026-06-09T12:00:00Z'),
			});

			expect(result.status).toBe('unknown');
			expect(result.label).toBe('No heartbeat');
		});

		it('reports a fresh idle heartbeat as running health', async () => {
			const now = new Date('2026-06-09T12:00:00Z');
			mockLimit.mockResolvedValueOnce([
				{
					workerId: 'follow-up-plan-processor',
					status: 'idle',
					lastSeenAt: new Date('2026-06-09T11:59:00Z'),
					processedSteps: 1,
					failedSteps: 0,
				},
			]);

			const { getFollowUpPlanWorkerHealth } = await import('../dal/follow-up-plans');
			const result = await getFollowUpPlanWorkerHealth({ now, staleAfterMs: 120_000 });

			expect(result.status).toBe('running');
			expect(result.label).toBe('Worker ready');
			expect(result.processedSteps).toBe(1);
		});

		it('reports a stale heartbeat as stopped', async () => {
			const now = new Date('2026-06-09T12:00:00Z');
			mockLimit.mockResolvedValueOnce([
				{
					workerId: 'follow-up-plan-processor',
					status: 'idle',
					lastSeenAt: new Date('2026-06-09T08:00:00Z'),
					processedSteps: 0,
					failedSteps: 0,
				},
			]);

			const { getFollowUpPlanWorkerHealth } = await import('../dal/follow-up-plans');
			const result = await getFollowUpPlanWorkerHealth({ now, staleAfterMs: 120_000 });

			expect(result.status).toBe('stale');
			expect(result.label).toBe('Worker stopped');
			expect(result.detail).toContain('Due steps wait until the local worker is running');
			expect(result.detail).toContain('pnpm --filter worker dev');
		});

		it('reports fresh worker errors', async () => {
			const now = new Date('2026-06-09T12:00:00Z');
			mockLimit.mockResolvedValueOnce([
				{
					workerId: 'follow-up-plan-processor',
					status: 'error',
					lastSeenAt: new Date('2026-06-09T11:59:00Z'),
					lastErrorSummary: 'ready query failed',
					processedSteps: 0,
					failedSteps: 0,
				},
			]);

			const { getFollowUpPlanWorkerHealth } = await import('../dal/follow-up-plans');
			const result = await getFollowUpPlanWorkerHealth({ now, staleAfterMs: 120_000 });

			expect(result.status).toBe('error');
			expect(result.label).toBe('Worker error');
			expect(result.detail).toBe('ready query failed');
		});

		it('does not expose raw SQL in worker health errors', async () => {
			const now = new Date('2026-06-09T12:00:00Z');
			mockLimit.mockResolvedValueOnce([
				{
					workerId: 'follow-up-plan-processor',
					status: 'error',
					lastSeenAt: new Date('2026-06-09T11:59:00Z'),
					lastErrorSummary: 'Failed query: select "cadence_steps"."id" from "cadence_steps"',
					processedSteps: 0,
					failedSteps: 0,
				},
			]);

			const { getFollowUpPlanWorkerHealth } = await import('../dal/follow-up-plans');
			const result = await getFollowUpPlanWorkerHealth({ now, staleAfterMs: 120_000 });

			expect(result.status).toBe('error');
			expect(result.detail).toBe('Worker database query failed.');
			expect(result.detail).not.toContain('select');
		});
	});

	describe('approveStep', () => {
		it('records manual confirmation separately from step advancement', async () => {
			mockReturning.mockResolvedValueOnce([{ id: 'step-1', cadenceId: 'plan-1', stepNumber: 1 }]);
			mockLimit.mockResolvedValueOnce([]);

			const { approveStep } = await import('../dal/follow-up-plans');
			const result = await approveStep('ws-1', 'plan-1', 'step-1', MOCK_ENVELOPE);

			expect(result).toEqual(expect.objectContaining({ id: 'step-1' }));
			expect(mockValues).toHaveBeenCalledWith(
				expect.objectContaining({
					followUpPlanId: 'plan-1',
					stepId: 'step-1',
					status: 'manual_confirmed',
					manualConfirmedAt: expect.any(Date),
				}),
			);
			expect(mockValues).toHaveBeenCalledWith(
				expect.objectContaining({
					followUpPlanId: 'plan-1',
					stepId: 'step-1',
					eventType: 'manual_send_confirmed',
				}),
			);
		});
	});

	describe('rejectStep', () => {
		it('stores a skip reason without sending the draft', async () => {
			mockLimit
				.mockResolvedValueOnce([
					{ id: 'step-1', cadenceId: 'plan-1', stepNumber: 1, draftText: null },
				])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([]);
			mockReturning.mockResolvedValueOnce([
				{ id: 'step-1', cadenceId: 'plan-1', stepNumber: 1, draftText: null },
			]);

			const { rejectStep } = await import('../dal/follow-up-plans');
			const result = await rejectStep(
				'ws-1',
				'plan-1',
				'step-1',
				MOCK_ENVELOPE,
				'Already handled directly',
			);

			expect(result).toEqual(expect.objectContaining({ id: 'step-1' }));
			expect(mockValues).toHaveBeenCalledWith(
				expect.objectContaining({
					followUpPlanId: 'plan-1',
					stepId: 'step-1',
					status: 'skipped',
					metadata: { reason: 'Already handled directly' },
				}),
			);
			expect(mockValues).toHaveBeenCalledWith(
				expect.objectContaining({
					followUpPlanId: 'plan-1',
					stepId: 'step-1',
					eventType: 'draft_skipped',
					summary: 'Draft skipped: Already handled directly',
					metadata: { status: 'skipped', reason: 'Already handled directly' },
				}),
			);
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
