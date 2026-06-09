import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
const INTRODUCTION_ID = '550e8400-e29b-41d4-a716-446655440001';
const MOCK_ENVELOPE = {
	encryptedWrk: Buffer.from('mock'),
	kmsContext: { WorkspaceID: 'mock' },
	wrkVersion: 1,
};

vi.mock('@/lib/workspace', () => ({
	getUserWorkspaceId: vi.fn(() => Promise.resolve(WORKSPACE_ID)),
	getWorkspaceEnvelope: vi.fn(() => Promise.resolve(MOCK_ENVELOPE)),
}));

const mockList = vi.fn(() => Promise.resolve([{ id: INTRODUCTION_ID, status: 'triage' }]));
const mockUpdate = vi.fn(
	async (): Promise<{ id: string; status: string } | null> => ({
		id: INTRODUCTION_ID,
		status: 'active',
	}),
);
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	listIntroductions: mockList,
	updateIntroductionStatus: mockUpdate,
}));

describe('introductions actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('listIntroductionsAction passes workspace, envelope, and status filter to the DAL', async () => {
		const { listIntroductionsAction } = await import('@/app/actions/introductions');

		const result = await listIntroductionsAction({ status: 'triage', limit: 25 });

		expect(result?.data).toBeDefined();
		expect(mockList).toHaveBeenCalledWith(
			WORKSPACE_ID,
			{ status: 'triage', limit: 25 },
			MOCK_ENVELOPE,
		);
	});

	it('listIntroductionsAction rejects unknown status filters', async () => {
		const { listIntroductionsAction } = await import('@/app/actions/introductions');

		const result = await listIntroductionsAction({ status: 'confirmed' as never });

		expect(result?.validationErrors).toBeDefined();
		expect(mockList).not.toHaveBeenCalled();
	});

	it('updateIntroStatusAction records review approval transitions', async () => {
		const { updateIntroStatusAction } = await import('@/app/actions/introductions');

		const result = await updateIntroStatusAction({
			introductionId: INTRODUCTION_ID,
			status: 'active',
		});

		expect(result?.data).toBeDefined();
		expect(mockUpdate).toHaveBeenCalledWith(WORKSPACE_ID, INTRODUCTION_ID, 'active', undefined);
	});

	it('updateIntroStatusAction passes dismissal resolution when archiving', async () => {
		const { updateIntroStatusAction } = await import('@/app/actions/introductions');

		await updateIntroStatusAction({
			introductionId: INTRODUCTION_ID,
			status: 'archive',
			resolution: 'dismissed',
		});

		expect(mockUpdate).toHaveBeenCalledWith(WORKSPACE_ID, INTRODUCTION_ID, 'archive', {
			resolution: 'dismissed',
		});
	});

	it('updateIntroStatusAction returns a safe error when the DAL rejects the transition', async () => {
		mockUpdate.mockResolvedValueOnce(null);
		const { updateIntroStatusAction } = await import('@/app/actions/introductions');

		const result = await updateIntroStatusAction({
			introductionId: INTRODUCTION_ID,
			status: 'active',
		});

		expect(result?.serverError).toBe('Invalid input');
	});

	it('findIntroductionsForPeriodAction estimates a bounded group-chat search', async () => {
		vi.stubEnv('WORKER_URL', 'http://localhost:3001');
		vi.stubEnv('WORKER_INTERNAL_SECRET', 'test-secret');
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					status: 'dry_run',
					workspaceId: WORKSPACE_ID,
					chatLimit: 50,
					batchSize: 150,
					wouldProcessChats: 3,
					wouldProcessMessages: 321,
					maxAgeDays: 14,
					confirmToken: 'confirm-token',
				}),
		});
		const { findIntroductionsForPeriodAction } = await import('@/app/actions/introductions');

		const result = await findIntroductionsForPeriodAction({
			periodValue: 2,
			periodUnit: 'weeks',
			chatLimit: 50,
			batchSize: 150,
		});

		expect(result?.data).toEqual(
			expect.objectContaining({
				status: 'dry_run',
				wouldProcessChats: 3,
				wouldProcessMessages: 321,
				maxAgeDays: 14,
				confirmToken: 'confirm-token',
			}),
		);
		expect(mockFetch).toHaveBeenCalledWith(
			'http://localhost:3001/admin/reprocess-introductions',
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({
					'X-Internal-Secret': 'test-secret',
				}),
			}),
		);
		const body = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
		expect(body).toMatchObject({
			workspaceId: WORKSPACE_ID,
			userId: 'user-1',
			maxAgeDays: 14,
			chatLimit: 50,
			batchSize: 150,
			dryRun: true,
			confirm: false,
		});
	});

	it('getRelationshipScanStatusAction loads workspace-scoped scan status from the worker', async () => {
		vi.stubEnv('WORKER_URL', 'http://localhost:3001');
		vi.stubEnv('WORKER_INTERNAL_SECRET', 'test-secret');
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					active: 1,
					waiting: 3,
					delayed: 0,
					retainedFailed: 0,
					resolvedFailed: 0,
					failed: 0,
					total: 4,
					introductionJobs: 2,
					connectionJobs: 2,
					unknownJobs: 0,
					progressReports: 1,
					diagnostics: {
						messagesInBatch: 150,
						freshSourceMessages: 150,
						relationshipModelCalls: 0,
						introductionKeywordMatches: 1,
						introductionModelCalls: 1,
						introductionRejected: 0,
						connectionKeywordMatches: 0,
						connectionModelCalls: 0,
						connectionRejected: 0,
					},
					oldestJobAt: '2026-06-08T12:00:00.000Z',
					newestJobAt: '2026-06-08T12:05:00.000Z',
					sampledAt: '2026-06-08T12:10:00.000Z',
				}),
		});
		const { getRelationshipScanStatusAction } = await import('@/app/actions/introductions');

		const result = await getRelationshipScanStatusAction({});

		expect(result?.data).toEqual(
			expect.objectContaining({
				active: 1,
				waiting: 3,
				introductionJobs: 2,
				connectionJobs: 2,
			}),
		);
		expect(mockFetch).toHaveBeenCalledWith(
			`http://localhost:3001/admin/relationship-extraction-status?workspaceId=${WORKSPACE_ID}&userId=user-1`,
			expect.objectContaining({
				headers: expect.objectContaining({
					'X-Internal-Secret': 'test-secret',
				}),
			}),
		);
	});

	it('cleanupRelationshipScanFailuresAction clears resolved scan failures through the worker', async () => {
		vi.stubEnv('WORKER_URL', 'http://localhost:3001');
		vi.stubEnv('WORKER_INTERNAL_SECRET', 'test-secret');
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					scanned: 50,
					removed: 49,
					retained: 1,
					sampledAt: '2026-06-08T12:15:00.000Z',
				}),
		});
		const { cleanupRelationshipScanFailuresAction } = await import('@/app/actions/introductions');

		const result = await cleanupRelationshipScanFailuresAction({});

		expect(result?.data).toEqual(
			expect.objectContaining({
				scanned: 50,
				removed: 49,
				retained: 1,
			}),
		);
		expect(mockFetch).toHaveBeenCalledWith(
			'http://localhost:3001/admin/relationship-extraction-cleanup',
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({
					'Content-Type': 'application/json',
					'X-Internal-Secret': 'test-secret',
				}),
				body: JSON.stringify({
					workspaceId: WORKSPACE_ID,
					userId: 'user-1',
				}),
			}),
		);
	});

	it('findIntroductionsForPeriodAction queues the exact estimated search when confirmed', async () => {
		vi.stubEnv('WORKER_URL', 'http://localhost:3001');
		vi.stubEnv('WORKER_INTERNAL_SECRET', 'test-secret');
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					status: 'queued',
					chatsProcessed: 2,
					messagesQueued: 200,
					maxAgeDays: 30,
				}),
		});
		const { findIntroductionsForPeriodAction } = await import('@/app/actions/introductions');

		const result = await findIntroductionsForPeriodAction({
			periodValue: 30,
			periodUnit: 'days',
			chatLimit: 25,
			batchSize: 100,
			confirmToken: 'confirm-token',
		});

		expect(result?.data).toEqual(
			expect.objectContaining({
				status: 'queued',
				chatsProcessed: 2,
				messagesQueued: 200,
				maxAgeDays: 30,
			}),
		);
		const body = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
		expect(body).toMatchObject({
			workspaceId: WORKSPACE_ID,
			userId: 'user-1',
			maxAgeDays: 30,
			chatLimit: 25,
			batchSize: 100,
			dryRun: false,
			confirm: true,
			confirmToken: 'confirm-token',
		});
	});
});
