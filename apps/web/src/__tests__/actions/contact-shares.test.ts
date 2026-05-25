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
const CONTACT_ID = '550e8400-e29b-41d4-a716-446655440001';
const TARGET_USER = '550e8400-e29b-41d4-a716-446655440002';

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

const mockShare = vi.fn(() => Promise.resolve({ id: 'share-1' }));
const mockUnshare = vi.fn(() => Promise.resolve());
const mockGetShares = vi.fn(() =>
	Promise.resolve([{ id: 'share-1', sharedWithUserId: TARGET_USER }]),
);
const mockGetAccounts = vi.fn(() => Promise.resolve(['tg123456', 'tg654321']));
const mockCanManageContact = vi.fn(() => Promise.resolve(true));

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	canManageContact: mockCanManageContact,
	shareContact: mockShare,
	unshareContact: mockUnshare,
	getContactShares: mockGetShares,
	getUserTelegramAccountIds: mockGetAccounts,
}));

describe('contact-shares actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('shareContactAction', () => {
		it('calls shareContact DAL with correct arguments', async () => {
			const { shareContactAction } = await import('@/app/actions/contact-shares');

			const result = await shareContactAction({
				contactId: CONTACT_ID,
				targetUserId: TARGET_USER,
			});

			expect(result?.data).toBeDefined();
			expect(mockCanManageContact).toHaveBeenCalledWith(WORKSPACE_ID, 'user-1', CONTACT_ID);
			expect(mockShare).toHaveBeenCalledWith(
				WORKSPACE_ID,
				CONTACT_ID,
				TARGET_USER,
				'user-1', // sharedByUserId = ctx.session.user.id
			);
		});

		it('rejects non-UUID contactId', async () => {
			const { shareContactAction } = await import('@/app/actions/contact-shares');

			const result = await shareContactAction({
				contactId: 'not-a-uuid',
				targetUserId: TARGET_USER,
			});

			expect(result?.validationErrors).toBeDefined();
		});

		it('denies sharing contacts the user cannot manage', async () => {
			mockCanManageContact.mockResolvedValueOnce(false);
			const { shareContactAction } = await import('@/app/actions/contact-shares');

			const result = await shareContactAction({
				contactId: CONTACT_ID,
				targetUserId: TARGET_USER,
			});

			expect(result?.serverError).toBe('Not found');
			expect(mockShare).not.toHaveBeenCalled();
		});
	});

	describe('unshareContactAction', () => {
		it('calls unshareContact DAL and returns success', async () => {
			const { unshareContactAction } = await import('@/app/actions/contact-shares');

			const result = await unshareContactAction({
				contactId: CONTACT_ID,
				targetUserId: TARGET_USER,
			});

			expect(result?.data).toEqual({ success: true });
			expect(mockCanManageContact).toHaveBeenCalledWith(WORKSPACE_ID, 'user-1', CONTACT_ID);
			expect(mockUnshare).toHaveBeenCalledWith(WORKSPACE_ID, CONTACT_ID, TARGET_USER);
		});

		it('denies unsharing contacts the user cannot manage', async () => {
			mockCanManageContact.mockResolvedValueOnce(false);
			const { unshareContactAction } = await import('@/app/actions/contact-shares');

			const result = await unshareContactAction({
				contactId: CONTACT_ID,
				targetUserId: TARGET_USER,
			});

			expect(result?.serverError).toBe('Not found');
			expect(mockUnshare).not.toHaveBeenCalled();
		});
	});

	describe('getContactSharesAction', () => {
		it('returns share list for the contact', async () => {
			const { getContactSharesAction } = await import('@/app/actions/contact-shares');

			const result = await getContactSharesAction({ contactId: CONTACT_ID });

			expect(result?.data).toBeDefined();
			expect(mockCanManageContact).toHaveBeenCalledWith(WORKSPACE_ID, 'user-1', CONTACT_ID);
			expect(mockGetShares).toHaveBeenCalledWith(WORKSPACE_ID, CONTACT_ID);
		});

		it('denies share-list reads for contacts the user cannot manage', async () => {
			mockCanManageContact.mockResolvedValueOnce(false);
			const { getContactSharesAction } = await import('@/app/actions/contact-shares');

			const result = await getContactSharesAction({ contactId: CONTACT_ID });

			expect(result?.serverError).toBe('Not found');
			expect(mockGetShares).not.toHaveBeenCalled();
		});
	});

	describe('getMyTelegramAccountsAction', () => {
		it('returns Telegram account IDs for the current user', async () => {
			const { getMyTelegramAccountsAction } = await import('@/app/actions/contact-shares');

			const result = await getMyTelegramAccountsAction({});

			expect(result?.data).toEqual(['tg123456', 'tg654321']);
			expect(mockGetAccounts).toHaveBeenCalledWith('user-1');
		});
	});
});
