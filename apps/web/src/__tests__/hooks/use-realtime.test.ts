import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSubscribe = vi.fn(() => ({}));
const mockUnsubscribe = vi.fn();
const mockOn = vi.fn(function (
	this: unknown,
	_type: string,
	_opts: { event: string },
	_cb: () => void,
) {
	return this;
});
const mockChannel = {
	on: mockOn,
	subscribe: mockSubscribe,
	unsubscribe: mockUnsubscribe,
};
const mockSetAuth = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn(() => ({
		channel: vi.fn(() => mockChannel),
		realtime: { setAuth: mockSetAuth },
	})),
}));

vi.mock('@/app/actions/realtime', () => ({
	getRealtimeTokenAction: vi.fn(() => Promise.resolve({ data: { token: 'mock-jwt-token' } })),
}));

const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
	useRouter: vi.fn(() => ({
		refresh: mockRefresh,
		push: vi.fn(),
		replace: vi.fn(),
		back: vi.fn(),
		forward: vi.fn(),
		prefetch: vi.fn(),
	})),
}));

/** Flush all pending microtasks/promises */
async function flushPromises() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

describe('useRealtimeSync', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.test');
		vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
		mockOn.mockImplementation(function (this: unknown) {
			return this;
		});
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		cleanup();
	});

	it('skips token minting when Supabase Realtime client env is not configured', async () => {
		vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
		const { getRealtimeTokenAction } = await import('@/app/actions/realtime');
		const { useRealtimeSync } = await import('@/hooks/use-realtime');

		renderHook(() => useRealtimeSync('workspace-123'));
		await flushPromises();

		expect(getRealtimeTokenAction).not.toHaveBeenCalled();
		expect(mockSubscribe).not.toHaveBeenCalled();
	});

	it('fetches a realtime token and subscribes to private workspace channel', async () => {
		const { useRealtimeSync } = await import('@/hooks/use-realtime');

		renderHook(() => useRealtimeSync('workspace-123'));
		await flushPromises();

		expect(mockSetAuth).toHaveBeenCalledWith('mock-jwt-token');
		expect(mockOn).toHaveBeenCalledWith(
			'broadcast',
			{ event: 'telegram-sync-batch' },
			expect.any(Function),
		);
		expect(mockOn).toHaveBeenCalledWith(
			'broadcast',
			{ event: 'new-message' },
			expect.any(Function),
		);
		expect(mockSubscribe).toHaveBeenCalled();
	});

	it('unsubscribes on unmount', async () => {
		const { useRealtimeSync } = await import('@/hooks/use-realtime');

		const { unmount } = renderHook(() => useRealtimeSync('workspace-123'));
		await flushPromises();

		unmount();

		expect(mockUnsubscribe).toHaveBeenCalled();
	});

	it('calls router.refresh when telegram-sync-batch event fires', async () => {
		let syncCallback: (() => void) | undefined;
		mockOn.mockImplementation(function (
			this: unknown,
			_type: string,
			opts: { event: string },
			cb: () => void,
		) {
			if (opts.event === 'telegram-sync-batch') {
				syncCallback = cb;
			}
			return this;
		});

		const { useRealtimeSync } = await import('@/hooks/use-realtime');

		renderHook(() => useRealtimeSync('workspace-123'));
		await flushPromises();

		expect(syncCallback).toBeDefined();
		syncCallback?.();
		expect(mockRefresh).toHaveBeenCalled();
	});

	it('calls router.refresh when new-message event fires', async () => {
		let messageCallback: (() => void) | undefined;
		mockOn.mockImplementation(function (
			this: unknown,
			_type: string,
			opts: { event: string },
			cb: () => void,
		) {
			if (opts.event === 'new-message') {
				messageCallback = cb;
			}
			return this;
		});

		const { useRealtimeSync } = await import('@/hooks/use-realtime');

		renderHook(() => useRealtimeSync('workspace-123'));
		await flushPromises();

		expect(messageCallback).toBeDefined();
		messageCallback?.();
		expect(mockRefresh).toHaveBeenCalled();
	});
});
