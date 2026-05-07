import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock next/headers
vi.mock('next/headers', () => ({
	headers: vi.fn(() => Promise.resolve(new Headers())),
}));

// Mock auth to return a valid session
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

// Mock workspace helpers
const mockGetWorkspaceEnvelope = vi.fn();
vi.mock('@/lib/workspace', () => ({
	getUserWorkspaceId: vi.fn(() => Promise.resolve(WORKSPACE_ID)),
	getWorkspaceEnvelope: mockGetWorkspaceEnvelope,
}));

// Mock DAL functions
const mockGetLatestDigest = vi.fn();
const mockListDigests = vi.fn();
vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	getLatestDigest: mockGetLatestDigest,
	listDigests: mockListDigests,
}));

// Mock global fetch for worker endpoint calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('digest actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubEnv('WORKER_URL', 'http://localhost:3001');
		vi.stubEnv('WORKER_INTERNAL_SECRET', 'test-secret');
		mockGetWorkspaceEnvelope.mockResolvedValue(MOCK_ENVELOPE);
	});

	describe('getLatestDigestAction', () => {
		it('returns latest digest for authenticated user', async () => {
			const { getLatestDigestAction } = await import('@/app/actions/digest');

			mockGetLatestDigest.mockResolvedValue({
				id: 'digest-1',
				period: 'today',
				status: 'ready',
				content: 'Test digest content',
				sections: {
					activity_overview: { summary: 'Test', message_count: 10, active_conversations: 3 },
				},
			});

			const result = await getLatestDigestAction({});

			expect(result?.data).toBeDefined();
			expect(result?.data?.id).toBe('digest-1');
			expect(mockGetLatestDigest).toHaveBeenCalledWith(WORKSPACE_ID, 'user-1', MOCK_ENVELOPE);
		});

		it('returns null when no digest exists', async () => {
			const { getLatestDigestAction } = await import('@/app/actions/digest');

			mockGetLatestDigest.mockResolvedValue(null);

			const result = await getLatestDigestAction({});

			expect(result?.data).toBeNull();
		});

		it('throws when no envelope available', async () => {
			const { getLatestDigestAction } = await import('@/app/actions/digest');

			mockGetWorkspaceEnvelope.mockResolvedValue(null);

			const result = await getLatestDigestAction({});

			expect(result?.serverError).toBeDefined();
		});
	});

	describe('listDigestsAction', () => {
		it('returns digests for authenticated user', async () => {
			const { listDigestsAction } = await import('@/app/actions/digest');

			mockListDigests.mockResolvedValue([
				{ id: 'digest-1', period: 'today' },
				{ id: 'digest-2', period: 'yesterday' },
			]);

			const result = await listDigestsAction({});

			expect(result?.data).toHaveLength(2);
			expect(mockListDigests).toHaveBeenCalledWith(WORKSPACE_ID, 'user-1', MOCK_ENVELOPE, {
				limit: 10,
			});
		});

		it('respects custom limit', async () => {
			const { listDigestsAction } = await import('@/app/actions/digest');

			mockListDigests.mockResolvedValue([]);

			await listDigestsAction({ limit: 5 });

			expect(mockListDigests).toHaveBeenCalledWith(WORKSPACE_ID, 'user-1', MOCK_ENVELOPE, {
				limit: 5,
			});
		});

		it('rejects limit over 50', async () => {
			const { listDigestsAction } = await import('@/app/actions/digest');

			const result = await listDigestsAction({ limit: 100 });

			expect(result?.validationErrors).toBeDefined();
		});
	});

	describe('generateDigestAction', () => {
		it('triggers worker endpoint with correct params', async () => {
			const { generateDigestAction } = await import('@/app/actions/digest');

			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ queued: true }),
			});

			const result = await generateDigestAction({
				period: 'today',
			});

			expect(result?.data).toEqual({ queued: true, period: 'today' });
			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:3001/digest/generate',
				expect.objectContaining({
					method: 'POST',
					body: JSON.stringify({
						userId: 'user-1',
						workspaceId: WORKSPACE_ID,
						period: 'today',
					}),
				}),
			);
		});

		it('handles worker failure gracefully', async () => {
			const { generateDigestAction } = await import('@/app/actions/digest');

			mockFetch.mockResolvedValue({ ok: false });

			const result = await generateDigestAction({
				period: 'week',
			});

			expect(result?.serverError).toBeDefined();
		});

		it('validates period enum', async () => {
			const { generateDigestAction } = await import('@/app/actions/digest');

			const result = await generateDigestAction({
				period: 'invalid' as 'today',
			});

			expect(result?.validationErrors).toBeDefined();
		});
	});

	describe('ASA-010 — WORKER_URL must be configured', () => {
		it('returns serverError when WORKER_URL is not set', async () => {
			const saved = process.env.WORKER_URL;
			vi.stubEnv('WORKER_URL', '');
			try {
				const { generateDigestAction } = await import('@/app/actions/digest');
				const result = await generateDigestAction({ period: 'today' });
				expect(result?.serverError).toBeDefined();
			} finally {
				if (saved !== undefined) vi.stubEnv('WORKER_URL', saved);
			}
		});
	});
});
