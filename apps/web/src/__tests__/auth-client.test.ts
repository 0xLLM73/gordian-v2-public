import { describe, expect, it, vi } from 'vitest';

vi.mock('better-auth/react', () => ({
	createAuthClient: vi.fn((config: { baseURL: string }) => ({
		signIn: { email: vi.fn() },
		signUp: { email: vi.fn() },
		signOut: vi.fn(),
		useSession: vi.fn(),
		getSession: vi.fn(),
		_config: config,
	})),
}));

describe('auth-client', () => {
	it('exports authClient', async () => {
		const { authClient } = await import('@/lib/auth-client');

		expect(authClient).toBeDefined();
	});

	it('has signIn.email method', async () => {
		const { authClient } = await import('@/lib/auth-client');

		expect(authClient.signIn).toBeDefined();
		expect(authClient.signIn.email).toBeDefined();
	});

	it('has signUp.email method', async () => {
		const { authClient } = await import('@/lib/auth-client');

		expect(authClient.signUp).toBeDefined();
		expect(authClient.signUp.email).toBeDefined();
	});
});
