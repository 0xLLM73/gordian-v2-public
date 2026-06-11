import { _resetForTesting as resetRateLimit } from '@/lib/rate-limit';
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

const mockGetUserTelegramAccountIds = vi.fn(() => Promise.resolve(['123456789']));
const mockGetLatestTelegramImportProgress = vi.fn<() => Promise<unknown>>(() =>
	Promise.resolve(null),
);
const mockGetLatestTelegramImportProgressWithHistory = vi.fn<
	() => Promise<{ lastDataImport: unknown; latest: unknown }>
>(() =>
	Promise.resolve({
		latest: null,
		lastDataImport: null,
	}),
);
const mockHasCurrentTelegramConsent = vi.fn(() => Promise.resolve(true));

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	getUserTelegramAccountIds: mockGetUserTelegramAccountIds,
	getLatestTelegramImportProgress: mockGetLatestTelegramImportProgress,
	getLatestTelegramImportProgressWithHistory: mockGetLatestTelegramImportProgressWithHistory,
	hasCurrentTelegramConsent: mockHasCurrentTelegramConsent,
	trackBehavior: vi.fn().mockResolvedValue(null),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('triggerSyncAction', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetRateLimit();
		vi.stubEnv('TELEGRAM_MTPROTO_ENABLED', 'true');
		vi.stubEnv('AI_PROCESSING_ENABLED', 'false');
		vi.stubEnv('WORKER_URL', 'http://localhost:3001');
		vi.stubEnv('WORKER_INTERNAL_SECRET', 'test-secret');
		mockGetUserTelegramAccountIds.mockResolvedValue(['123456789']);
		mockHasCurrentTelegramConsent.mockResolvedValue(true);
		mockGetLatestTelegramImportProgress.mockResolvedValue(null);
		mockGetLatestTelegramImportProgressWithHistory.mockResolvedValue({
			latest: null,
			lastDataImport: null,
		});
		mockFetch.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ importRunId: 'run-1', status: 'queued' }),
		});
	});

	it('queues sync only for users with a linked Telegram account', async () => {
		const { triggerSyncAction } = await import('@/app/actions/sync');

		const result = await triggerSyncAction({ syncScope: 'contacts_only' });

		expect(result?.data?.queued).toBe(true);
		expect(mockGetUserTelegramAccountIds).toHaveBeenCalledWith('user-1');
		expect(mockFetch).toHaveBeenCalled();
		const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
		expect(requestBody.sourceAccountId).toBe('123456789');
	});

	it('downgrades requested AI processing when the server AI gate is disabled', async () => {
		const { triggerSyncAction } = await import('@/app/actions/sync');

		const result = await triggerSyncAction({
			syncScope: 'private_recent',
			enableAiProcessing: true,
		});

		expect(result?.data?.queued).toBe(true);
		const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
		expect(requestBody).toMatchObject({
			syncScope: 'private_recent',
			enableAiProcessing: false,
		});
	});

	it('passes requested AI processing when the server AI gate is enabled', async () => {
		vi.stubEnv('AI_PROCESSING_ENABLED', 'true');
		const { triggerSyncAction } = await import('@/app/actions/sync');

		const result = await triggerSyncAction({
			syncScope: 'private_recent',
			enableAiProcessing: true,
		});

		expect(result?.data?.queued).toBe(true);
		const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
		expect(requestBody).toMatchObject({
			syncScope: 'private_recent',
			enableAiProcessing: true,
		});
	});

	it('passes requested AI processing when local Qwen analysis is configured', async () => {
		vi.stubEnv('COMMITMENT_LLM_PROVIDER', 'local');
		vi.stubEnv('COMMITMENT_LLM_BASE_URL', 'http://localhost:11434/v1');
		vi.stubEnv('COMMITMENT_LLM_MODEL', 'qwen3:4b-instruct');
		vi.stubEnv('KNOWLEDGE_EMBEDDING_PROVIDER', 'local');
		vi.stubEnv('KNOWLEDGE_EMBEDDING_PRESET', 'qwen');
		vi.stubEnv('KNOWLEDGE_EMBEDDING_MODEL', 'qwen3-embedding:0.6b');
		const { triggerSyncAction } = await import('@/app/actions/sync');

		const result = await triggerSyncAction({
			syncScope: 'private_recent',
			enableAiProcessing: true,
		});

		expect(result?.data?.queued).toBe(true);
		const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
		expect(requestBody).toMatchObject({
			syncScope: 'private_recent',
			enableAiProcessing: true,
		});
	});

	it('passes the explicit group sync scope to the worker', async () => {
		const { triggerSyncAction } = await import('@/app/actions/sync');

		const result = await triggerSyncAction({
			syncScope: 'private_recent_with_groups',
			enableAiProcessing: false,
		});

		expect(result?.data?.queued).toBe(true);
		const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
		expect(requestBody).toMatchObject({
			syncScope: 'private_recent_with_groups',
			enableAiProcessing: false,
		});
	});

	it('returns a clear error when the worker queue request times out', async () => {
		const { triggerSyncAction } = await import('@/app/actions/sync');
		const abortError = new Error('aborted');
		abortError.name = 'AbortError';
		mockFetch.mockRejectedValueOnce(abortError);

		const result = await triggerSyncAction({ syncScope: 'private_recent_with_groups' });

		expect(result?.data).toMatchObject({
			queued: false,
			error: 'Timed out waiting for the local worker to queue sync',
		});
		expect(mockFetch.mock.calls[0]?.[1]).toMatchObject({
			signal: expect.any(AbortSignal),
		});
	});

	it('denies sync for users without a linked Telegram account', async () => {
		const { triggerSyncAction } = await import('@/app/actions/sync');
		mockGetUserTelegramAccountIds.mockResolvedValueOnce([]);

		const result = await triggerSyncAction({ syncScope: 'contacts_only' });

		expect(result?.serverError).toBe('No linked Telegram account');
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('requires an account selection when multiple Telegram accounts are linked', async () => {
		const { triggerSyncAction } = await import('@/app/actions/sync');
		mockGetUserTelegramAccountIds.mockResolvedValueOnce(['123456789', '987654321']);

		const result = await triggerSyncAction({ syncScope: 'contacts_only' });

		expect(result?.serverError).toBe('Select one Telegram account before starting a sync');
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('queues sync for the selected linked Telegram account', async () => {
		const { triggerSyncAction } = await import('@/app/actions/sync');
		mockGetUserTelegramAccountIds.mockResolvedValueOnce(['123456789', '987654321']);

		const result = await triggerSyncAction({
			syncScope: 'contacts_only',
			telegramAccountKey: '1',
		});

		expect(result?.data?.queued).toBe(true);
		const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
		expect(requestBody.sourceAccountId).toBe('987654321');
	});
});

describe('telegram history import actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetRateLimit();
		vi.stubEnv('TELEGRAM_MTPROTO_ENABLED', 'true');
		vi.stubEnv('WORKER_URL', 'http://localhost:3001');
		vi.stubEnv('WORKER_INTERNAL_SECRET', 'test-secret');
		mockGetUserTelegramAccountIds.mockResolvedValue(['123456789']);
		mockHasCurrentTelegramConsent.mockResolvedValue(true);
		mockFetch.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ importRunId: 'run-1', status: 'queued' }),
		});
	});

	it('starts a source-account-bound history import without key material in the payload', async () => {
		const { startTelegramImportAction } = await import('@/app/actions/sync');

		const result = await startTelegramImportAction({ confirmLargeImport: true });

		expect(result?.data).toMatchObject({ importRunId: 'run-1', status: 'queued' });
		expect(mockFetch).toHaveBeenCalledWith(
			'http://localhost:3001/telegram/history-import/start',
			expect.objectContaining({ method: 'POST' }),
		);
		const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
		expect(requestBody).toMatchObject({
			userId: 'user-1',
			workspaceId: WORKSPACE_ID,
			sourceAccountId: '123456789',
			largeImportConfirmed: true,
			localAnalysisMode: 'deferred',
			importMode: 'recent',
		});
		expect(requestBody).not.toHaveProperty('keyEnvelope');
		expect(requestBody).not.toHaveProperty('workspaceSalt');
		expect(requestBody).not.toHaveProperty('telegramSession');
	});

	it('does not start history import without current Telegram consent', async () => {
		const { startTelegramImportAction } = await import('@/app/actions/sync');
		mockHasCurrentTelegramConsent.mockResolvedValueOnce(false);

		const result = await startTelegramImportAction({ confirmLargeImport: true });

		expect(result?.serverError).toBe('Telegram import consent is required');
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('does not silently choose an account when multiple Telegram accounts are linked', async () => {
		const { startTelegramImportAction } = await import('@/app/actions/sync');
		mockGetUserTelegramAccountIds.mockResolvedValueOnce(['123456789', '987654321']);

		const result = await startTelegramImportAction({ confirmLargeImport: true });

		expect(result?.serverError).toBe('Select one Telegram account before starting a large import');
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('starts history import for the selected linked Telegram account', async () => {
		const { startTelegramImportAction } = await import('@/app/actions/sync');
		mockGetUserTelegramAccountIds.mockResolvedValueOnce(['123456789', '987654321']);

		const result = await startTelegramImportAction({
			confirmLargeImport: true,
			telegramAccountKey: '1',
		});

		expect(result?.data).toMatchObject({ importRunId: 'run-1', status: 'queued' });
		const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
		expect(requestBody.sourceAccountId).toBe('987654321');
	});

	it('does not surface sensitive worker error bodies when history import fails', async () => {
		const { startTelegramImportAction } = await import('@/app/actions/sync');
		const sensitiveWorkerError = [
			'TELEGRAM_API_HASH=0123456789abcdef0123456789abcdef',
			'telegram-session:4da901a7-131d-4c70-86b6-6a99008f67b1:656f07d7-b526-46d8-938b-e8679d9d7557',
			'https://api.telegram.org/bot123456:ABCdefGHIjklMNOpqrSTUvwxyz/sendMessage',
		].join(' ');
		mockFetch.mockResolvedValueOnce({
			ok: false,
			json: () => Promise.resolve({ error: sensitiveWorkerError }),
			text: () => Promise.resolve(sensitiveWorkerError),
		});

		const result = await startTelegramImportAction({ confirmLargeImport: true });
		const serialized = JSON.stringify(result);

		expect(result?.serverError).toBe('Failed to start Telegram import');
		expect(serialized).not.toContain('0123456789abcdef');
		expect(serialized).not.toContain('telegram-session:4da901a7');
		expect(serialized).not.toContain('ABCdefGHIjkl');
	});

	it('can explicitly request inline local analysis during history import', async () => {
		const { startTelegramImportAction } = await import('@/app/actions/sync');

		const result = await startTelegramImportAction({
			confirmLargeImport: true,
			runAiDuringImport: true,
		});

		expect(result?.data).toMatchObject({ importRunId: 'run-1', status: 'queued' });
		const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
		expect(requestBody.localAnalysisMode).toBe('inline');
	});

	it('can explicitly request older history backfill during history import', async () => {
		const { startTelegramImportAction } = await import('@/app/actions/sync');

		const result = await startTelegramImportAction({
			confirmLargeImport: true,
			backfillOlderHistory: true,
		});

		expect(result?.data).toMatchObject({ importRunId: 'run-1', status: 'queued' });
		const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
		expect(requestBody.importMode).toBe('backfill');
	});

	it('returns latest import progress and last data import progress separately', async () => {
		const latest = {
			runId: 'latest-noop',
			status: 'completed',
			requestedAt: new Date('2026-05-20T05:38:41.000Z'),
			startedAt: null,
			completedAt: new Date('2026-05-20T05:38:42.000Z'),
			pausedAt: null,
			cancelledAt: null,
			failedAt: null,
			lastHeartbeatAt: null,
			createdAt: new Date('2026-05-20T05:38:41.000Z'),
			updatedAt: new Date('2026-05-20T05:38:42.000Z'),
		};
		const lastDataImport = {
			...latest,
			runId: 'previous-large-import',
			messagesInserted: 4108,
			pagesFetched: 46,
		};
		mockGetLatestTelegramImportProgressWithHistory.mockResolvedValueOnce({
			latest,
			lastDataImport,
		});
		const { getTelegramImportStatusAction } = await import('@/app/actions/sync');

		const result = await getTelegramImportStatusAction({});

		expect(result?.data?.import).toMatchObject({
			runId: 'latest-noop',
			completedAt: '2026-05-20T05:38:42.000Z',
		});
		expect(result?.data?.lastDataImport).toMatchObject({
			runId: 'previous-large-import',
			messagesInserted: 4108,
			pagesFetched: 46,
		});
		expect(result?.data?.hasCurrentTelegramConsent).toBe(true);
		expect(result?.data?.telegramAccounts).toEqual([{ key: '0', label: 'Telegram account 1' }]);
	});
});
