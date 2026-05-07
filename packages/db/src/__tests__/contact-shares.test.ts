import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── DB mock ──────────────────────────────────────────────────────────────────

const mockInsertReturning = vi.fn();
const mockOnConflictDoNothing = vi.fn(() => ({ returning: mockInsertReturning }));
const mockInsertValues = vi.fn(() => ({
	returning: mockInsertReturning,
	onConflictDoNothing: mockOnConflictDoNothing,
}));
const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

const mockDeleteWhere = vi.fn(() => Promise.resolve());
const mockDelete = vi.fn(() => ({ where: mockDeleteWhere }));

const mockSelectFrom = vi.fn();
const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

vi.mock('../client', () => ({
	db: {
		select: mockSelect,
		insert: mockInsert,
		delete: mockDelete,
	},
}));

vi.mock('@repo/crypto', () => ({
	withKeys: vi.fn((_envelope: unknown, fn: () => unknown) => fn()),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WORKSPACE_ID = 'ws-00000000-0000-0000-0000-000000000001';
const USER_ID = 'user-0000-0000-0000-0000-000000000001';
const CONTACT_ID = 'ct-000000-0000-0000-0000-000000000001';
const TG_ACCOUNT = 'tg123456';
const OTHER_USER = 'other-0000-0000-0000-0000-000000000001';

const mockEnvelope = {
	encryptedWrk: Buffer.from('test'),
	kmsContext: {},
	wrkVersion: 1 as const,
};

const mockContact = { id: CONTACT_ID, workspaceId: WORKSPACE_ID, sourceAccountId: TG_ACCOUNT };
const mockShare = {
	id: 'share-001',
	workspaceId: WORKSPACE_ID,
	contactId: CONTACT_ID,
	sharedWithUserId: OTHER_USER,
	sharedByUserId: USER_ID,
	createdAt: new Date(),
};

/** from() chain for queries that end at .where() (awaitable directly) */
const makeSimpleChain = (rows: unknown[]) => ({
	where: vi.fn().mockResolvedValue(rows),
});

/** from() chain for contacts select: .where().limit().offset().orderBy() */
const makeContactsChain = (rows: unknown[]) => ({
	where: vi.fn().mockReturnValue({
		limit: vi.fn().mockReturnValue({
			offset: vi.fn().mockReturnValue({
				orderBy: vi.fn().mockResolvedValue(rows),
			}),
		}),
	}),
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('contact-shares DAL', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// ─── createContact stores sourceAccountId ──────────────────────────────

	describe('createContact', () => {
		it('stores sourceAccountId when provided', async () => {
			mockInsertReturning.mockResolvedValue([mockContact]);

			const { createContact } = await import('../dal/contacts');
			const result = await createContact(
				WORKSPACE_ID,
				{ firstName: 'Alice', sourceAccountId: TG_ACCOUNT },
				mockEnvelope,
			);

			expect(mockInsertValues).toHaveBeenCalledWith(
				expect.objectContaining({ sourceAccountId: TG_ACCOUNT }),
			);
			expect(result?.sourceAccountId).toBe(TG_ACCOUNT);
		});

		it('stores null sourceAccountId when not provided (legacy)', async () => {
			const legacyContact = { ...mockContact, sourceAccountId: null };
			mockInsertReturning.mockResolvedValue([legacyContact]);

			const { createContact } = await import('../dal/contacts');
			await createContact(WORKSPACE_ID, { firstName: 'Bob' }, mockEnvelope);

			expect(mockInsertValues).toHaveBeenCalledWith(
				expect.objectContaining({ sourceAccountId: null }),
			);
		});
	});

	// ─── listContacts sourceAccountId filter ───────────────────────────────

	describe('listContacts', () => {
		it('returns contacts matching the sourceAccountId filter', async () => {
			mockSelectFrom.mockReturnValue(makeContactsChain([mockContact]));

			const { listContacts } = await import('../dal/contacts');
			const result = await listContacts(WORKSPACE_ID, mockEnvelope, {
				sourceAccountId: TG_ACCOUNT,
			});

			expect(result).toHaveLength(1);
			expect(result[0].sourceAccountId).toBe(TG_ACCOUNT);
		});

		it('returns all contacts when no sourceAccountId filter is set', async () => {
			const contacts = [mockContact, { ...mockContact, id: 'ct-2', sourceAccountId: null }];
			mockSelectFrom.mockReturnValue(makeContactsChain(contacts));

			const { listContacts } = await import('../dal/contacts');
			const result = await listContacts(WORKSPACE_ID, mockEnvelope);

			expect(result).toHaveLength(2);
		});
	});

	// ─── getAccessibleContacts ─────────────────────────────────────────────

	describe('getAccessibleContacts', () => {
		it('returns legacy (NULL source_account_id) contacts for all users', async () => {
			const legacyContact = { ...mockContact, sourceAccountId: null };
			// accounts query → user has no Telegram accounts
			mockSelectFrom.mockReturnValueOnce(makeSimpleChain([]));
			// shares query → no shares
			mockSelectFrom.mockReturnValueOnce(makeSimpleChain([]));
			// contacts query → legacy contact visible to all
			mockSelectFrom.mockReturnValueOnce(makeContactsChain([legacyContact]));

			const { getAccessibleContacts } = await import('../dal/contacts');
			const result = await getAccessibleContacts(WORKSPACE_ID, USER_ID, mockEnvelope);

			expect(result).toHaveLength(1);
		});

		it('returns contacts owned by the user Telegram accounts', async () => {
			// accounts → user owns TG_ACCOUNT
			mockSelectFrom.mockReturnValueOnce(makeSimpleChain([{ accountId: TG_ACCOUNT }]));
			// shares → none
			mockSelectFrom.mockReturnValueOnce(makeSimpleChain([]));
			// contacts → the owned contact
			mockSelectFrom.mockReturnValueOnce(makeContactsChain([mockContact]));

			const { getAccessibleContacts } = await import('../dal/contacts');
			const result = await getAccessibleContacts(WORKSPACE_ID, USER_ID, mockEnvelope);

			expect(result).toHaveLength(1);
			expect(result[0].sourceAccountId).toBe(TG_ACCOUNT);
		});

		it('returns explicitly shared contacts', async () => {
			// accounts → user has no Telegram accounts
			mockSelectFrom.mockReturnValueOnce(makeSimpleChain([]));
			// shares → CONTACT_ID is shared with user
			mockSelectFrom.mockReturnValueOnce(makeSimpleChain([{ contactId: CONTACT_ID }]));
			// contacts → the shared contact
			mockSelectFrom.mockReturnValueOnce(makeContactsChain([mockContact]));

			const { getAccessibleContacts } = await import('../dal/contacts');
			const result = await getAccessibleContacts(WORKSPACE_ID, USER_ID, mockEnvelope);

			expect(result).toHaveLength(1);
		});

		it('returns empty when contact belongs to another account and is not shared', async () => {
			// accounts → user has no Telegram accounts
			mockSelectFrom.mockReturnValueOnce(makeSimpleChain([]));
			// shares → no shares for this user
			mockSelectFrom.mockReturnValueOnce(makeSimpleChain([]));
			// contacts → nothing accessible
			mockSelectFrom.mockReturnValueOnce(makeContactsChain([]));

			const { getAccessibleContacts } = await import('../dal/contacts');
			const result = await getAccessibleContacts(WORKSPACE_ID, USER_ID, mockEnvelope);

			expect(result).toHaveLength(0);
		});
	});

	// ─── getUserTelegramAccountIds ─────────────────────────────────────────

	describe('getUserTelegramAccountIds', () => {
		it('returns Telegram account IDs for the user', async () => {
			mockSelectFrom.mockReturnValue(
				makeSimpleChain([{ accountId: TG_ACCOUNT }, { accountId: 'tg654321' }]),
			);

			const { getUserTelegramAccountIds } = await import('../dal/contacts');
			const result = await getUserTelegramAccountIds(USER_ID);

			expect(result).toEqual([TG_ACCOUNT, 'tg654321']);
		});

		it('returns empty array when user has no Telegram accounts', async () => {
			mockSelectFrom.mockReturnValue(makeSimpleChain([]));

			const { getUserTelegramAccountIds } = await import('../dal/contacts');
			const result = await getUserTelegramAccountIds(USER_ID);

			expect(result).toEqual([]);
		});
	});

	// ─── shareContact ──────────────────────────────────────────────────────

	describe('shareContact', () => {
		it('creates a share record with correct fields', async () => {
			mockInsertReturning.mockResolvedValue([mockShare]);

			const { shareContact } = await import('../dal/contacts');
			const result = await shareContact(WORKSPACE_ID, CONTACT_ID, OTHER_USER, USER_ID);

			expect(mockInsertValues).toHaveBeenCalledWith(
				expect.objectContaining({
					workspaceId: WORKSPACE_ID,
					contactId: CONTACT_ID,
					sharedWithUserId: OTHER_USER,
					sharedByUserId: USER_ID,
				}),
			);
			expect(mockOnConflictDoNothing).toHaveBeenCalled();
			expect(result).toEqual(mockShare);
		});

		it('returns null on duplicate share (onConflictDoNothing)', async () => {
			mockInsertReturning.mockResolvedValue([]);

			const { shareContact } = await import('../dal/contacts');
			const result = await shareContact(WORKSPACE_ID, CONTACT_ID, OTHER_USER, USER_ID);

			expect(result).toBeNull();
		});
	});

	// ─── unshareContact ────────────────────────────────────────────────────

	describe('unshareContact', () => {
		it('deletes the share record', async () => {
			const { unshareContact } = await import('../dal/contacts');
			await unshareContact(WORKSPACE_ID, CONTACT_ID, OTHER_USER);

			expect(mockDelete).toHaveBeenCalled();
			expect(mockDeleteWhere).toHaveBeenCalled();
		});
	});

	// ─── getContactShares ──────────────────────────────────────────────────

	describe('getContactShares', () => {
		it('lists all shares for a contact', async () => {
			mockSelectFrom.mockReturnValue(makeSimpleChain([mockShare]));

			const { getContactShares } = await import('../dal/contacts');
			const result = await getContactShares(WORKSPACE_ID, CONTACT_ID);

			expect(result).toEqual([mockShare]);
		});

		it('returns empty array when no shares exist', async () => {
			mockSelectFrom.mockReturnValue(makeSimpleChain([]));

			const { getContactShares } = await import('../dal/contacts');
			const result = await getContactShares(WORKSPACE_ID, CONTACT_ID);

			expect(result).toEqual([]);
		});
	});
});
