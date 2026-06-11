import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@repo/crypto', () => ({
	withKeys: vi.fn((_envelope: unknown, fn: () => unknown) => fn()),
	keyStore: { getStore: vi.fn(() => null) },
	computeBlindIndex: vi.fn((val: string) => `bidx:${val}`),
}));

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockReturning = vi.hoisted(() => vi.fn());
const mockLimit = vi.hoisted(() =>
	vi.fn((): Promise<Record<string, unknown>[]> => Promise.resolve([])),
);
const mockWhere = vi.hoisted(() => vi.fn(() => ({ limit: mockLimit, returning: mockReturning })));
const mockInnerJoin = vi.hoisted(() => vi.fn(() => ({ where: mockWhere })));
const mockSelectFrom = vi.hoisted(() =>
	vi.fn(() => ({ where: mockWhere, innerJoin: mockInnerJoin })),
);
const mockSelect = vi.hoisted(() => vi.fn(() => ({ from: mockSelectFrom })));
const mockInsertValues = vi.hoisted(() => vi.fn(() => ({ returning: mockReturning })));
const mockInsert = vi.hoisted(() => vi.fn(() => ({ values: mockInsertValues })));
const mockSet = vi.hoisted(() =>
	vi.fn(() => ({ where: vi.fn(() => ({ returning: mockReturning })) })),
);
const mockUpdate = vi.hoisted(() => vi.fn(() => ({ set: mockSet })));

// Transaction mock: passes tx with same shape as db
const mockTx = {
	select: mockSelect,
	update: mockUpdate,
	insert: mockInsert,
};

vi.mock('../client', () => ({
	db: {
		insert: mockInsert,
		update: mockUpdate,
		select: mockSelect,
		transaction: vi.fn((fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
	},
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FUTURE = new Date(Date.now() + 86400000); // 1 day from now
const PAST = new Date(Date.now() - 86400000); // 1 day ago

const SAFE_INVITE = {
	id: 'inv-1',
	workspaceId: 'ws-1',
	role: 'member',
	token: 'tok-abc',
	expiresAt: FUTURE,
	acceptedAt: null,
	createdBy: 'user-1',
	createdAt: new Date(),
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('invites DAL', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockWhere.mockReturnValue({ limit: mockLimit, returning: mockReturning });
		mockLimit.mockResolvedValue([]);
		mockReturning.mockResolvedValue([{ id: SAFE_INVITE.id }]);
	});

	describe('createWorkspace', () => {
		it('persists an explicit workspace id so key context matches the stored workspace', async () => {
			mockReturning.mockResolvedValueOnce([{ id: 'ws-explicit', name: 'Secure Workspace' }]);

			const { createWorkspace } = await import('../dal/invites');
			const result = await createWorkspace(
				'user-1',
				'Secure Workspace',
				'encrypted-wrk',
				{ WorkspaceID: 'ws-explicit' },
				{ id: 'ws-explicit' },
			);

			expect(result).toEqual(expect.objectContaining({ id: 'ws-explicit' }));
			expect(mockInsertValues).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({
					id: 'ws-explicit',
					name: 'Secure Workspace',
					ownerId: 'user-1',
					encryptedWrk: 'encrypted-wrk',
					kmsContext: { WorkspaceID: 'ws-explicit' },
				}),
			);
			expect(mockInsertValues).toHaveBeenNthCalledWith(2, {
				workspaceId: 'ws-explicit',
				userId: 'user-1',
				role: 'admin',
			});
		});
	});

	describe('acceptInvite', () => {
		it('returns invite without encrypted fields (SEC-ENC-509)', async () => {
			mockLimit.mockResolvedValueOnce([SAFE_INVITE]);

			const { acceptInvite } = await import('../dal/invites');
			const result = await acceptInvite('tok-abc', 'user-2');

			expect(result).toEqual(SAFE_INVITE);
			// Verify the select was called with explicit columns (not bare select())
			const selectArg = (mockSelect.mock.calls as unknown[][])[0][0] as
				| Record<string, unknown>
				| undefined;
			expect(selectArg).toBeDefined();
			// Must NOT contain email or emailBlindIndex keys
			expect(selectArg).not.toHaveProperty('email');
			expect(selectArg).not.toHaveProperty('emailBlindIndex');
			// Must contain the safe fields
			expect(selectArg).toHaveProperty('id');
			expect(selectArg).toHaveProperty('workspaceId');
			expect(selectArg).toHaveProperty('role');
			expect(selectArg).toHaveProperty('expiresAt');
		});

		it('throws when invite not found', async () => {
			mockLimit.mockResolvedValueOnce([]);

			const { acceptInvite } = await import('../dal/invites');
			await expect(acceptInvite('bad-token', 'user-2')).rejects.toThrow(
				'Invite not found or already used',
			);
		});

		it('throws when invite has expired', async () => {
			mockLimit.mockResolvedValueOnce([{ ...SAFE_INVITE, expiresAt: PAST }]);

			const { acceptInvite } = await import('../dal/invites');
			await expect(acceptInvite('tok-abc', 'user-2')).rejects.toThrow('Invite has expired');
		});

		it('marks invite as accepted', async () => {
			mockLimit.mockResolvedValueOnce([SAFE_INVITE]);

			const { acceptInvite } = await import('../dal/invites');
			await acceptInvite('tok-abc', 'user-2');

			expect(mockUpdate).toHaveBeenCalled();
			expect(mockSet).toHaveBeenCalledWith(
				expect.objectContaining({ acceptedAt: expect.anything() }),
			);
		});

		it('adds the invited user to the workspace', async () => {
			mockLimit.mockResolvedValueOnce([SAFE_INVITE]);

			const { acceptInvite } = await import('../dal/invites');
			await acceptInvite('tok-abc', 'user-2');

			expect(mockInsertValues).toHaveBeenCalledWith({
				workspaceId: SAFE_INVITE.workspaceId,
				userId: 'user-2',
				role: SAFE_INVITE.role,
			});
		});

		it('throws if another transaction consumed the invite before update', async () => {
			mockLimit.mockResolvedValueOnce([SAFE_INVITE]);
			mockReturning.mockResolvedValueOnce([]);

			const { acceptInvite } = await import('../dal/invites');
			await expect(acceptInvite('tok-abc', 'user-2')).rejects.toThrow(
				'Invite not found or already used',
			);
			expect(mockInsertValues).not.toHaveBeenCalled();
		});
	});

	describe('getInviteByToken', () => {
		it('returns null email (SEC-ENC-508)', async () => {
			const mockRow = {
				id: 'inv-1',
				workspaceId: 'ws-1',
				role: 'member',
				token: 'tok-abc',
				expiresAt: FUTURE,
				acceptedAt: null,
				createdBy: 'user-1',
				createdAt: new Date(),
				workspaceName: 'Test Workspace',
			};
			mockLimit.mockResolvedValueOnce([mockRow]);

			const { getInviteByToken } = await import('../dal/invites');
			const result = await getInviteByToken('tok-abc');

			expect(result).not.toBeNull();
			expect(result?.email).toBeNull();
		});

		it('returns null when token not found', async () => {
			mockLimit.mockResolvedValueOnce([]);

			const { getInviteByToken } = await import('../dal/invites');
			const result = await getInviteByToken('nonexistent');

			expect(result).toBeNull();
		});
	});
});
