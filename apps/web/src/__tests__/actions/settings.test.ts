import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
	headers: vi.fn(() => Promise.resolve(new Headers())),
}));

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

const mockUpsertPreferences = vi.fn(() => Promise.resolve({ success: true }));
const mockDeleteWhere = vi.fn().mockResolvedValue([]);
const mockDelete = vi.fn(() => ({ where: mockDeleteWhere }));
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	upsertPreferences: mockUpsertPreferences,
	db: { delete: mockDelete },
	accounts: {},
	eq: vi.fn(),
	and: vi.fn(),
}));

describe('settings actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubEnv('WORKER_URL', 'http://localhost:3001');
		vi.stubEnv('WORKER_INTERNAL_SECRET', 'test-secret');
		mockDelete.mockReturnValue({ where: mockDeleteWhere });
		mockFetch.mockResolvedValue({ ok: true });
	});

	describe('updateBriefScheduleAction', () => {
		it('persists brief time, timezone, and days', async () => {
			const { updateBriefScheduleAction } = await import('@/app/actions/settings');
			const result = await updateBriefScheduleAction({
				briefTime: 7,
				timezone: 'America/New_York',
				briefDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
			});
			expect(result?.data?.success).toBe(true);
			expect(mockUpsertPreferences).toHaveBeenCalledWith(
				WORKSPACE_ID,
				'user-1',
				expect.objectContaining({
					briefTime: 7,
					timezone: 'America/New_York',
					briefDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
				}),
			);
		});

		it('rejects briefTime outside 0-23', async () => {
			const { updateBriefScheduleAction } = await import('@/app/actions/settings');
			const result = await updateBriefScheduleAction({
				briefTime: 24,
				timezone: 'UTC',
				briefDays: ['mon'],
			});
			expect(result?.validationErrors).toBeDefined();
		});

		it('rejects empty briefDays array', async () => {
			const { updateBriefScheduleAction } = await import('@/app/actions/settings');
			const result = await updateBriefScheduleAction({
				briefTime: 8,
				timezone: 'UTC',
				briefDays: [],
			});
			expect(result?.validationErrors).toBeDefined();
		});

		it('rejects invalid day values', async () => {
			const { updateBriefScheduleAction } = await import('@/app/actions/settings');
			const result = await updateBriefScheduleAction({
				briefTime: 8,
				timezone: 'UTC',
				briefDays: ['monday'] as unknown as ['mon'],
			});
			expect(result?.validationErrors).toBeDefined();
		});

		it('rejects empty timezone', async () => {
			const { updateBriefScheduleAction } = await import('@/app/actions/settings');
			const result = await updateBriefScheduleAction({
				briefTime: 8,
				timezone: '',
				briefDays: ['mon'],
			});
			expect(result?.validationErrors).toBeDefined();
		});
	});

	describe('disconnectTelegramAction', () => {
		it('calls worker disconnect endpoint and deletes account row', async () => {
			const { disconnectTelegramAction } = await import('@/app/actions/settings');

			mockFetch.mockResolvedValue({ ok: true });

			const result = await disconnectTelegramAction({});

			expect(result?.data?.disconnected).toBe(true);
			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:3001/telegram/disconnect-session',
				expect.objectContaining({
					method: 'POST',
					headers: expect.objectContaining({
						'Content-Type': 'application/json',
						'X-Internal-Secret': 'test-secret',
					}),
					body: JSON.stringify({ userId: 'user-1' }),
				}),
			);
			expect(mockDelete).toHaveBeenCalled();
			expect(mockDeleteWhere).toHaveBeenCalled();
		});

		it('returns serverError when worker responds with non-OK status', async () => {
			const { disconnectTelegramAction } = await import('@/app/actions/settings');

			mockFetch.mockResolvedValue({ ok: false, status: 503 });

			const result = await disconnectTelegramAction({});

			expect(result?.serverError).toBeDefined();
			expect(mockDelete).not.toHaveBeenCalled();
		});
	});

	describe('updateNotificationsAction', () => {
		it('persists briefEnabled true', async () => {
			const { updateNotificationsAction } = await import('@/app/actions/settings');
			const result = await updateNotificationsAction({ briefEnabled: true });
			expect(result?.data?.success).toBe(true);
			expect(mockUpsertPreferences).toHaveBeenCalledWith(WORKSPACE_ID, 'user-1', {
				briefEnabled: true,
			});
		});

		it('persists briefEnabled false', async () => {
			const { updateNotificationsAction } = await import('@/app/actions/settings');
			const result = await updateNotificationsAction({ briefEnabled: false });
			expect(result?.data?.success).toBe(true);
			expect(mockUpsertPreferences).toHaveBeenCalledWith(WORKSPACE_ID, 'user-1', {
				briefEnabled: false,
			});
		});
	});

	describe('ASA-010 — WORKER_URL must be configured', () => {
		it('returns serverError for disconnectTelegramAction when WORKER_URL is not set', async () => {
			const saved = process.env.WORKER_URL;
			vi.stubEnv('WORKER_URL', '');
			try {
				const { disconnectTelegramAction } = await import('@/app/actions/settings');
				const result = await disconnectTelegramAction({});
				expect(result?.serverError).toBeDefined();
			} finally {
				if (saved !== undefined) vi.stubEnv('WORKER_URL', saved);
			}
		});
	});
});
