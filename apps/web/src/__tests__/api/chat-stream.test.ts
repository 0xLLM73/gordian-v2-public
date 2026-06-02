import { _resetForTesting as resetRateLimit } from '@/lib/rate-limit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetSession = vi.fn();
const mockGetUserWorkspaceId = vi.fn();
const mockGetWorkspaceEnvelope = vi.fn();
const mockFetch = vi.fn();

vi.mock('next/headers', () => ({
	headers: vi.fn(() => Promise.resolve(new Headers())),
}));

vi.mock('@/lib/auth', () => ({
	auth: {
		api: { getSession: (...args: unknown[]) => mockGetSession(...args) },
	},
}));

vi.mock('@/lib/workspace', () => ({
	getUserWorkspaceId: (...args: unknown[]) => mockGetUserWorkspaceId(...args),
	getWorkspaceEnvelope: (...args: unknown[]) => mockGetWorkspaceEnvelope(...args),
}));

vi.stubGlobal('fetch', (...args: unknown[]) => mockFetch(...args));

describe('POST /api/chat/stream', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetRateLimit();
		vi.stubEnv('WORKER_INTERNAL_SECRET', 'test-secret');
		mockGetSession.mockResolvedValue({ user: { id: 'user-1' } });
		mockGetUserWorkspaceId.mockResolvedValue('workspace-1');
		mockGetWorkspaceEnvelope.mockResolvedValue({
			encryptedWrk: Buffer.from('mock'),
			kmsContext: { workspaceId: 'workspace-1' },
			wrkVersion: 1,
		});
	});

	it('preserves AI consent errors from the worker stream route', async () => {
		mockFetch.mockResolvedValue(
			Response.json({ error: 'AI analysis consent is required.' }, { status: 403 }),
		);

		const { POST } = await import('@/app/api/chat/stream/route');
		const response = await POST(
			new Request('http://localhost/api/chat/stream', {
				method: 'POST',
				body: JSON.stringify({
					messages: [{ role: 'user', content: 'Hello' }],
				}),
			}),
		);

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toEqual({
			error: 'AI analysis consent is required.',
		});
	});

	it('keeps non-consent worker failures generic', async () => {
		mockFetch.mockResolvedValue(
			Response.json({ error: 'Internal worker detail' }, { status: 500 }),
		);

		const { POST } = await import('@/app/api/chat/stream/route');
		const response = await POST(
			new Request('http://localhost/api/chat/stream', {
				method: 'POST',
				body: JSON.stringify({
					messages: [{ role: 'user', content: 'Hello' }],
				}),
			}),
		);

		expect(response.status).toBe(500);
		await expect(response.json()).resolves.toEqual({
			error: 'Chat service unavailable',
		});
	});
});
