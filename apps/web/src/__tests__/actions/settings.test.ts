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

vi.mock('@/lib/rate-limit', () => ({
	checkRateLimit: vi.fn(() => ({ allowed: true, retryAfterMs: 0 })),
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
const mockSelectWhere = vi.fn().mockResolvedValue([]);
const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));
const mockDeleteSessionKek = vi.fn(() => Promise.resolve());
const mockDeleteUserAccountOnly = vi.fn(() => Promise.resolve());
const mockDeleteAccountData = vi.fn(() => Promise.resolve());
const mockIsWorkspaceOwner = vi.fn(() => Promise.resolve(false));
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('@repo/crypto', () => ({
	deleteSessionKek: mockDeleteSessionKek,
}));

vi.mock('@/lib/workspace-authz', () => ({
	isWorkspaceOwner: mockIsWorkspaceOwner,
}));

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	upsertPreferences: mockUpsertPreferences,
	deleteUserAccountOnly: mockDeleteUserAccountOnly,
	deleteAccountData: mockDeleteAccountData,
	db: { delete: mockDelete, select: mockSelect },
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
		mockSelect.mockReturnValue({ from: mockSelectFrom });
		mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
		mockSelectWhere.mockResolvedValue([]);
		mockDeleteSessionKek.mockResolvedValue(undefined);
		mockDeleteUserAccountOnly.mockResolvedValue(undefined);
		mockDeleteAccountData.mockResolvedValue(undefined);
		mockIsWorkspaceOwner.mockResolvedValue(false);
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
			mockSelectWhere.mockResolvedValue([{ sessionKekEncrypted: Buffer.from('kek-marker') }]);

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
			expect(mockDeleteSessionKek).toHaveBeenCalledWith('user-1', Buffer.from('kek-marker'));
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

	describe('deleteAccountAction', () => {
		it('cleans runtime state and deletes only the user account for non-owner workspace members', async () => {
			const { deleteAccountAction } = await import('@/app/actions/settings');
			mockSelectWhere.mockResolvedValueOnce([{ sessionKekEncrypted: Buffer.from('kek-marker') }]);

			const result = await deleteAccountAction({ confirmation: 'DELETE' });

			expect(result?.data?.deleted).toBe(true);
			expect(mockIsWorkspaceOwner).toHaveBeenCalledWith(WORKSPACE_ID, 'user-1');
			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:3001/telegram/disconnect-session',
				expect.objectContaining({
					method: 'POST',
					body: JSON.stringify({ userId: 'user-1' }),
				}),
			);
			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:3001/runtime/cleanup-deletion',
				expect.objectContaining({
					method: 'POST',
					headers: expect.objectContaining({
						'X-Internal-Secret': 'test-secret',
					}),
					body: JSON.stringify({ userId: 'user-1', workspaceId: WORKSPACE_ID }),
				}),
			);
			expect(mockDeleteSessionKek).toHaveBeenCalledWith('user-1', Buffer.from('kek-marker'));
			expect(mockDeleteUserAccountOnly).toHaveBeenCalledWith('user-1');
			expect(mockDeleteAccountData).not.toHaveBeenCalled();
		});

		it('still deletes the user account when runtime cleanup fails', async () => {
			mockFetch
				.mockResolvedValueOnce({ ok: true })
				.mockRejectedValueOnce(new Error('worker unavailable'));
			const { deleteAccountAction } = await import('@/app/actions/settings');

			const result = await deleteAccountAction({ confirmation: 'DELETE' });

			expect(result?.data?.deleted).toBe(true);
			expect(mockDeleteUserAccountOnly).toHaveBeenCalledWith('user-1');
			expect(mockDeleteAccountData).not.toHaveBeenCalled();
		});

		it('denies account-only deletion for workspace owners', async () => {
			const { deleteAccountAction } = await import('@/app/actions/settings');
			mockIsWorkspaceOwner.mockResolvedValueOnce(true);

			const result = await deleteAccountAction({ confirmation: 'DELETE' });

			expect(result?.serverError).toBe(
				'Workspace owners must delete the workspace explicitly before deleting their user account',
			);
			expect(mockFetch).not.toHaveBeenCalled();
			expect(mockDeleteUserAccountOnly).not.toHaveBeenCalled();
			expect(mockDeleteAccountData).not.toHaveBeenCalled();
		});
	});

	describe('deleteWorkspaceAction', () => {
		it('requires workspace ownership before deleting workspace data', async () => {
			const { deleteWorkspaceAction } = await import('@/app/actions/settings');
			mockIsWorkspaceOwner.mockResolvedValueOnce(false);

			const result = await deleteWorkspaceAction({ confirmation: 'DELETE WORKSPACE' });

			expect(result?.serverError).toBe('Unauthorized');
			expect(mockFetch).not.toHaveBeenCalled();
			expect(mockDeleteAccountData).not.toHaveBeenCalled();
		});

		it('cleans runtime state and deletes workspace data for owners only', async () => {
			const { deleteWorkspaceAction } = await import('@/app/actions/settings');
			mockIsWorkspaceOwner.mockResolvedValueOnce(true);
			mockSelectWhere.mockResolvedValueOnce([{ sessionKekEncrypted: Buffer.from('kek-marker') }]);

			const result = await deleteWorkspaceAction({ confirmation: 'DELETE WORKSPACE' });

			expect(result?.data?.deleted).toBe(true);
			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:3001/telegram/disconnect-session',
				expect.objectContaining({
					method: 'POST',
					body: JSON.stringify({ userId: 'user-1' }),
				}),
			);
			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:3001/runtime/cleanup-deletion',
				expect.objectContaining({
					method: 'POST',
					headers: expect.objectContaining({
						'X-Internal-Secret': 'test-secret',
					}),
					body: JSON.stringify({ userId: 'user-1', workspaceId: WORKSPACE_ID }),
				}),
			);
			expect(mockDeleteSessionKek).toHaveBeenCalledWith('user-1', Buffer.from('kek-marker'));
			expect(mockDeleteAccountData).toHaveBeenCalledWith(WORKSPACE_ID, 'user-1');
			expect(mockDeleteUserAccountOnly).not.toHaveBeenCalled();
		});

		it('still deletes workspace data when runtime cleanup fails', async () => {
			const { deleteWorkspaceAction } = await import('@/app/actions/settings');
			mockIsWorkspaceOwner.mockResolvedValueOnce(true);
			mockFetch
				.mockResolvedValueOnce({ ok: true })
				.mockRejectedValueOnce(new Error('worker unavailable'));

			const result = await deleteWorkspaceAction({ confirmation: 'DELETE WORKSPACE' });

			expect(result?.data?.deleted).toBe(true);
			expect(mockDeleteAccountData).toHaveBeenCalledWith(WORKSPACE_ID, 'user-1');
		});
	});
});
