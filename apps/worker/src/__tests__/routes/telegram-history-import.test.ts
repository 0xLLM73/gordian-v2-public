import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateTelegramImportRun = vi.hoisted(() => vi.fn());
const mockEnqueueTelegramHistoryImport = vi.hoisted(() => vi.fn());
const mockQueueTelegramAiConsentCatchup = vi.hoisted(() => vi.fn());
const mockGetTelegramImportRun = vi.hoisted(() => vi.fn());
const mockGetUserTelegramAccountIds = vi.hoisted(() => vi.fn());
const mockHasCurrentTelegramConsent = vi.hoisted(() => vi.fn());
const mockHasUserAiAnalysisConsent = vi.hoisted(() => vi.fn());
const mockIsWorkspaceMember = vi.hoisted(() => vi.fn());
const mockRequestTelegramImportPause = vi.hoisted(() => vi.fn());
const mockRequestTelegramImportCancel = vi.hoisted(() => vi.fn());
const mockResumeTelegramImportRun = vi.hoisted(() => vi.fn());
const mockUpdateTelegramImportRunStatus = vi.hoisted(() => vi.fn());

vi.mock('../../redis', () => ({
	connection: {
		eval: vi.fn(),
		ttl: vi.fn(),
		set: vi.fn(),
		expire: vi.fn(),
		del: vi.fn(),
		get: vi.fn(),
	},
}));

vi.mock('../../gramjs/thread', () => ({
	sendToUser: vi.fn(),
	terminateUser: vi.fn(),
	setAuthPending: vi.fn(),
}));

vi.mock('../../queues/sync', () => ({
	syncQueue: { add: vi.fn() },
}));

vi.mock('../../queues/telegram-history-import', () => ({
	enqueueTelegramHistoryImport: mockEnqueueTelegramHistoryImport,
	queueTelegramAiConsentCatchup: mockQueueTelegramAiConsentCatchup,
}));

vi.mock('@repo/shared/handoff-token', () => ({
	verifyHandoffToken: vi.fn(),
}));

vi.mock('@repo/crypto', () => ({
	encrypt: vi.fn(() => 'enc:mock'),
	generateSessionKek: vi.fn(async () => ({
		plaintext: Buffer.alloc(32, 1),
		ciphertextBlob: Buffer.alloc(32, 2),
	})),
}));

vi.mock('@repo/db', () => ({
	appendAuditLog: vi.fn(),
	createTelegramImportRun: mockCreateTelegramImportRun,
	getAccessibleContactTelegramId: vi.fn(),
	getTelegramImportRun: mockGetTelegramImportRun,
	getUserTelegramAccountIds: mockGetUserTelegramAccountIds,
	hasCurrentTelegramConsent: mockHasCurrentTelegramConsent,
	hasUserAiAnalysisConsent: mockHasUserAiAnalysisConsent,
	isWorkspaceMember: mockIsWorkspaceMember,
	requestTelegramImportCancel: mockRequestTelegramImportCancel,
	requestTelegramImportPause: mockRequestTelegramImportPause,
	resumeTelegramImportRun: mockResumeTelegramImportRun,
	updateTelegramImportRunStatus: mockUpdateTelegramImportRunStatus,
}));

const SECRET = 'test-secret';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_ACCOUNT_ID = '123456789';
const RUN_ID = '22222222-2222-4222-8222-222222222222';

function post(path: string, body: object, secret = SECRET) {
	return telegram.request(path, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Internal-Secret': secret,
		},
		body: JSON.stringify(body),
	});
}

let telegram: typeof import('../../routes/telegram').telegram;

beforeEach(async () => {
	vi.resetModules();
	vi.clearAllMocks();
	process.env.INTERNAL_AUTH_SECRET = SECRET;
	process.env.WORKER_INTERNAL_SECRET = SECRET;
	vi.stubEnv('TELEGRAM_MTPROTO_ENABLED', 'true');

	mockIsWorkspaceMember.mockResolvedValue(true);
	mockGetUserTelegramAccountIds.mockResolvedValue([SOURCE_ACCOUNT_ID]);
	mockHasCurrentTelegramConsent.mockResolvedValue(true);
	mockHasUserAiAnalysisConsent.mockResolvedValue(true);
	mockUpdateTelegramImportRunStatus.mockResolvedValue(null);
	mockCreateTelegramImportRun.mockResolvedValue({
		id: RUN_ID,
		userId: USER_ID,
		workspaceId: WORKSPACE_ID,
		sourceAccountId: SOURCE_ACCOUNT_ID,
		status: 'queued',
	});
	mockEnqueueTelegramHistoryImport.mockResolvedValue({ id: 'job-1' });
	mockQueueTelegramAiConsentCatchup.mockResolvedValue({
		sourceAccountId: SOURCE_ACCOUNT_ID,
		commitments: { status: 'queued', contactsProcessed: 1, messagesQueued: 2 },
		introductions: { status: 'queued', chatsProcessed: 1, messagesQueued: 2 },
		connections: { status: 'queued', contactsProcessed: 1, messagesQueued: 2 },
	});

	telegram = (await import('../../routes/telegram')).telegram;
});

describe('POST /telegram/ai-consent-catchup', () => {
	it('requires the internal secret', async () => {
		const res = await telegram.request('/ai-consent-catchup', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				userId: USER_ID,
				workspaceId: WORKSPACE_ID,
				sourceAccountId: SOURCE_ACCOUNT_ID,
			}),
		});

		expect(res.status).toBe(401);
		expect(mockQueueTelegramAiConsentCatchup).not.toHaveBeenCalled();
	});

	it('queues catch-up for a linked Telegram account after durable AI consent', async () => {
		const res = await post('/ai-consent-catchup', {
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			sourceAccountId: SOURCE_ACCOUNT_ID,
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			status: 'queued',
			sourceAccountId: SOURCE_ACCOUNT_ID,
		});
		expect(mockQueueTelegramAiConsentCatchup).toHaveBeenCalledWith({
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			sourceAccountId: SOURCE_ACCOUNT_ID,
		});
	});

	it('rejects catch-up when durable AI consent is missing', async () => {
		mockHasUserAiAnalysisConsent.mockResolvedValueOnce(false);

		const res = await post('/ai-consent-catchup', {
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			sourceAccountId: SOURCE_ACCOUNT_ID,
		});

		expect(res.status).toBe(403);
		expect(mockQueueTelegramAiConsentCatchup).not.toHaveBeenCalled();
	});

	it('rejects catch-up for a Telegram account that is not linked to the user', async () => {
		const res = await post('/ai-consent-catchup', {
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			sourceAccountId: '987654321',
		});

		expect(res.status).toBe(403);
		expect(mockQueueTelegramAiConsentCatchup).not.toHaveBeenCalled();
	});
});

describe('POST /telegram/history-import/start', () => {
	it('requires the internal secret', async () => {
		const res = await telegram.request('/history-import/start', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				userId: USER_ID,
				workspaceId: WORKSPACE_ID,
				sourceAccountId: SOURCE_ACCOUNT_ID,
			}),
		});

		expect(res.status).toBe(401);
		expect(mockEnqueueTelegramHistoryImport).not.toHaveBeenCalled();
	});

	it('requires internal auth before exposing disabled import state', async () => {
		vi.stubEnv('TELEGRAM_MTPROTO_ENABLED', 'false');

		const res = await telegram.request('/history-import/start', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				userId: USER_ID,
				workspaceId: WORKSPACE_ID,
				sourceAccountId: SOURCE_ACCOUNT_ID,
				largeImportConfirmed: true,
			}),
		});

		expect(res.status).toBe(401);
		expect(mockCreateTelegramImportRun).not.toHaveBeenCalled();
		expect(mockEnqueueTelegramHistoryImport).not.toHaveBeenCalled();
	});

	it('rejects users without current Telegram consent', async () => {
		mockHasCurrentTelegramConsent.mockResolvedValue(false);

		const res = await post('/history-import/start', {
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			sourceAccountId: SOURCE_ACCOUNT_ID,
			largeImportConfirmed: true,
		});

		expect(res.status).toBe(403);
		expect(mockCreateTelegramImportRun).not.toHaveBeenCalled();
		expect(mockEnqueueTelegramHistoryImport).not.toHaveBeenCalled();
	});

	it('requires explicit large import confirmation', async () => {
		const res = await post('/history-import/start', {
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			sourceAccountId: SOURCE_ACCOUNT_ID,
		});

		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: 'Large import confirmation is required' });
		expect(mockCreateTelegramImportRun).not.toHaveBeenCalled();
		expect(mockEnqueueTelegramHistoryImport).not.toHaveBeenCalled();
	});

	it('creates and enqueues a source-account-bound import without secrets in the payload', async () => {
		const res = await post('/history-import/start', {
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			sourceAccountId: SOURCE_ACCOUNT_ID,
			largeImportConfirmed: true,
		});

		expect(res.status).toBe(200);
		expect(mockCreateTelegramImportRun).toHaveBeenCalledWith({
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			sourceAccountId: SOURCE_ACCOUNT_ID,
		});
		expect(mockEnqueueTelegramHistoryImport).toHaveBeenCalledWith({
			runId: RUN_ID,
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			sourceAccountId: SOURCE_ACCOUNT_ID,
			localAnalysisMode: 'deferred',
			importMode: 'recent',
		});
		const payload = mockEnqueueTelegramHistoryImport.mock.calls[0][0];
		expect(payload).not.toHaveProperty('keyEnvelope');
		expect(payload).not.toHaveProperty('workspaceSalt');
		expect(payload).not.toHaveProperty('telegramSession');
	});

	it('allows explicit inline local analysis for a source-account-bound import', async () => {
		const res = await post('/history-import/start', {
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			sourceAccountId: SOURCE_ACCOUNT_ID,
			largeImportConfirmed: true,
			localAnalysisMode: 'inline',
		});

		expect(res.status).toBe(200);
		expect(mockEnqueueTelegramHistoryImport).toHaveBeenCalledWith({
			runId: RUN_ID,
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			sourceAccountId: SOURCE_ACCOUNT_ID,
			localAnalysisMode: 'inline',
			importMode: 'recent',
		});
	});

	it('allows explicit older-history backfill for a source-account-bound import', async () => {
		const res = await post('/history-import/start', {
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			sourceAccountId: SOURCE_ACCOUNT_ID,
			largeImportConfirmed: true,
			importMode: 'backfill',
		});

		expect(res.status).toBe(200);
		expect(mockEnqueueTelegramHistoryImport).toHaveBeenCalledWith({
			runId: RUN_ID,
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			sourceAccountId: SOURCE_ACCOUNT_ID,
			localAnalysisMode: 'deferred',
			importMode: 'backfill',
		});
	});

	it('passes a bounded history window to the import queue', async () => {
		const res = await post('/history-import/start', {
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			sourceAccountId: SOURCE_ACCOUNT_ID,
			largeImportConfirmed: true,
			historyWindowDays: 90,
		});

		expect(res.status).toBe(200);
		expect(mockEnqueueTelegramHistoryImport).toHaveBeenCalledWith({
			runId: RUN_ID,
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			sourceAccountId: SOURCE_ACCOUNT_ID,
			localAnalysisMode: 'deferred',
			importMode: 'backfill',
			historyWindowDays: 90,
		});
	});

	it('marks the run failed when the initial enqueue fails', async () => {
		mockEnqueueTelegramHistoryImport.mockRejectedValueOnce(new Error('redis down'));

		const res = await post('/history-import/start', {
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			sourceAccountId: SOURCE_ACCOUNT_ID,
			largeImportConfirmed: true,
		});

		expect(res.status).toBe(500);
		expect(mockUpdateTelegramImportRunStatus).toHaveBeenCalledWith(
			WORKSPACE_ID,
			RUN_ID,
			'failed',
			expect.objectContaining({ errorCode: 'TELEGRAM_IMPORT_ENQUEUE_FAILED' }),
		);
	});
});

describe('POST /telegram/history-import/:runId controls', () => {
	it('requires internal auth before exposing disabled resume state', async () => {
		vi.stubEnv('TELEGRAM_MTPROTO_ENABLED', 'false');

		const res = await telegram.request(`/history-import/${RUN_ID}/resume`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				userId: USER_ID,
				workspaceId: WORKSPACE_ID,
			}),
		});

		expect(res.status).toBe(401);
		expect(mockResumeTelegramImportRun).not.toHaveBeenCalled();
		expect(mockEnqueueTelegramHistoryImport).not.toHaveBeenCalled();
	});

	it('resumes a paused run by enqueueing the same run id', async () => {
		mockResumeTelegramImportRun.mockResolvedValue({
			id: RUN_ID,
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			sourceAccountId: SOURCE_ACCOUNT_ID,
			status: 'importing',
		});

		const res = await post(`/history-import/${RUN_ID}/resume`, {
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
		});

		expect(res.status).toBe(200);
		expect(mockEnqueueTelegramHistoryImport).toHaveBeenCalledWith({
			runId: RUN_ID,
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			sourceAccountId: SOURCE_ACCOUNT_ID,
			localAnalysisMode: 'deferred',
			importMode: 'recent',
		});
	});

	it('resumes a paused run with a bounded history window', async () => {
		mockResumeTelegramImportRun.mockResolvedValue({
			id: RUN_ID,
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			sourceAccountId: SOURCE_ACCOUNT_ID,
			status: 'importing',
		});

		const res = await post(`/history-import/${RUN_ID}/resume`, {
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			historyWindowDays: 180,
		});

		expect(res.status).toBe(200);
		expect(mockEnqueueTelegramHistoryImport).toHaveBeenCalledWith({
			runId: RUN_ID,
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			sourceAccountId: SOURCE_ACCOUNT_ID,
			localAnalysisMode: 'deferred',
			importMode: 'backfill',
			historyWindowDays: 180,
		});
	});
});
