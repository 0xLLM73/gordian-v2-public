import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetReadySteps = vi.fn();
const mockAdvanceStep = vi.fn();
const mockGetLatestSummary = vi.fn();
const mockGetFollowUpPlan = vi.fn();
const mockGetFollowUpPlanSteps = vi.fn();
const mockGetVoiceProfile = vi.fn();
const mockGetContactStyleOverride = vi.fn();
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
	getReadySteps: mockGetReadySteps,
	advanceStep: mockAdvanceStep,
	getLatestSummary: mockGetLatestSummary,
	getFollowUpPlan: mockGetFollowUpPlan,
	getFollowUpPlanSteps: mockGetFollowUpPlanSteps,
	getVoiceProfile: mockGetVoiceProfile,
	getContactStyleOverride: mockGetContactStyleOverride,
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
		mockGetVoiceProfile.mockResolvedValue(null);
		mockGetContactStyleOverride.mockResolvedValue(null);
		mockBuildVoiceModifier.mockReturnValue({ modifier: '', profileVersion: null });
	});

	it('does nothing when no ready steps', async () => {
		mockGetReadySteps.mockResolvedValue([]);

		const { processFollowUpPlanSteps } = await import('../follow-up-plan-processor');
		await processFollowUpPlanSteps();

		expect(mockGetReadySteps).toHaveBeenCalledOnce();
		expect(mockGenerateDraftWithBandit).not.toHaveBeenCalled();
	});

	it('generates draft and advances step', async () => {
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
		mockGetFollowUpPlan.mockResolvedValue({ title: 'VC Follow-up' });
		mockGetFollowUpPlanSteps.mockResolvedValue([{ id: 'step-1', prompt: 'Follow up on meeting' }]);

		mockGetLatestSummary.mockResolvedValue({ summary: 'Met at conference, discussed AI tools' });
		mockGenerateDraftWithBandit.mockResolvedValue({
			text: 'Hey, great meeting you at the conference!',
			armType: 'casual_nudge',
			traceId: 'trace-1',
		});
		mockAdvanceStep.mockResolvedValue({ id: 'step-1', status: 'sent' });

		const { processFollowUpPlanSteps } = await import('../follow-up-plan-processor');
		await processFollowUpPlanSteps();

		const envelopeMatcher = expect.objectContaining({
			encryptedWrk: expect.any(Buffer),
			kmsContext: expect.any(Object),
		});

		// Verify encrypted re-queries
		expect(mockGetFollowUpPlan).toHaveBeenCalledWith('ws-1', 'plan-1', envelopeMatcher);
		expect(mockGetFollowUpPlanSteps).toHaveBeenCalledWith('ws-1', 'plan-1', envelopeMatcher);

		// Verify getLatestSummary called with 3 args (workspaceId, contactId, envelope)
		expect(mockGetLatestSummary).toHaveBeenCalledWith('ws-1', 'contact-1', envelopeMatcher);
		// 4th arg is voiceModifier — undefined when buildVoiceModifier returns empty string
		expect(mockGenerateDraftWithBandit).toHaveBeenCalledWith(
			'Met at conference, discussed AI tools',
			expect.stringContaining('VC Follow-up'),
			'owner-1',
			undefined,
		);
		expect(mockAdvanceStep).toHaveBeenCalledWith(
			'ws-1',
			'step-1',
			'Hey, great meeting you at the conference!',
			'casual_nudge',
			envelopeMatcher,
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
		mockAdvanceStep.mockResolvedValue({ id: 'step-1', status: 'sent' });

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
			'Investor contact',
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
		mockAdvanceStep.mockResolvedValue({ id: 'step-1', status: 'sent' });

		// Voice profile lookup throws — non-fatal
		mockGetVoiceProfile.mockRejectedValue(new Error('DB timeout'));

		const { processFollowUpPlanSteps } = await import('../follow-up-plan-processor');
		await processFollowUpPlanSteps();

		// Draft should still be generated without voiceModifier
		expect(mockGenerateDraftWithBandit).toHaveBeenCalledWith(
			'Contact summary',
			expect.stringContaining('Follow-up'),
			'owner-1',
			undefined,
		);
		expect(mockAdvanceStep).toHaveBeenCalledOnce();
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
		mockAdvanceStep.mockResolvedValue({ id: 'step-2', status: 'sent' });

		const { processFollowUpPlanSteps } = await import('../follow-up-plan-processor');
		await processFollowUpPlanSteps();

		expect(mockGenerateDraftWithBandit).toHaveBeenCalledWith(
			'No summary available',
			expect.stringContaining('Post-Intro'),
			'owner-1',
			undefined,
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
		expect(mockAdvanceStep).not.toHaveBeenCalled();
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
		mockAdvanceStep.mockResolvedValue({ id: 'step-b', status: 'sent' });

		const { processFollowUpPlanSteps } = await import('../follow-up-plan-processor');
		await processFollowUpPlanSteps();

		// Second step should still be processed
		expect(mockAdvanceStep).toHaveBeenCalledOnce();
		expect(mockAdvanceStep).toHaveBeenCalledWith(
			'ws-1',
			'step-b',
			'Draft B',
			'direct_ask',
			expect.objectContaining({ encryptedWrk: expect.any(Buffer) }),
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
