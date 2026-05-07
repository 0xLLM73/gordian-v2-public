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
const MOCK_ENVELOPE = {
	encryptedWrk: Buffer.from('test'),
	kmsContext: { workspaceId: WORKSPACE_ID },
	wrkVersion: 1,
};

vi.mock('@/lib/workspace', () => ({
	getUserWorkspaceId: vi.fn(() => Promise.resolve(WORKSPACE_ID)),
	getWorkspaceEnvelope: vi.fn(() => Promise.resolve(MOCK_ENVELOPE)),
}));

const mockGetVoiceProfile = vi.fn();
const mockMarkCalibrationComplete = vi.fn();

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	getVoiceProfile: mockGetVoiceProfile,
	markCalibrationComplete: mockMarkCalibrationComplete,
	isFeatureEnabled: vi.fn().mockResolvedValue(true),
	appendAuditLog: vi.fn(),
	trackBehavior: vi.fn().mockResolvedValue(null),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('style-calibration actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubEnv('WORKER_URL', 'http://localhost:3001');
		vi.stubEnv('WORKER_INTERNAL_SECRET', 'test-secret');
	});

	describe('getCalibrationSamplesAction', () => {
		it('returns alreadyCalibrated when profile has calibrationComplete', async () => {
			const { getCalibrationSamplesAction } = await import('@/app/actions/style-calibration');
			mockGetVoiceProfile.mockResolvedValue({ calibrationComplete: true });

			const result = await getCalibrationSamplesAction({});

			expect(result?.data).toEqual({ alreadyCalibrated: true, samples: [] });
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('fetches samples from worker when not calibrated', async () => {
			const { getCalibrationSamplesAction } = await import('@/app/actions/style-calibration');
			mockGetVoiceProfile.mockResolvedValue(null);
			const samples = [
				{ text: 'Hey there!', armType: 'casual_nudge' },
				{ text: 'I wanted to follow up.', armType: 'professional_value' },
				{ text: 'Let me know your thoughts.', armType: 'direct_ask' },
			];
			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ samples }),
			});

			const result = await getCalibrationSamplesAction({});

			expect(result?.data).toEqual({ alreadyCalibrated: false, samples });
			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:3001/draft/calibrate',
				expect.objectContaining({
					method: 'POST',
					headers: expect.objectContaining({
						'X-Internal-Secret': 'test-secret',
					}),
				}),
			);
		});

		it('throws when worker returns non-ok', async () => {
			const { getCalibrationSamplesAction } = await import('@/app/actions/style-calibration');
			mockGetVoiceProfile.mockResolvedValue(null);
			mockFetch.mockResolvedValue({ ok: false, status: 500 });

			const result = await getCalibrationSamplesAction({});

			expect(result?.serverError).toBeDefined();
		});
	});

	describe('submitCalibrationFeedbackAction', () => {
		it('sends reactions to worker and marks calibration complete', async () => {
			const { submitCalibrationFeedbackAction } = await import('@/app/actions/style-calibration');
			mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
			mockMarkCalibrationComplete.mockResolvedValue({});

			const reactions = [
				{ armType: 'casual_nudge' as const, action: 'approve' as const },
				{
					armType: 'professional_value' as const,
					action: 'reject' as const,
					reason: 'Too formal',
				},
			];

			const result = await submitCalibrationFeedbackAction({ reactions });

			expect(result?.data).toEqual({ calibrated: true });

			const body = JSON.parse(mockFetch.mock.calls[0][1].body);
			expect(body.userId).toBe('user-1');
			expect(body.workspaceId).toBe(WORKSPACE_ID);
			expect(body.reactions).toEqual(reactions);

			expect(mockMarkCalibrationComplete).toHaveBeenCalledWith('user-1', WORKSPACE_ID);
		});

		it('[CRIT-2] rejects invalid armType', async () => {
			const { submitCalibrationFeedbackAction } = await import('@/app/actions/style-calibration');

			const result = await submitCalibrationFeedbackAction({
				reactions: [{ armType: 'malicious_injection' as never, action: 'approve' }],
			});

			expect(result?.validationErrors).toBeDefined();
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('[CRIT-2] rejects editedText exceeding 4000 chars', async () => {
			const { submitCalibrationFeedbackAction } = await import('@/app/actions/style-calibration');

			const result = await submitCalibrationFeedbackAction({
				reactions: [
					{
						armType: 'casual_nudge',
						action: 'edit',
						editedText: 'x'.repeat(4001),
					},
				],
			});

			expect(result?.validationErrors).toBeDefined();
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('handles skip (empty reactions)', async () => {
			const { submitCalibrationFeedbackAction } = await import('@/app/actions/style-calibration');
			mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
			mockMarkCalibrationComplete.mockResolvedValue({});

			const result = await submitCalibrationFeedbackAction({ reactions: [] });

			expect(result?.data).toEqual({ calibrated: true });
			expect(mockMarkCalibrationComplete).toHaveBeenCalled();
		});
	});
});
