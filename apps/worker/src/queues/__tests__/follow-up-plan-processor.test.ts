import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetReadySteps = vi.fn();
const mockClaimReadyStep = vi.fn();
const mockMarkStepPendingReview = vi.fn();
const mockRecordStepProcessingFailure = vi.fn();
const mockRecordWorkerHeartbeat = vi.fn(() => Promise.resolve(null));
const mockGetLatestSummary = vi.fn();
const mockGetFollowUpPlan = vi.fn();
const mockGetFollowUpPlanSteps = vi.fn();
const mockGetVoiceProfile = vi.fn();
const mockGetContactStyleOverride = vi.fn();
const mockGetContact = vi.fn();
const mockUnwrapWrk = vi.fn();
const mockDeriveKeys = vi.fn();
const mockGeneratePersonPseudonym = vi.fn();
const mockMaskEntities = vi.fn();
const mockPrefilterEntities = vi.fn();
const mockDb = {
	select: vi.fn(() => mockDb),
	from: vi.fn(() => mockDb),
	where: vi.fn(() => mockDb),
	limit: vi.fn(() =>
		Promise.resolve([
			{
				encryptedWrk: Buffer.from('test-wrk').toString('base64'),
				kmsContext: { WorkspaceID: 'ws-1' },
				wrkVersion: 1,
				ownerId: 'owner-1',
			},
		]),
	),
};

vi.mock('@repo/db', () => ({
	FOLLOW_UP_PLAN_READY_STEP_BATCH_SIZE: 25,
	getReadySteps: mockGetReadySteps,
	claimReadyFollowUpPlanStep: mockClaimReadyStep,
	markStepPendingReview: mockMarkStepPendingReview,
	recordFollowUpPlanStepProcessingFailure: mockRecordStepProcessingFailure,
	recordFollowUpPlanWorkerHeartbeat: mockRecordWorkerHeartbeat,
	getLatestSummary: mockGetLatestSummary,
	getFollowUpPlan: mockGetFollowUpPlan,
	getFollowUpPlanSteps: mockGetFollowUpPlanSteps,
	getVoiceProfile: mockGetVoiceProfile,
	getContactStyleOverride: mockGetContactStyleOverride,
	getContact: mockGetContact,
	db: mockDb,
	eq: vi.fn(),
	workspaces: {
		id: 'id',
		encryptedWrk: 'encryptedWrk',
		kmsContext: 'kmsContext',
		wrkVersion: 'wrkVersion',
		ownerId: 'ownerId',
	},
}));

vi.mock('@repo/crypto', () => ({
	unwrapWrk: mockUnwrapWrk,
	deriveKeys: mockDeriveKeys,
	generatePersonPseudonym: mockGeneratePersonPseudonym,
	maskEntities: mockMaskEntities,
	prefilterEntities: mockPrefilterEntities,
}));

const mockGenerateDraftWithBandit = vi.fn();
vi.mock('../../ai/draft-generation', () => ({
	generateDraftWithBandit: mockGenerateDraftWithBandit,
}));

const mockBuildVoiceModifier = vi.fn();
vi.mock('../../ai/voice-modifier', () => ({
	buildVoiceModifier: mockBuildVoiceModifier,
}));

describe('follow-up-plan-processor', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset the db chain mock for each test
		mockDb.select.mockReturnValue(mockDb);
		mockDb.from.mockReturnValue(mockDb);
		mockDb.where.mockReturnValue(mockDb);
		mockDb.limit.mockResolvedValue([
			{
				encryptedWrk: Buffer.from('test-wrk').toString('base64'),
				kmsContext: { WorkspaceID: 'ws-1' },
				wrkVersion: 1,
				ownerId: 'owner-1',
			},
		]);
		// Default voice profile mocks — no profile available
		mockClaimReadyStep.mockResolvedValue({ id: 'claimed-step' });
		mockRecordStepProcessingFailure.mockResolvedValue(null);
		mockGetVoiceProfile.mockResolvedValue(null);
		mockGetContactStyleOverride.mockResolvedValue(null);
		mockBuildVoiceModifier.mockReturnValue({ modifier: '', profileVersion: null });
		mockUnwrapWrk.mockResolvedValue(Buffer.from('mock-wrk'));
		mockDeriveKeys.mockResolvedValue({ bik: Buffer.from('mock-bik') });
		mockGeneratePersonPseudonym.mockReturnValue('PERSON_masked');
		mockPrefilterEntities.mockReturnValue([]);
		mockMaskEntities.mockImplementation((value: string) => ({
			maskedText: value.replace(/alice@example\.com/gi, 'EMAIL_masked'),
			entityMap: [],
		}));
		mockGetContact.mockResolvedValue({
			firstName: 'Alice',
			lastName: 'Smith',
			username: 'alice_dev',
		});
	});

	it('does nothing when no ready steps', async () => {
		mockGetReadySteps.mockResolvedValue([]);

		const { processFollowUpPlanSteps } = await import('../follow-up-plan-processor');
		await processFollowUpPlanSteps();

		expect(mockGetReadySteps).toHaveBeenCalledOnce();
		expect(mockGetReadySteps).toHaveBeenCalledWith({ limit: 25 });
		expect(mockClaimReadyStep).not.toHaveBeenCalled();
		expect(mockGenerateDraftWithBandit).not.toHaveBeenCalled();
		expect(mockRecordWorkerHeartbeat).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				status: 'running',
				processedSteps: 0,
				failedSteps: 0,
				metadata: { batchSize: 25 },
			}),
		);
		expect(mockRecordWorkerHeartbeat).toHaveBeenLastCalledWith(
			expect.objectContaining({
				status: 'idle',
				processedSteps: 0,
				failedSteps: 0,
				metadata: expect.objectContaining({ readySteps: 0, batchSize: 25, batchFull: false }),
			}),
		);
	});

	it('generates draft and queues step for review', async () => {
		mockGetReadySteps.mockResolvedValue([
			{
				step: { id: 'step-1', stepNumber: 1 },
				cadence: {
					id: 'plan-1',
					workspaceId: 'ws-1',
					contactId: 'contact-1',
					status: 'active',
					totalSteps: 4,
					completedSteps: 0,
					config: {},
				},
			},
		]);

		// Encrypted data re-queried per-workspace
		mockGetFollowUpPlan.mockResolvedValue({ title: 'VC Follow-up with Alice Smith' });
		mockGetFollowUpPlanSteps.mockResolvedValue([
			{ id: 'step-1', prompt: 'Follow up with Alice Smith at alice@example.com' },
		]);

		mockGetLatestSummary.mockResolvedValue({
			summary: 'Met Alice Smith at conference, discussed AI tools via alice@example.com',
		});
		mockGenerateDraftWithBandit.mockResolvedValue({
			text: 'Hey, great meeting you at the conference!',
			armType: 'casual_nudge',
			traceId: 'trace-1',
		});
		mockMarkStepPendingReview.mockResolvedValue({ id: 'step-1', status: 'pending_review' });

		const { processFollowUpPlanSteps } = await import('../follow-up-plan-processor');
		await processFollowUpPlanSteps();

		const envelopeMatcher = expect.objectContaining({
			encryptedWrk: expect.any(Buffer),
			kmsContext: expect.any(Object),
		});

		// Verify encrypted re-queries
		expect(mockClaimReadyStep).toHaveBeenCalledWith('ws-1', 'step-1');
		expect(mockGetFollowUpPlan).toHaveBeenCalledWith('ws-1', 'plan-1', envelopeMatcher);
		expect(mockGetFollowUpPlanSteps).toHaveBeenCalledWith('ws-1', 'plan-1', envelopeMatcher);

		// Verify getLatestSummary called with 3 args (workspaceId, contactId, envelope)
		expect(mockGetLatestSummary).toHaveBeenCalledWith('ws-1', 'contact-1', envelopeMatcher);
		const [contactSummary, context, userId, voiceModifier] =
			mockGenerateDraftWithBandit.mock.calls[0];
		expect(contactSummary).toContain('Contact: PERSON_masked');
		expect(contactSummary).toContain('EMAIL_masked');
		expect(contactSummary).not.toContain('Alice');
		expect(contactSummary).not.toContain('alice@example.com');
		expect(context).toContain('VC Follow-up');
		expect(context).toContain('PERSON_masked');
		expect(context).toContain('EMAIL_masked');
		expect(context).not.toContain('Alice');
		expect(context).not.toContain('alice@example.com');
		expect(userId).toBe('owner-1');
		expect(voiceModifier).toBeUndefined();
		expect(mockMarkStepPendingReview).toHaveBeenCalledWith(
			'ws-1',
			'step-1',
			'Hey, great meeting you at the conference!',
			'casual_nudge',
			envelopeMatcher,
		);
		expect(mockRecordWorkerHeartbeat).toHaveBeenLastCalledWith(
			expect.objectContaining({
				status: 'idle',
				processedSteps: 1,
				failedSteps: 0,
				metadata: expect.objectContaining({ readySteps: 1, batchSize: 25, batchFull: false }),
			}),
		);
	});

	it('passes voiceModifier to generateDraftWithBandit when profile exists', async () => {
		mockGetReadySteps.mockResolvedValue([
			{
				step: { id: 'step-1', stepNumber: 1 },
				cadence: {
					id: 'plan-1',
					workspaceId: 'ws-1',
					contactId: 'contact-1',
					status: 'active',
					totalSteps: 2,
					completedSteps: 0,
					config: {},
				},
			},
		]);

		mockGetFollowUpPlan.mockResolvedValue({ title: 'Follow-up' });
		mockGetFollowUpPlanSteps.mockResolvedValue([{ id: 'step-1', prompt: 'Check in' }]);
		mockGetLatestSummary.mockResolvedValue({ summary: 'Investor contact' });
		mockGenerateDraftWithBandit.mockResolvedValue({
			text: 'Hey!',
			armType: 'casual_nudge',
			traceId: 'trace-v',
		});
		mockMarkStepPendingReview.mockResolvedValue({ id: 'step-1', status: 'pending_review' });

		// Voice profile is available
		mockGetVoiceProfile.mockResolvedValue({ avgWordCount: 15, profileVersion: 3 });
		mockGetContactStyleOverride.mockResolvedValue({ dominantTone: 'casual', sampleSize: 20 });
		mockBuildVoiceModifier.mockReturnValue({
			modifier:
				"\n\nVoice Profile (match the user's writing style):\n- Target message length: approximately 15 words",
			profileVersion: 3,
		});

		const { processFollowUpPlanSteps } = await import('../follow-up-plan-processor');
		await processFollowUpPlanSteps();

		// Verify buildVoiceModifier was called with profile and override
		expect(mockBuildVoiceModifier).toHaveBeenCalledWith(
			{ avgWordCount: 15, profileVersion: 3 },
			{ dominantTone: 'casual', sampleSize: 20 },
		);

		// Verify voiceModifier string is passed as 4th argument
		expect(mockGenerateDraftWithBandit).toHaveBeenCalledWith(
			'Contact: PERSON_masked\nInvestor contact',
			expect.stringContaining('Follow-up'),
			'owner-1',
			expect.stringContaining('Voice Profile'),
		);
	});

	it('drafts without voiceModifier when voice profile lookup fails', async () => {
		mockGetReadySteps.mockResolvedValue([
			{
				step: { id: 'step-1', stepNumber: 1 },
				cadence: {
					id: 'plan-1',
					workspaceId: 'ws-1',
					contactId: 'contact-1',
					status: 'active',
					totalSteps: 2,
					completedSteps: 0,
					config: {},
				},
			},
		]);

		mockGetFollowUpPlan.mockResolvedValue({ title: 'Follow-up' });
		mockGetFollowUpPlanSteps.mockResolvedValue([{ id: 'step-1', prompt: 'Check in' }]);
		mockGetLatestSummary.mockResolvedValue({ summary: 'Contact summary' });
		mockGenerateDraftWithBandit.mockResolvedValue({
			text: 'Draft text',
			armType: 'direct_ask',
			traceId: 'trace-f',
		});
		mockMarkStepPendingReview.mockResolvedValue({ id: 'step-1', status: 'pending_review' });

		// Voice profile lookup throws — non-fatal
		mockGetVoiceProfile.mockRejectedValue(new Error('DB timeout'));

		const { processFollowUpPlanSteps } = await import('../follow-up-plan-processor');
		await processFollowUpPlanSteps();

		// Draft should still be generated without voiceModifier
		expect(mockGenerateDraftWithBandit).toHaveBeenCalledWith(
			'Contact: PERSON_masked\nContact summary',
			expect.stringContaining('Follow-up'),
			'owner-1',
			undefined,
		);
		expect(mockMarkStepPendingReview).toHaveBeenCalledOnce();
	});

	it('uses fallback summary when none available', async () => {
		mockGetReadySteps.mockResolvedValue([
			{
				step: { id: 'step-2', stepNumber: 2 },
				cadence: {
					id: 'plan-2',
					workspaceId: 'ws-1',
					contactId: 'contact-2',
					status: 'active',
					totalSteps: 3,
					completedSteps: 1,
					config: {},
				},
			},
		]);

		mockGetFollowUpPlan.mockResolvedValue({ title: 'Post-Intro' });
		mockGetFollowUpPlanSteps.mockResolvedValue([{ id: 'step-2', prompt: 'Share an article' }]);

		mockGetLatestSummary.mockResolvedValue(null);
		mockGenerateDraftWithBandit.mockResolvedValue({
			text: 'Thought you might find this interesting...',
			armType: 'professional_value',
			traceId: 'trace-2',
		});
		mockMarkStepPendingReview.mockResolvedValue({ id: 'step-2', status: 'pending_review' });

		const { processFollowUpPlanSteps } = await import('../follow-up-plan-processor');
		await processFollowUpPlanSteps();

		expect(mockGenerateDraftWithBandit).toHaveBeenCalledWith(
			'Contact: PERSON_masked\nNo summary available',
			expect.stringContaining('Post-Intro'),
			'owner-1',
			undefined,
		);
	});

	it('queues template-only review text without calling local AI', async () => {
		mockGetReadySteps.mockResolvedValue([
			{
				step: { id: 'step-template', stepNumber: 1 },
				cadence: {
					id: 'plan-template',
					workspaceId: 'ws-1',
					contactId: 'contact-1',
					status: 'active',
					totalSteps: 2,
					completedSteps: 0,
					config: { aiMode: 'template_only' },
				},
			},
		]);
		mockGetFollowUpPlan.mockResolvedValue({ title: 'Template Plan' });
		mockGetFollowUpPlanSteps.mockResolvedValue([
			{ id: 'step-template', prompt: 'Check in about the fundraising timeline.' },
		]);
		mockMarkStepPendingReview.mockResolvedValue({
			id: 'step-template',
			status: 'pending_review',
		});

		const { processFollowUpPlanSteps } = await import('../follow-up-plan-processor');
		await processFollowUpPlanSteps();

		expect(mockGenerateDraftWithBandit).not.toHaveBeenCalled();
		expect(mockGetLatestSummary).not.toHaveBeenCalled();
		expect(mockGetVoiceProfile).not.toHaveBeenCalled();
		expect(mockMarkStepPendingReview).toHaveBeenCalledWith(
			'ws-1',
			'step-template',
			expect.stringContaining('Template-only follow-up draft'),
			undefined,
			expect.objectContaining({ encryptedWrk: expect.any(Buffer) }),
			expect.objectContaining({
				source: 'template_only',
				activitySummary: 'Template-only follow-up queued for review.',
				metadata: { trigger: 'worker_generation', aiMode: 'template_only' },
			}),
		);
		expect(mockMarkStepPendingReview.mock.calls[0][2]).toContain(
			'Check in about the fundraising timeline.',
		);
	});

	it('queues reminder-only review text without calling local AI', async () => {
		mockGetReadySteps.mockResolvedValue([
			{
				step: { id: 'step-reminder', stepNumber: 2 },
				cadence: {
					id: 'plan-reminder',
					workspaceId: 'ws-1',
					contactId: 'contact-1',
					status: 'active',
					totalSteps: 3,
					completedSteps: 1,
					config: { aiMode: 'reminder_only' },
				},
			},
		]);
		mockGetFollowUpPlan.mockResolvedValue({ title: 'Reminder Plan' });
		mockGetFollowUpPlanSteps.mockResolvedValue([
			{ id: 'step-reminder', prompt: 'Write a personal follow-up manually.' },
		]);
		mockMarkStepPendingReview.mockResolvedValue({
			id: 'step-reminder',
			status: 'pending_review',
		});

		const { processFollowUpPlanSteps } = await import('../follow-up-plan-processor');
		await processFollowUpPlanSteps();

		expect(mockGenerateDraftWithBandit).not.toHaveBeenCalled();
		expect(mockGetLatestSummary).not.toHaveBeenCalled();
		expect(mockGetVoiceProfile).not.toHaveBeenCalled();
		expect(mockMarkStepPendingReview).toHaveBeenCalledWith(
			'ws-1',
			'step-reminder',
			expect.stringContaining('Reminder-only follow-up'),
			undefined,
			expect.objectContaining({ encryptedWrk: expect.any(Buffer) }),
			expect.objectContaining({
				source: 'reminder_only',
				activitySummary: 'Reminder-only follow-up queued for review.',
				metadata: { trigger: 'worker_generation', aiMode: 'reminder_only' },
			}),
		);
		expect(mockMarkStepPendingReview.mock.calls[0][2]).toContain(
			'Write a personal follow-up manually.',
		);
	});

	it('skips step when workspace envelope not found', async () => {
		mockDb.limit.mockResolvedValue([]); // No workspace found

		mockGetReadySteps.mockResolvedValue([
			{
				step: { id: 'step-x', stepNumber: 1 },
				cadence: {
					id: 'plan-x',
					workspaceId: 'ws-missing',
					contactId: 'contact-x',
					status: 'active',
					totalSteps: 1,
					completedSteps: 0,
					config: {},
				},
			},
		]);

		const { processFollowUpPlanSteps } = await import('../follow-up-plan-processor');
		await processFollowUpPlanSteps();

		expect(mockGetLatestSummary).not.toHaveBeenCalled();
		expect(mockMarkStepPendingReview).not.toHaveBeenCalled();
		expect(mockRecordStepProcessingFailure).toHaveBeenCalledWith(
			'ws-missing',
			'step-x',
			expect.objectContaining({ errorSummary: 'Workspace encryption envelope unavailable.' }),
		);
		expect(mockRecordWorkerHeartbeat).toHaveBeenLastCalledWith(
			expect.objectContaining({
				status: 'idle',
				processedSteps: 0,
				failedSteps: 1,
				metadata: expect.objectContaining({ readySteps: 1, batchSize: 25, batchFull: false }),
			}),
		);
	});

	it('continues processing remaining steps when one fails', async () => {
		mockGetReadySteps.mockResolvedValue([
			{
				step: { id: 'step-a', stepNumber: 1 },
				cadence: {
					id: 'plan-a',
					workspaceId: 'ws-1',
					contactId: 'c-a',
					status: 'active',
					totalSteps: 2,
					completedSteps: 0,
					config: {},
				},
			},
			{
				step: { id: 'step-b', stepNumber: 1 },
				cadence: {
					id: 'plan-b',
					workspaceId: 'ws-1',
					contactId: 'c-b',
					status: 'active',
					totalSteps: 2,
					completedSteps: 0,
					config: {},
				},
			},
		]);

		// getFollowUpPlan/getFollowUpPlanSteps for both plans
		mockGetFollowUpPlan
			.mockResolvedValueOnce({ title: 'Plan A' })
			.mockResolvedValueOnce({ title: 'Plan B' });
		mockGetFollowUpPlanSteps
			.mockResolvedValueOnce([{ id: 'step-a', prompt: 'First' }])
			.mockResolvedValueOnce([{ id: 'step-b', prompt: 'Second' }]);

		// First step fails at getLatestSummary, second succeeds
		mockGetLatestSummary
			.mockRejectedValueOnce(new Error('DB error'))
			.mockResolvedValueOnce({ summary: 'Summary B' });
		mockGenerateDraftWithBandit.mockResolvedValue({
			text: 'Draft B',
			armType: 'direct_ask',
			traceId: 'trace-b',
		});
		mockMarkStepPendingReview.mockResolvedValue({ id: 'step-b', status: 'pending_review' });

		const { processFollowUpPlanSteps } = await import('../follow-up-plan-processor');
		await processFollowUpPlanSteps();

		// Second step should still be processed
		expect(mockMarkStepPendingReview).toHaveBeenCalledOnce();
		expect(mockMarkStepPendingReview).toHaveBeenCalledWith(
			'ws-1',
			'step-b',
			'Draft B',
			'direct_ask',
			expect.objectContaining({ encryptedWrk: expect.any(Buffer) }),
		);
		expect(mockRecordWorkerHeartbeat).toHaveBeenLastCalledWith(
			expect.objectContaining({
				status: 'idle',
				processedSteps: 1,
				failedSteps: 1,
				metadata: expect.objectContaining({ readySteps: 2, batchSize: 25, batchFull: false }),
			}),
		);
		expect(mockRecordStepProcessingFailure).toHaveBeenCalledWith(
			'ws-1',
			'step-a',
			expect.objectContaining({ errorSummary: 'DB error' }),
		);
	});

	it('records local AI unavailable as a retryable processing failure without queueing a draft', async () => {
		mockGetReadySteps.mockResolvedValue([
			{
				step: { id: 'step-ai-down', stepNumber: 1 },
				cadence: {
					id: 'plan-ai-down',
					workspaceId: 'ws-1',
					contactId: 'contact-ai-down',
					status: 'active',
					totalSteps: 1,
					completedSteps: 0,
					config: { aiMode: 'local_ai' },
				},
			},
		]);
		mockGetFollowUpPlan.mockResolvedValue({ title: 'AI outage follow-up' });
		mockGetFollowUpPlanSteps.mockResolvedValue([{ id: 'step-ai-down', prompt: 'Check in' }]);
		mockGetLatestSummary.mockResolvedValue({ summary: 'Contact context' });
		mockGenerateDraftWithBandit.mockRejectedValue(new Error('local AI unavailable'));

		const { processFollowUpPlanSteps } = await import('../follow-up-plan-processor');
		await processFollowUpPlanSteps();

		expect(mockMarkStepPendingReview).not.toHaveBeenCalled();
		expect(mockRecordStepProcessingFailure).toHaveBeenCalledWith(
			'ws-1',
			'step-ai-down',
			expect.objectContaining({ errorSummary: 'local AI unavailable' }),
		);
		expect(mockRecordWorkerHeartbeat).toHaveBeenLastCalledWith(
			expect.objectContaining({
				status: 'idle',
				processedSteps: 0,
				failedSteps: 1,
				metadata: expect.objectContaining({ readySteps: 1, batchSize: 25, batchFull: false }),
			}),
		);
	});

	it('processes one bounded catch-up batch when many overdue steps are ready', async () => {
		const readySteps = Array.from({ length: 25 }, (_, index) => ({
			step: { id: `step-${index + 1}`, stepNumber: index + 1 },
			cadence: {
				id: `plan-${index + 1}`,
				workspaceId: 'ws-1',
				contactId: `contact-${index + 1}`,
				status: 'active',
				totalSteps: 25,
				completedSteps: 0,
				config: { aiMode: 'template_only' },
			},
		}));
		mockGetReadySteps.mockResolvedValue(readySteps);
		mockGetFollowUpPlan.mockResolvedValue({ title: 'Catch-up plan' });
		mockGetFollowUpPlanSteps.mockImplementation((_: string, planId: string) => [
			{
				id: `step-${planId.replace('plan-', '')}`,
				prompt: 'Catch up after local worker restart.',
			},
		]);
		mockMarkStepPendingReview.mockResolvedValue({ status: 'pending_review' });

		const { processFollowUpPlanSteps } = await import('../follow-up-plan-processor');
		await processFollowUpPlanSteps();

		expect(mockGetReadySteps).toHaveBeenCalledWith({ limit: 25 });
		expect(mockGenerateDraftWithBandit).not.toHaveBeenCalled();
		expect(mockMarkStepPendingReview).toHaveBeenCalledTimes(25);
		expect(mockRecordWorkerHeartbeat).toHaveBeenLastCalledWith(
			expect.objectContaining({
				status: 'idle',
				processedSteps: 25,
				failedSteps: 0,
				metadata: expect.objectContaining({ readySteps: 25, batchSize: 25, batchFull: true }),
			}),
		);
	});

	it('skips generation when another worker already claimed the step', async () => {
		mockGetReadySteps.mockResolvedValue([
			{
				step: { id: 'step-claimed', stepNumber: 1 },
				cadence: {
					id: 'plan-claimed',
					workspaceId: 'ws-1',
					contactId: 'contact-claimed',
					status: 'active',
					totalSteps: 1,
					completedSteps: 0,
					config: {},
				},
			},
		]);
		mockClaimReadyStep.mockResolvedValue(null);

		const { processFollowUpPlanSteps } = await import('../follow-up-plan-processor');
		await processFollowUpPlanSteps();

		expect(mockClaimReadyStep).toHaveBeenCalledWith('ws-1', 'step-claimed');
		expect(mockGenerateDraftWithBandit).not.toHaveBeenCalled();
		expect(mockMarkStepPendingReview).not.toHaveBeenCalled();
		expect(mockRecordStepProcessingFailure).not.toHaveBeenCalled();
		expect(mockRecordWorkerHeartbeat).toHaveBeenLastCalledWith(
			expect.objectContaining({
				status: 'idle',
				processedSteps: 0,
				failedSteps: 0,
				metadata: expect.objectContaining({ readySteps: 1, batchSize: 25, batchFull: false }),
			}),
		);
	});

	it('records an error heartbeat when ready-step lookup fails', async () => {
		mockGetReadySteps.mockRejectedValue(new Error('ready query failed'));

		const { processFollowUpPlanSteps } = await import('../follow-up-plan-processor');
		await processFollowUpPlanSteps();

		expect(mockGenerateDraftWithBandit).not.toHaveBeenCalled();
		expect(mockRecordWorkerHeartbeat).toHaveBeenLastCalledWith(
			expect.objectContaining({
				status: 'error',
				processedSteps: 0,
				failedSteps: 0,
				errorSummary: 'ready query failed',
			}),
		);
	});

	it('scheduleFollowUpPlanProcessor sets up setTimeout and setInterval', async () => {
		vi.useFakeTimers();

		const { scheduleFollowUpPlanProcessor } = await import('../follow-up-plan-processor');
		scheduleFollowUpPlanProcessor();

		// Should not have called processFollowUpPlanSteps yet
		expect(mockGetReadySteps).not.toHaveBeenCalled();

		// Advance past initial 60s timeout
		mockGetReadySteps.mockResolvedValue([]);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(mockGetReadySteps).toHaveBeenCalledOnce();

		// Advance past 1 hour interval
		mockGetReadySteps.mockClear();
		mockGetReadySteps.mockResolvedValue([]);
		await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
		expect(mockGetReadySteps).toHaveBeenCalledOnce();

		vi.useRealTimers();
	});
});
