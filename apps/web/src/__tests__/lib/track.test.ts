import { describe, expect, it, vi } from 'vitest';

const mockTrackBehavior = vi.fn();
const mockHasAnalyticsConsent = vi.fn();

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	trackBehavior: (...args: unknown[]) => mockTrackBehavior(...args),
	hasAnalyticsConsent: (...args: unknown[]) => mockHasAnalyticsConsent(...args),
}));

describe('track utility', () => {
	it('calls trackBehavior when user has consent', async () => {
		mockTrackBehavior.mockResolvedValue({ id: 'b-1' });
		mockHasAnalyticsConsent.mockResolvedValue(true);

		const { track } = await import('../../lib/track');
		track('ws-1', 'user-1', 'view_contact', { contactId: 'c-1' });

		// Fire-and-forget — give microtask queue time to flush
		await new Promise((r) => setTimeout(r, 10));

		expect(mockHasAnalyticsConsent).toHaveBeenCalledWith('user-1', 'ws-1');
		expect(mockTrackBehavior).toHaveBeenCalledWith('ws-1', 'user-1', 'view_contact', {
			contactId: 'c-1',
		});
	});

	it('skips trackBehavior when user has not consented', async () => {
		mockTrackBehavior.mockClear();
		mockHasAnalyticsConsent.mockResolvedValue(false);

		const { track } = await import('../../lib/track');
		track('ws-1', 'user-1', 'view_contact', { contactId: 'c-1' });

		await new Promise((r) => setTimeout(r, 10));

		expect(mockHasAnalyticsConsent).toHaveBeenCalledWith('user-1', 'ws-1');
		expect(mockTrackBehavior).not.toHaveBeenCalled();
	});

	it('does not throw when DAL fails', async () => {
		mockHasAnalyticsConsent.mockResolvedValue(true);
		mockTrackBehavior.mockRejectedValue(new Error('DB down'));

		const { track } = await import('../../lib/track');

		// Should not throw
		expect(() => track('ws-1', 'user-1', 'broken_event')).not.toThrow();
	});

	it('does not throw when consent check fails', async () => {
		mockHasAnalyticsConsent.mockRejectedValue(new Error('DB down'));

		const { track } = await import('../../lib/track');

		expect(() => track('ws-1', 'user-1', 'broken_event')).not.toThrow();
	});
});
