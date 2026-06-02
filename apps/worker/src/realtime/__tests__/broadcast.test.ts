import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.fn(() => Promise.resolve());
const mockRemoveChannel = vi.fn();
const mockChannel = vi.fn(() => ({ send: mockSend }));

vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn(() => ({
		channel: mockChannel,
		removeChannel: mockRemoveChannel,
	})),
}));

describe('broadcastContactUpdate (SEC-027)', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
		vi.stubEnv('SUPABASE_SERVICE_KEY', 'test-service-key');
		mockChannel.mockReturnValue({ send: mockSend });
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('sends only contact ID — no names or PII', async () => {
		const { broadcastContactUpdate } = await import('../broadcast');

		await broadcastContactUpdate('ws-1', 'contact-abc');

		expect(mockSend).toHaveBeenCalledWith(
			expect.objectContaining({
				event: 'contact-updated',
			}),
		);

		// Exact shape assertion — any new field added to the payload will fail this test,
		// forcing a conscious review of what is safe to broadcast (SEC-027)
		const call = (mockSend.mock.calls as unknown[][])[0][0] as {
			payload: Record<string, unknown>;
		};
		expect(call.payload).toEqual({ id: expect.any(String) });
	});

	it('no-ops without Supabase config in local mode', async () => {
		vi.unstubAllEnvs();
		vi.stubEnv('NODE_ENV', 'development');
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { broadcastSyncComplete } = await import('../broadcast');

		await expect(
			broadcastSyncComplete('ws-1', { newMessages: 0, newContacts: 0 }),
		).resolves.toBeUndefined();

		expect(mockSend).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledWith(
			'[realtime] Supabase Realtime is not configured; broadcasts disabled locally.',
		);
		warn.mockRestore();
	});

	it('fails closed without Supabase config in hosted production', async () => {
		vi.unstubAllEnvs();
		vi.stubEnv('NODE_ENV', 'production');
		const { broadcastSyncComplete } = await import('../broadcast');

		await expect(broadcastSyncComplete('ws-1', { newMessages: 0, newContacts: 0 })).rejects.toThrow(
			/SUPABASE_URL and SUPABASE_SERVICE_KEY/,
		);
	});
});
