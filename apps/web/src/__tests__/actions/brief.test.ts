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
const mockGetLatestBrief = vi.fn();
const mockUpdateBriefFeedback = vi.fn();
vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	getLatestBrief: mockGetLatestBrief,
	updateBriefFeedback: mockUpdateBriefFeedback,
	trackBehavior: vi.fn(() => Promise.resolve()),
	hasAnalyticsConsent: vi.fn(() => Promise.resolve(true)),
}));

// Mock global fetch for worker endpoint calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const BRIEF_ID = '660e8400-e29b-41d4-a716-446655440001';
const TONE_TRACE_ID = '770e8400-e29b-41d4-a716-446655440002';
const DETAIL_TRACE_ID = '880e8400-e29b-41d4-a716-446655440003';

const MOCK_BRIEF = {
	id: BRIEF_ID,
	content: 'Good morning! Here is your brief for Monday.',
	toneTraceId: TONE_TRACE_ID,
	detailTraceId: DETAIL_TRACE_ID,
	toneVariant: 'brief_tone_casual',
	detailVariant: 'brief_detail_low',
	feedback: null,
	generatedAt: new Date('2026-02-23T08:00:00Z'),
};

describe('brief actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubEnv('WORKER_URL', 'http://localhost:3001');
		vi.stubEnv('WORKER_INTERNAL_SECRET', 'test-secret');
		mockGetWorkspaceEnvelope.mockResolvedValue(MOCK_ENVELOPE);
		mockUpdateBriefFeedback.mockResolvedValue(undefined);
		mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
	});

	describe('getLatestBriefAction', () => {
		it('returns latest brief for authenticated user', async () => {
			const { getLatestBriefAction } = await import('@/app/actions/brief');

			mockGetLatestBrief.mockResolvedValue(MOCK_BRIEF);

			const result = await getLatestBriefAction({});

			expect(result?.data).toBeDefined();
			expect(result?.data?.id).toBe(BRIEF_ID);
			expect(result?.data?.content).toBe('Good morning! Here is your brief for Monday.');
			expect(mockGetLatestBrief).toHaveBeenCalledWith(WORKSPACE_ID, 'user-1', MOCK_ENVELOPE);
		});

		it('returns null when no brief exists yet', async () => {
			const { getLatestBriefAction } = await import('@/app/actions/brief');

			mockGetLatestBrief.mockResolvedValue(null);

			const result = await getLatestBriefAction({});

			expect(result?.data).toBeNull();
		});
	});

	describe('submitBriefFeedbackAction', () => {
		it('sends reward 1.0 and updates DB for helpful reaction', async () => {
			const { submitBriefFeedbackAction } = await import('@/app/actions/brief');

			const result = await submitBriefFeedbackAction({
				briefId: BRIEF_ID,
				reaction: 'helpful',
				toneTraceId: TONE_TRACE_ID,
				detailTraceId: DETAIL_TRACE_ID,
			});

			expect(result?.data).toEqual({ success: true });
			expect(mockUpdateBriefFeedback).toHaveBeenCalledWith(BRIEF_ID, WORKSPACE_ID, true);

			const calls = mockFetch.mock.calls;
			expect(calls).toHaveLength(2);
			for (const [, init] of calls) {
				const body = JSON.parse(init.body);
				expect(body.rewardScore).toBe(1.0);
			}
			const traceIds = calls.map(([, init]) => JSON.parse(init.body).traceId);
			expect(traceIds).toContain(TONE_TRACE_ID);
			expect(traceIds).toContain(DETAIL_TRACE_ID);
		});

		it('sends reward 0.0 and updates DB for not_helpful reaction', async () => {
			const { submitBriefFeedbackAction } = await import('@/app/actions/brief');

			const result = await submitBriefFeedbackAction({
				briefId: BRIEF_ID,
				reaction: 'not_helpful',
				toneTraceId: TONE_TRACE_ID,
				detailTraceId: DETAIL_TRACE_ID,
			});

			expect(result?.data).toEqual({ success: true });
			expect(mockUpdateBriefFeedback).toHaveBeenCalledWith(BRIEF_ID, WORKSPACE_ID, false);

			const calls = mockFetch.mock.calls;
			for (const [, init] of calls) {
				const body = JSON.parse(init.body);
				expect(body.rewardScore).toBe(0.0);
			}
		});

		it('sends X-Internal-Secret header to worker', async () => {
			const { submitBriefFeedbackAction } = await import('@/app/actions/brief');

			await submitBriefFeedbackAction({
				briefId: BRIEF_ID,
				reaction: 'helpful',
				toneTraceId: TONE_TRACE_ID,
				detailTraceId: DETAIL_TRACE_ID,
			});

			for (const [, init] of mockFetch.mock.calls) {
				expect(init.headers['X-Internal-Secret']).toBe('test-secret');
			}
		});

		it('rejects invalid reaction enum', async () => {
			const { submitBriefFeedbackAction } = await import('@/app/actions/brief');

			const result = await submitBriefFeedbackAction({
				briefId: BRIEF_ID,
				reaction: 'maybe' as 'helpful',
				toneTraceId: TONE_TRACE_ID,
				detailTraceId: DETAIL_TRACE_ID,
			});

			expect(result?.validationErrors).toBeDefined();
		});

		it('rejects non-uuid briefId', async () => {
			const { submitBriefFeedbackAction } = await import('@/app/actions/brief');

			const result = await submitBriefFeedbackAction({
				briefId: 'not-a-uuid',
				reaction: 'helpful',
				toneTraceId: TONE_TRACE_ID,
				detailTraceId: DETAIL_TRACE_ID,
			});

			expect(result?.validationErrors).toBeDefined();
		});

		it('throws when WORKER_URL is not configured', async () => {
			const { submitBriefFeedbackAction } = await import('@/app/actions/brief');

			vi.stubEnv('WORKER_URL', '');

			const result = await submitBriefFeedbackAction({
				briefId: BRIEF_ID,
				reaction: 'helpful',
				toneTraceId: TONE_TRACE_ID,
				detailTraceId: DETAIL_TRACE_ID,
			});

			expect(result?.serverError).toBeDefined();
		});

		// SPR-020-BUG: DB feedback must persist even if bandit worker calls fail
		it('succeeds and persists DB feedback even when worker fetch rejects', async () => {
			const { submitBriefFeedbackAction } = await import('@/app/actions/brief');

			mockFetch.mockRejectedValue(new Error('worker unreachable'));

			const result = await submitBriefFeedbackAction({
				briefId: BRIEF_ID,
				reaction: 'helpful',
				toneTraceId: TONE_TRACE_ID,
				detailTraceId: DETAIL_TRACE_ID,
			});

			// Action still returns success — DB write is the source of truth
			expect(result?.data).toEqual({ success: true });
			// DB feedback was persisted before the fetch calls
			expect(mockUpdateBriefFeedback).toHaveBeenCalledWith(BRIEF_ID, WORKSPACE_ID, true);
		});
	});
});
