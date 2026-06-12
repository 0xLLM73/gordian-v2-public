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
	encryptedWrk: Buffer.from('mock'),
	kmsContext: { WorkspaceID: 'mock' },
	wrkVersion: 1,
};

vi.mock('@/lib/workspace', () => ({
	getUserWorkspaceId: vi.fn(() => Promise.resolve(WORKSPACE_ID)),
	getWorkspaceEnvelope: vi.fn(() => Promise.resolve(MOCK_ENVELOPE)),
}));

const mockGetCalibration = vi.fn();
const mockGetUserTelegramAccountIds = vi.fn();
const mockUpsertCalibration = vi.fn();
const mockSaveConsent = vi.fn();
const mockFetch = vi.fn();

vi.stubGlobal('fetch', mockFetch);

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	getCalibration: mockGetCalibration,
	getUserTelegramAccountIds: mockGetUserTelegramAccountIds,
	upsertCalibration: mockUpsertCalibration,
	saveConsent: mockSaveConsent,
}));

const MOCK_CALIBRATION = {
	id: 'cal-1',
	userId: 'user-1',
	workspaceId: WORKSPACE_ID,
	communicationStyle: 'direct' as const,
	riskTolerance: 'moderate' as const,
	detailPreference: 'balanced' as const,
	relationshipFocus: 'balanced' as const,
	decisionSpeed: 'moderate' as const,
	priorities: ['deal_flow'],
	industryFocus: ['defi'],
	roleDescription: 'Early-stage crypto investor',
	investmentThesis: null,
	ticketSizeMin: null,
	ticketSizeMax: null,
	calibrationVersion: 1,
	completedAt: new Date('2026-01-01'),
	createdAt: new Date(),
	updatedAt: new Date(),
};

const VALID_INPUT = {
	communicationStyle: 'direct' as const,
	detailPreference: 'balanced' as const,
	riskTolerance: 'moderate' as const,
	decisionSpeed: 'moderate' as const,
	relationshipFocus: 'balanced' as const,
	priorities: ['deal_flow'] as ['deal_flow'],
	industryFocus: ['defi'] as ['defi'],
	roleDescription: 'Early-stage crypto investor',
};

describe('calibration actions', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		vi.unstubAllEnvs();
		mockGetCalibration.mockResolvedValue(null);
		mockGetUserTelegramAccountIds.mockResolvedValue([]);
		mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: 'queued' }) });
	});

	describe('getCalibrationAction', () => {
		it('returns existing calibration for user+workspace', async () => {
			mockGetCalibration.mockResolvedValue(MOCK_CALIBRATION);

			const { getCalibrationAction } = await import('@/app/actions/calibration');
			const result = await getCalibrationAction({});

			expect(result?.data?.calibration).toEqual(MOCK_CALIBRATION);
			// userId is first arg, then workspaceId, then envelope
			expect(mockGetCalibration).toHaveBeenCalledWith('user-1', WORKSPACE_ID, MOCK_ENVELOPE);
		});

		it('returns null when no calibration exists', async () => {
			mockGetCalibration.mockResolvedValue(null);

			const { getCalibrationAction } = await import('@/app/actions/calibration');
			const result = await getCalibrationAction({});

			expect(result?.data?.calibration).toBeNull();
		});
	});

	describe('saveCalibrationAction', () => {
		it('calls upsertCalibration with userId, workspaceId, data, envelope', async () => {
			mockUpsertCalibration.mockResolvedValue(MOCK_CALIBRATION);

			const { saveCalibrationAction } = await import('@/app/actions/calibration');
			const result = await saveCalibrationAction(VALID_INPUT);

			expect(result?.data?.calibration).toEqual(MOCK_CALIBRATION);
			expect(mockUpsertCalibration).toHaveBeenCalledWith(
				'user-1',
				WORKSPACE_ID,
				expect.objectContaining({
					communicationStyle: 'direct',
					riskTolerance: 'moderate',
					detailPreference: 'balanced',
					relationshipFocus: 'balanced',
					decisionSpeed: 'moderate',
					roleDescription: 'Early-stage crypto investor',
				}),
				MOCK_ENVELOPE,
			);
		});

		it('accepts optional investmentThesis and ticket sizes', async () => {
			mockUpsertCalibration.mockResolvedValue(MOCK_CALIBRATION);

			const { saveCalibrationAction } = await import('@/app/actions/calibration');
			const result = await saveCalibrationAction({
				...VALID_INPUT,
				investmentThesis: 'Focus on DeFi protocols',
				ticketSizeMin: 25000,
				ticketSizeMax: 500000,
			});

			expect(result?.data).toBeDefined();
			expect(mockUpsertCalibration).toHaveBeenCalledWith(
				'user-1',
				WORKSPACE_ID,
				expect.objectContaining({
					investmentThesis: 'Focus on DeFi protocols',
					ticketSizeMin: 25000,
					ticketSizeMax: 500000,
				}),
				MOCK_ENVELOPE,
			);
		});

		it('rejects invalid communicationStyle enum value', async () => {
			const { saveCalibrationAction } = await import('@/app/actions/calibration');
			const result = await saveCalibrationAction({
				...VALID_INPUT,
				communicationStyle: 'analytical' as 'direct',
			});
			expect(result?.validationErrors).toBeDefined();
			expect(mockUpsertCalibration).not.toHaveBeenCalled();
		});

		it('rejects empty industryFocus array', async () => {
			const { saveCalibrationAction } = await import('@/app/actions/calibration');
			const result = await saveCalibrationAction({
				...VALID_INPUT,
				industryFocus: [] as unknown as ['defi'],
			});
			expect(result?.validationErrors).toBeDefined();
			expect(mockUpsertCalibration).not.toHaveBeenCalled();
		});

		it('rejects empty priorities array', async () => {
			const { saveCalibrationAction } = await import('@/app/actions/calibration');
			const result = await saveCalibrationAction({
				...VALID_INPUT,
				priorities: [] as unknown as ['deal_flow'],
			});
			expect(result?.validationErrors).toBeDefined();
			expect(mockUpsertCalibration).not.toHaveBeenCalled();
		});

		it('rejects roleDescription shorter than 10 characters', async () => {
			const { saveCalibrationAction } = await import('@/app/actions/calibration');
			const result = await saveCalibrationAction({
				...VALID_INPUT,
				roleDescription: 'too short',
			});
			expect(result?.validationErrors).toBeDefined();
			expect(mockUpsertCalibration).not.toHaveBeenCalled();
		});

		it('rejects investmentThesis over 1000 characters', async () => {
			const { saveCalibrationAction } = await import('@/app/actions/calibration');
			const result = await saveCalibrationAction({
				...VALID_INPUT,
				investmentThesis: 'y'.repeat(1001),
			});
			expect(result?.validationErrors).toBeDefined();
			expect(mockUpsertCalibration).not.toHaveBeenCalled();
		});

		it('returns serverError when upsertCalibration throws', async () => {
			mockUpsertCalibration.mockRejectedValue(new Error('DB connection failed'));

			const { saveCalibrationAction } = await import('@/app/actions/calibration');
			const result = await saveCalibrationAction(VALID_INPUT);

			expect(result?.serverError).toBeDefined();
			expect(result?.data).toBeUndefined();
		});

		it('returns serverError (safe message) for unknown errors', async () => {
			mockUpsertCalibration.mockRejectedValue(new Error('some internal error'));

			const { saveCalibrationAction } = await import('@/app/actions/calibration');
			const result = await saveCalibrationAction(VALID_INPUT);

			// handleServerError returns generic message for non-safe errors
			expect(result?.serverError).toBe('An unexpected error occurred. Please try again.');
			expect(result?.data).toBeUndefined();
		});
	});

	describe('getCalibrationStatusAction', () => {
		it('returns exists:false, completed:false, version:0 when no calibration', async () => {
			mockGetCalibration.mockResolvedValue(null);

			const { getCalibrationStatusAction } = await import('@/app/actions/calibration');
			const result = await getCalibrationStatusAction({});

			expect(result?.data).toEqual({ exists: false, completed: false, version: 0 });
		});

		it('returns exists:true, completed:true, version:N when calibration is complete', async () => {
			mockGetCalibration.mockResolvedValue({
				...MOCK_CALIBRATION,
				completedAt: new Date(),
				calibrationVersion: 3,
			});

			const { getCalibrationStatusAction } = await import('@/app/actions/calibration');
			const result = await getCalibrationStatusAction({});

			expect(result?.data).toEqual({ exists: true, completed: true, version: 3 });
		});

		it('returns completed:false when calibration exists but completedAt is null', async () => {
			mockGetCalibration.mockResolvedValue({
				...MOCK_CALIBRATION,
				completedAt: null,
				calibrationVersion: 1,
			});

			const { getCalibrationStatusAction } = await import('@/app/actions/calibration');
			const result = await getCalibrationStatusAction({});

			expect(result?.data).toEqual({ exists: true, completed: false, version: 1 });
		});
	});

	describe('saveConsentAction', () => {
		it('persists consent with current Telegram consent version', async () => {
			mockSaveConsent.mockResolvedValue(undefined);

			const { saveConsentAction } = await import('@/app/actions/calibration');
			const result = await saveConsentAction({
				consentDataProcessing: true,
				consentAiAnalysis: false,
				consentTelegramAccess: true,
				consentVersion: 2,
			});

			expect(result?.data).toEqual({ saved: true });
			expect(mockSaveConsent).toHaveBeenCalledWith('user-1', WORKSPACE_ID, {
				consentDataProcessing: true,
				consentAiAnalysis: false,
				consentTelegramAccess: true,
				consentVersion: 2,
			});
		});

		it('does not persist AI-analysis consent while AI processing is disabled', async () => {
			vi.stubEnv('AI_PROCESSING_ENABLED', 'false');
			mockSaveConsent.mockResolvedValue(undefined);

			const { saveConsentAction } = await import('@/app/actions/calibration');
			const result = await saveConsentAction({
				consentDataProcessing: true,
				consentAiAnalysis: true,
				consentTelegramAccess: true,
				consentVersion: 2,
			});

			expect(result?.data).toEqual({ saved: true });
			expect(mockSaveConsent).toHaveBeenCalledWith('user-1', WORKSPACE_ID, {
				consentDataProcessing: true,
				consentAiAnalysis: false,
				consentTelegramAccess: true,
				consentVersion: 2,
			});
		});

		it('persists AI-analysis consent when AI processing is enabled', async () => {
			vi.stubEnv('AI_PROCESSING_ENABLED', 'true');
			mockSaveConsent.mockResolvedValue(undefined);

			const { saveConsentAction } = await import('@/app/actions/calibration');
			const result = await saveConsentAction({
				consentDataProcessing: true,
				consentAiAnalysis: true,
				consentTelegramAccess: true,
				consentVersion: 2,
			});

			expect(result?.data).toEqual({ saved: true });
			expect(mockSaveConsent).toHaveBeenCalledWith('user-1', WORKSPACE_ID, {
				consentDataProcessing: true,
				consentAiAnalysis: true,
				consentTelegramAccess: true,
				consentVersion: 2,
			});
		});

		it('queues a Telegram AI catch-up when durable AI consent is first enabled', async () => {
			vi.stubEnv('AI_PROCESSING_ENABLED', 'true');
			vi.stubEnv('WORKER_URL', 'http://localhost:3001');
			vi.stubEnv('WORKER_INTERNAL_SECRET', 'test-secret');
			mockGetCalibration.mockResolvedValueOnce({ ...MOCK_CALIBRATION, consentAiAnalysis: false });
			mockGetUserTelegramAccountIds.mockResolvedValueOnce(['123456789']);
			mockSaveConsent.mockResolvedValue(undefined);

			const { saveConsentAction } = await import('@/app/actions/calibration');
			const result = await saveConsentAction({
				consentDataProcessing: true,
				consentAiAnalysis: true,
				consentTelegramAccess: true,
				consentVersion: 2,
			});

			expect(result?.data).toEqual({ saved: true });
			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:3001/telegram/ai-consent-catchup',
				expect.objectContaining({
					method: 'POST',
					headers: expect.objectContaining({
						'X-Internal-Secret': 'test-secret',
					}),
				}),
			);
			const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
			expect(requestBody).toEqual({
				userId: 'user-1',
				workspaceId: WORKSPACE_ID,
				sourceAccountId: '123456789',
			});
		});

		it('does not queue Telegram AI catch-up when durable AI consent was already enabled', async () => {
			vi.stubEnv('AI_PROCESSING_ENABLED', 'true');
			vi.stubEnv('WORKER_URL', 'http://localhost:3001');
			vi.stubEnv('WORKER_INTERNAL_SECRET', 'test-secret');
			mockGetCalibration.mockResolvedValueOnce({ ...MOCK_CALIBRATION, consentAiAnalysis: true });
			mockGetUserTelegramAccountIds.mockResolvedValueOnce(['123456789']);
			mockSaveConsent.mockResolvedValue(undefined);

			const { saveConsentAction } = await import('@/app/actions/calibration');
			const result = await saveConsentAction({
				consentDataProcessing: true,
				consentAiAnalysis: true,
				consentTelegramAccess: true,
				consentVersion: 2,
			});

			expect(result?.data).toEqual({ saved: true });
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('does not block saving consent when Telegram AI catch-up cannot be queued', async () => {
			vi.stubEnv('AI_PROCESSING_ENABLED', 'true');
			vi.stubEnv('WORKER_URL', 'http://localhost:3001');
			vi.stubEnv('WORKER_INTERNAL_SECRET', 'test-secret');
			mockGetCalibration.mockResolvedValueOnce({ ...MOCK_CALIBRATION, consentAiAnalysis: false });
			mockGetUserTelegramAccountIds.mockResolvedValueOnce(['123456789']);
			mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
			mockSaveConsent.mockResolvedValue(undefined);

			const { saveConsentAction } = await import('@/app/actions/calibration');
			const result = await saveConsentAction({
				consentDataProcessing: true,
				consentAiAnalysis: true,
				consentTelegramAccess: true,
				consentVersion: 2,
			});

			expect(result?.data).toEqual({ saved: true });
			expect(mockSaveConsent).toHaveBeenCalled();
			expect(mockFetch).toHaveBeenCalledTimes(1);
		});

		it('persists AI-analysis consent when local Qwen analysis is configured', async () => {
			vi.stubEnv('AI_PROCESSING_ENABLED', 'false');
			vi.stubEnv('COMMITMENT_LLM_PROVIDER', 'local');
			vi.stubEnv('COMMITMENT_LLM_BASE_URL', 'http://localhost:11434/v1');
			vi.stubEnv('COMMITMENT_LLM_MODEL', 'qwen3:4b-instruct');
			vi.stubEnv('KNOWLEDGE_EMBEDDING_PROVIDER', 'local');
			vi.stubEnv('KNOWLEDGE_EMBEDDING_PRESET', 'qwen');
			vi.stubEnv('KNOWLEDGE_EMBEDDING_MODEL', 'qwen3-embedding:0.6b');
			mockSaveConsent.mockResolvedValue(undefined);

			const { saveConsentAction } = await import('@/app/actions/calibration');
			const result = await saveConsentAction({
				consentDataProcessing: true,
				consentAiAnalysis: true,
				consentTelegramAccess: true,
				consentVersion: 2,
			});

			expect(result?.data).toEqual({ saved: true });
			expect(mockSaveConsent).toHaveBeenCalledWith('user-1', WORKSPACE_ID, {
				consentDataProcessing: true,
				consentAiAnalysis: true,
				consentTelegramAccess: true,
				consentVersion: 2,
			});
		});

		it('rejects stale Telegram consent versions', async () => {
			const { saveConsentAction } = await import('@/app/actions/calibration');
			const result = await saveConsentAction({
				consentDataProcessing: true,
				consentAiAnalysis: true,
				consentTelegramAccess: true,
				consentVersion: 1,
			});

			expect(result?.validationErrors).toBeDefined();
			expect(mockSaveConsent).not.toHaveBeenCalled();
		});
	});
});
