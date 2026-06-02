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

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	trackBehavior: vi.fn().mockResolvedValue(null),
}));

// Mock global fetch for worker endpoint calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('chat actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubEnv('WORKER_URL', 'http://localhost:3001');
		vi.stubEnv('WORKER_INTERNAL_SECRET', 'test-secret');
		mockGetWorkspaceEnvelope.mockResolvedValue(MOCK_ENVELOPE);
	});

	describe('sendChatMessageAction', () => {
		it('calls worker /chat with correct payload', async () => {
			const { sendChatMessageAction } = await import('@/app/actions/chat');

			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ response: 'Hello!', toolsUsed: ['search_contacts'] }),
			});

			const result = await sendChatMessageAction({
				messages: [{ role: 'user', content: 'Who is my top contact?' }],
			});

			expect(result?.data).toEqual({ response: 'Hello!', toolsUsed: ['search_contacts'] });
			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:3001/chat',
				expect.objectContaining({
					method: 'POST',
					headers: expect.objectContaining({
						'Content-Type': 'application/json',
						'X-Internal-Secret': 'test-secret',
					}),
					body: expect.stringContaining('"workspaceId"'),
				}),
			);

			const body = JSON.parse(mockFetch.mock.calls[0][1].body);
			expect(body.userId).toBe('user-1');
			expect(body.workspaceId).toBe(WORKSPACE_ID);
			expect(body.messages).toEqual([{ role: 'user', content: 'Who is my top contact?' }]);
			expect(body.envelope).toBeDefined();
			expect(typeof body.envelope.encryptedWrk).toBe('string'); // base64 serialized
		});

		it('returns serverError when worker responds with non-OK status', async () => {
			const { sendChatMessageAction } = await import('@/app/actions/chat');

			mockFetch.mockResolvedValue({ ok: false, status: 503 });

			const result = await sendChatMessageAction({
				messages: [{ role: 'user', content: 'Hello' }],
			});

			expect(result?.serverError).toBeDefined();
		});

		it('preserves AI consent errors from the worker', async () => {
			const { sendChatMessageAction } = await import('@/app/actions/chat');

			mockFetch.mockResolvedValue({
				ok: false,
				status: 403,
				json: () => Promise.resolve({ error: 'AI analysis consent is required.' }),
			});

			const result = await sendChatMessageAction({
				messages: [{ role: 'user', content: 'Hello' }],
			});

			expect(result?.serverError).toBe('AI analysis consent is required.');
		});

		it('validates messages schema — rejects empty array', async () => {
			const { sendChatMessageAction } = await import('@/app/actions/chat');

			const result = await sendChatMessageAction({
				messages: [],
			});

			expect(result?.validationErrors).toBeDefined();
		});
	});

	describe('ASA-010 — WORKER_URL must be configured', () => {
		it('returns serverError when WORKER_URL is not set', async () => {
			const saved = process.env.WORKER_URL;
			vi.stubEnv('WORKER_URL', '');
			try {
				const { sendChatMessageAction } = await import('@/app/actions/chat');
				const result = await sendChatMessageAction({
					messages: [{ role: 'user', content: 'Hello' }],
				});
				expect(result?.serverError).toBeDefined();
			} finally {
				if (saved !== undefined) vi.stubEnv('WORKER_URL', saved);
			}
		});
	});
});
