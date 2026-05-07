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

vi.mock('@/lib/workspace', () => ({
	getUserWorkspaceId: vi.fn(() => Promise.resolve(WORKSPACE_ID)),
	getWorkspaceEnvelope: vi.fn(() =>
		Promise.resolve({
			encryptedWrk: Buffer.from('mock'),
			kmsContext: { WorkspaceID: 'mock' },
			wrkVersion: 1,
		}),
	),
}));

// Mock DAL functions
const mockGetPreferences = vi.fn();
const mockUpsertPreferences = vi.fn();

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	getPreferences: mockGetPreferences,
	upsertPreferences: mockUpsertPreferences,
}));

describe('preferences actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('getPreferencesAction', () => {
		it('returns preferences for authenticated user', async () => {
			const { getPreferencesAction } = await import('@/app/actions/preferences');

			mockGetPreferences.mockResolvedValue({
				timezone: 'America/New_York',
				briefEnabled: true,
				briefTime: 8,
				briefDays: ['mon', 'tue', 'wed'],
				digestFocus: 'commitments',
			});

			const result = await getPreferencesAction({});

			expect(result?.data).toBeDefined();
			expect(result?.data?.timezone).toBe('America/New_York');
			expect(mockGetPreferences).toHaveBeenCalledWith(WORKSPACE_ID, 'user-1');
		});
	});

	describe('updatePreferencesAction', () => {
		it('updates preferences with valid input', async () => {
			const { updatePreferencesAction } = await import('@/app/actions/preferences');

			mockUpsertPreferences.mockResolvedValue({
				timezone: 'Europe/London',
				briefEnabled: false,
				briefTime: 9,
				briefDays: ['mon', 'fri'],
				digestFocus: 'deals',
			});

			const result = await updatePreferencesAction({
				timezone: 'Europe/London',
				briefEnabled: false,
				briefTime: 9,
				briefDays: ['mon', 'fri'],
				digestFocus: 'deals',
			});

			expect(result?.data).toBeDefined();
			expect(result?.data?.timezone).toBe('Europe/London');
			expect(mockUpsertPreferences).toHaveBeenCalledWith(WORKSPACE_ID, 'user-1', {
				timezone: 'Europe/London',
				briefEnabled: false,
				briefTime: 9,
				briefDays: ['mon', 'fri'],
				digestFocus: 'deals',
			});
		});

		it('validates briefTime range (0-23)', async () => {
			const { updatePreferencesAction } = await import('@/app/actions/preferences');

			const result = await updatePreferencesAction({
				briefTime: 25,
			});

			expect(result?.validationErrors).toBeDefined();
		});

		it('validates briefDays values', async () => {
			const { updatePreferencesAction } = await import('@/app/actions/preferences');

			const result = await updatePreferencesAction({
				briefDays: ['monday'] as unknown as ('mon' | 'tue')[],
			});

			expect(result?.validationErrors).toBeDefined();
		});

		it('validates digestFocus values', async () => {
			const { updatePreferencesAction } = await import('@/app/actions/preferences');

			const result = await updatePreferencesAction({
				digestFocus: 'invalid' as 'balanced',
			});

			expect(result?.validationErrors).toBeDefined();
		});

		it('allows partial updates', async () => {
			const { updatePreferencesAction } = await import('@/app/actions/preferences');

			mockUpsertPreferences.mockResolvedValue({
				timezone: 'UTC',
				briefEnabled: true,
				briefTime: 7,
				briefDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
				digestFocus: 'relationships',
			});

			const result = await updatePreferencesAction({
				digestFocus: 'relationships',
			});

			expect(result?.data).toBeDefined();
			expect(mockUpsertPreferences).toHaveBeenCalledWith(WORKSPACE_ID, 'user-1', {
				digestFocus: 'relationships',
			});
		});
	});
});
