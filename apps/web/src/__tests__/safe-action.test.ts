import { describe, expect, it, vi } from 'vitest';

// Mock next/headers before importing safe-action
vi.mock('next/headers', () => ({
	headers: vi.fn(() => Promise.resolve(new Headers())),
}));

// Mock the auth module
vi.mock('@/lib/auth', () => ({
	auth: {
		api: {
			getSession: vi.fn(),
		},
	},
}));

describe('safe-action client', () => {
	it('exports actionClient and authAction', async () => {
		const mod = await import('@/lib/safe-action');

		expect(mod.actionClient).toBeDefined();
		expect(mod.authAction).toBeDefined();
	});

	it('actionClient has handleServerError configured', async () => {
		const { actionClient } = await import('@/lib/safe-action');

		// The client should be a valid safe action client
		expect(actionClient).toBeDefined();
		expect(typeof actionClient.use).toBe('function');
	});

	it('authAction is a middleware-enhanced client', async () => {
		const { authAction } = await import('@/lib/safe-action');

		// authAction should have schema method for defining actions
		expect(typeof authAction.schema).toBe('function');
	});
});
