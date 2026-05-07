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
const CONTACT_ID = '660e8400-e29b-41d4-a716-446655440001';
const DRAFT_ID = '770e8400-e29b-41d4-a716-446655440002';
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
const mockGetContact = vi.fn();
const mockGetLatestSummary = vi.fn();
const mockGetRecentMessages = vi.fn();
const mockCreateDraftLog = vi.fn();
const mockMarkDraftSent = vi.fn();
const mockMarkDraftDiscarded = vi.fn();

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	getContact: mockGetContact,
	getLatestSummary: mockGetLatestSummary,
	getRecentMessages: mockGetRecentMessages,
	createDraftLog: mockCreateDraftLog,
	markDraftSent: mockMarkDraftSent,
	markDraftDiscarded: mockMarkDraftDiscarded,
	getVoiceProfile: vi.fn().mockResolvedValue(null),
	markCalibrationComplete: vi.fn().mockResolvedValue(null),
	trackBehavior: vi.fn().mockResolvedValue(null),
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('draft actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubEnv('WORKER_URL', 'http://localhost:3001');
		vi.stubEnv('WORKER_INTERNAL_SECRET', 'test-secret');
		mockGetWorkspaceEnvelope.mockResolvedValue(MOCK_ENVELOPE);
		mockGetContact.mockResolvedValue({ firstName: 'Alice', lastName: 'Smith' });
		mockGetLatestSummary.mockResolvedValue({ summary: 'Great relationship' });
		mockGetRecentMessages.mockResolvedValue([{ content: 'Hello' }, { content: 'How are you?' }]);
		mockCreateDraftLog.mockResolvedValue({ id: DRAFT_ID });
	});

	describe('generateDraftAction', () => {
		it('calls worker /draft/generate with correct payload and stores draft log', async () => {
			const { generateDraftAction } = await import('@/app/actions/drafts');

			mockFetch.mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({
						text: 'Hey Alice!',
						armType: 'casual_nudge',
						traceId: 'trace-123',
						styleProfileVersion: 2,
					}),
			});

			const result = await generateDraftAction({ contactId: CONTACT_ID });

			expect(result?.data).toEqual({
				draftId: DRAFT_ID,
				text: 'Hey Alice!',
				armType: 'casual_nudge',
				traceId: 'trace-123',
			});

			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:3001/draft/generate',
				expect.objectContaining({
					method: 'POST',
					headers: expect.objectContaining({
						'Content-Type': 'application/json',
						'X-Internal-Secret': 'test-secret',
					}),
				}),
			);

			const body = JSON.parse(mockFetch.mock.calls[0][1].body);
			expect(body.userId).toBe('user-1');
			expect(body.workspaceId).toBe(WORKSPACE_ID);
			expect(body.contactId).toBe(CONTACT_ID);
			expect(body.contactSummary).toContain('Alice Smith');
			expect(mockCreateDraftLog).toHaveBeenCalledWith(
				WORKSPACE_ID,
				CONTACT_ID,
				'casual_nudge',
				'Hey Alice!',
				MOCK_ENVELOPE,
				2,
			);
		});

		it('[LOW-3] validates styleProfileVersion — non-number becomes null', async () => {
			const { generateDraftAction } = await import('@/app/actions/drafts');

			mockFetch.mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({
						text: 'Hey!',
						armType: 'direct_ask',
						traceId: 'trace-456',
						styleProfileVersion: 'not-a-number',
					}),
			});

			await generateDraftAction({ contactId: CONTACT_ID });

			expect(mockCreateDraftLog).toHaveBeenCalledWith(
				WORKSPACE_ID,
				CONTACT_ID,
				'direct_ask',
				'Hey!',
				MOCK_ENVELOPE,
				null,
			);
		});
	});

	describe('sendDraftAction', () => {
		it('calls markDraftSent and sends reward to feedback endpoint', async () => {
			const { sendDraftAction } = await import('@/app/actions/drafts');

			mockMarkDraftSent.mockResolvedValue(undefined);
			mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

			const result = await sendDraftAction({
				draftId: DRAFT_ID,
				editedText: 'Hey Alice, how are you?',
				originalText: 'Hey Alice!',
				traceId: 'trace-123',
			});

			expect(result?.data).toEqual({ sent: true });
			expect(mockMarkDraftSent).toHaveBeenCalledWith(
				WORKSPACE_ID,
				DRAFT_ID,
				'Hey Alice, how are you?',
				expect.any(Number),
				MOCK_ENVELOPE,
			);

			// Reward call
			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:3001/feedback/reward',
				expect.objectContaining({ method: 'POST' }),
			);
			const rewardBody = JSON.parse(mockFetch.mock.calls[0][1].body);
			expect(rewardBody.traceId).toBe('trace-123');
			expect(rewardBody.rewardScore).toBeGreaterThanOrEqual(0.3);
		});
	});

	describe('discardDraftAction', () => {
		it('calls markDraftDiscarded and sends low reward (0.2)', async () => {
			const { discardDraftAction } = await import('@/app/actions/drafts');

			mockMarkDraftDiscarded.mockResolvedValue(undefined);
			mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

			const result = await discardDraftAction({ draftId: DRAFT_ID, traceId: 'trace-456' });

			expect(result?.data).toEqual({ discarded: true });
			expect(mockMarkDraftDiscarded).toHaveBeenCalledWith(WORKSPACE_ID, DRAFT_ID);

			const rewardBody = JSON.parse(mockFetch.mock.calls[0][1].body);
			expect(rewardBody.traceId).toBe('trace-456');
			expect(rewardBody.rewardScore).toBe(0.2);
		});
	});

	describe('ASA-010 — WORKER_URL must be configured', () => {
		it('returns serverError for discardDraftAction when WORKER_URL is not set', async () => {
			// discardDraftAction calls markDraftDiscarded then checks WORKER_URL —
			// simpler to reach the guard than generateDraftAction (which needs DB for context).
			mockMarkDraftDiscarded.mockResolvedValue(undefined);
			const saved = process.env.WORKER_URL;
			vi.stubEnv('WORKER_URL', '');
			try {
				const { discardDraftAction } = await import('@/app/actions/drafts');
				const result = await discardDraftAction({ draftId: DRAFT_ID, traceId: 'trace-asa010' });
				expect(result?.serverError).toBeDefined();
			} finally {
				if (saved !== undefined) vi.stubEnv('WORKER_URL', saved);
			}
		});
	});
});
