import { beforeEach, describe, expect, it, vi } from 'vitest';

const INVITE_ID = '550e8400-e29b-41d4-a716-446655440001';
const WORKSPACE_ID = '550e8400-e29b-41d4-a716-446655440000';
const USER_ID = '550e8400-e29b-41d4-a716-446655440002';
const INVITE_UUID = '550e8400-e29b-41d4-a716-446655440003';

const mockHashPassword = vi.fn(() => Promise.resolve('hashed-password'));
vi.mock('better-auth/crypto', () => ({
	hashPassword: mockHashPassword,
}));

const mockSafeAction = vi.hoisted(() => {
	const makeActionClient = () => ({
		schema: () => ({
			action:
				(fn: (args: { parsedInput: unknown; ctx: unknown }) => Promise<unknown>) =>
				async (input: unknown) => {
					try {
						return { data: await fn({ parsedInput: input, ctx: {} }) };
					} catch (err) {
						return { serverError: err instanceof Error ? err.message : 'Action failed' };
					}
				},
		}),
	});
	return {
		actionClient: makeActionClient(),
		authAction: makeActionClient(),
		workspaceAction: makeActionClient(),
	};
});

vi.mock('@/lib/safe-action', () => mockSafeAction);

let inviteRows: unknown[] = [];
let existingUserRows: unknown[] = [];

const mockSelectLimit = vi.fn<() => Promise<unknown[]>>(() => Promise.resolve([]));
const mockSelectWhere = vi.fn(() => ({ limit: mockSelectLimit }));
const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

const mockUserReturning = vi.fn(() => Promise.resolve([{ id: USER_ID }]));
const mockInsertValues = vi.fn(() => ({ returning: mockUserReturning }));
const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

const mockUpdateReturning = vi.fn(() => Promise.resolve([{ id: INVITE_ID }]));
const mockUpdateWhere = vi.fn(() => ({ returning: mockUpdateReturning }));
const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));

const mockTransaction = vi.fn(async (fn: (tx: unknown) => unknown) =>
	fn({
		select: mockSelect,
		insert: mockInsert,
		update: mockUpdate,
	}),
);

vi.mock('@repo/db', () => ({
	db: { transaction: mockTransaction },
	accounts: {
		accountId: 'account_id',
		password: 'password',
		providerId: 'provider_id',
		userId: 'user_id',
	},
	users: {
		id: 'id',
		email: 'email',
		emailVerified: 'email_verified',
		name: 'name',
	},
	workspaceInvites: {
		acceptedAt: 'accepted_at',
		expiresAt: 'expires_at',
		id: 'id',
		role: 'role',
		token: 'token',
		workspaceId: 'workspace_id',
	},
	workspaceMembers: {
		role: 'role',
		userId: 'user_id',
		workspaceId: 'workspace_id',
	},
	workspaces: { id: 'id', ownerId: 'owner_id' },
	and: vi.fn((...args: unknown[]) => args),
	eq: vi.fn((...args: unknown[]) => args),
	sql: vi.fn(() => 'sql'),
	acceptInvite: vi.fn(),
	createInvite: vi.fn(),
	listInvites: vi.fn(),
	trackBehavior: vi.fn().mockResolvedValue(null),
}));

describe('inviteSignupAction', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		inviteRows = [
			{
				id: INVITE_ID,
				workspaceId: WORKSPACE_ID,
				role: 'member',
				expiresAt: new Date(Date.now() + 60_000),
			},
		];
		existingUserRows = [];
		mockSelectLimit.mockImplementation(() => {
			const call = mockSelectLimit.mock.calls.length;
			return Promise.resolve(call === 1 ? inviteRows : existingUserRows);
		});
		mockUpdateReturning.mockResolvedValue([{ id: INVITE_ID }]);
		mockUserReturning.mockResolvedValue([{ id: USER_ID }]);
		mockHashPassword.mockResolvedValue('hashed-password');
	});

	it('creates a credential user only after validating an unused invite token', async () => {
		const { inviteSignupAction } = await import('@/app/actions/invites');

		const result = await inviteSignupAction({
			token: INVITE_UUID,
			name: 'Invited User',
			email: 'invited@example.com',
			password: 'long-enough',
		});

		expect(result?.data).toEqual({ workspaceId: WORKSPACE_ID, userId: USER_ID });
		expect(mockHashPassword).toHaveBeenCalledWith('long-enough');
		expect(mockInsert).toHaveBeenCalledTimes(3);
		expect(mockUpdate).toHaveBeenCalledOnce();
	});

	it('rejects invalid or already-used invite tokens before creating a user', async () => {
		const { inviteSignupAction } = await import('@/app/actions/invites');
		inviteRows = [];

		const result = await inviteSignupAction({
			token: INVITE_UUID,
			name: 'Invited User',
			email: 'invited@example.com',
			password: 'long-enough',
		});

		expect(result?.serverError).toBe('Invite not found or already used');
		expect(mockHashPassword).not.toHaveBeenCalled();
		expect(mockInsert).not.toHaveBeenCalled();
	});

	it('enforces invite-only signup by refusing existing account emails', async () => {
		const { inviteSignupAction } = await import('@/app/actions/invites');
		existingUserRows = [{ id: 'existing-user' }];

		const result = await inviteSignupAction({
			token: INVITE_UUID,
			name: 'Invited User',
			email: 'invited@example.com',
			password: 'long-enough',
		});

		expect(result?.serverError).toBe('Email already has an account');
		expect(mockHashPassword).not.toHaveBeenCalled();
		expect(mockInsert).not.toHaveBeenCalled();
	});

	it('rejects raced invite acceptance if the token is consumed before commit', async () => {
		const { inviteSignupAction } = await import('@/app/actions/invites');
		mockUpdateReturning.mockResolvedValueOnce([]);

		const result = await inviteSignupAction({
			token: INVITE_UUID,
			name: 'Invited User',
			email: 'invited@example.com',
			password: 'long-enough',
		});

		expect(result?.serverError).toBe('Invite not found or already used');
		expect(mockInsert).not.toHaveBeenCalled();
	});
});
