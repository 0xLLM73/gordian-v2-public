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

// Mock workspace helpers (workspaceAction middleware uses both)
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
const mockSearchByName = vi.fn(() => Promise.resolve([{ id: '1', firstName: 'John' }]));
const mockCanAccessContact = vi.fn(() => Promise.resolve(true));
const mockGetAccessibleContact = vi.fn(
	(): Promise<{ id: string; firstName: string } | null> =>
		Promise.resolve({ id: '1', firstName: 'John' }),
);
const mockCreateContact = vi.fn(() => Promise.resolve({ id: 'new-1' }));
const mockUpdateContact = vi.fn(() => Promise.resolve({ id: '1' }));
const mockGetAccessibleContacts = vi.fn(() => Promise.resolve([{ id: '1' }, { id: '2' }]));
const mockSearchByPhone = vi.fn(() => Promise.resolve([]));
const mockSearchByEmail = vi.fn(() => Promise.resolve([]));

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	searchContactByName: mockSearchByName,
	searchContactByPhone: mockSearchByPhone,
	searchContactByEmail: mockSearchByEmail,
	canAccessContact: mockCanAccessContact,
	getAccessibleContact: mockGetAccessibleContact,
	createContact: mockCreateContact,
	updateContact: mockUpdateContact,
	getAccessibleContacts: mockGetAccessibleContacts,
	trackBehavior: vi.fn().mockResolvedValue(null),
}));

describe('contact actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('searchContactsAction', () => {
		it('calls searchByName with correct params', async () => {
			const { searchContactsAction } = await import('@/app/actions/contacts');

			const result = await searchContactsAction({
				query: '  John  ',
				field: 'name',
			});

			expect(result?.data).toBeDefined();
			expect(mockSearchByName).toHaveBeenCalledWith(WORKSPACE_ID, 'John', expect.any(Object));
			expect(mockCanAccessContact).toHaveBeenCalledWith(WORKSPACE_ID, 'user-1', '1');
		});

		it('rejects empty query', async () => {
			const { searchContactsAction } = await import('@/app/actions/contacts');

			const result = await searchContactsAction({
				query: '',
			});

			expect(result?.validationErrors).toBeDefined();
		});
	});

	describe('getContactAction', () => {
		it('fetches a contact by id', async () => {
			const { getContactAction } = await import('@/app/actions/contacts');

			const result = await getContactAction({
				contactId: '550e8400-e29b-41d4-a716-446655440001',
			});

			expect(result?.data).toBeDefined();
			expect(mockGetAccessibleContact).toHaveBeenCalledWith(
				WORKSPACE_ID,
				'user-1',
				'550e8400-e29b-41d4-a716-446655440001',
				expect.any(Object),
			);
		});

		it('denies inaccessible contacts', async () => {
			const { getContactAction } = await import('@/app/actions/contacts');
			mockGetAccessibleContact.mockResolvedValueOnce(null);

			const result = await getContactAction({
				contactId: '550e8400-e29b-41d4-a716-446655440001',
			});

			expect(result?.serverError).toBe('Not found');
		});
	});

	describe('createContactAction', () => {
		it('creates a contact with valid input', async () => {
			const { createContactAction } = await import('@/app/actions/contacts');

			const result = await createContactAction({
				firstName: '  Jane  ',
				lastName: '  Doe  ',
				phone: '+1234567890',
				notes: '  Warm intro  ',
			});

			expect(result?.data).toBeDefined();
			expect(mockCreateContact).toHaveBeenCalledWith(
				WORKSPACE_ID,
				expect.objectContaining({
					firstName: 'Jane',
					lastName: 'Doe',
					notes: 'Warm intro',
				}),
				expect.any(Object),
			);
		});

		it('rejects blank names after trimming', async () => {
			const { createContactAction } = await import('@/app/actions/contacts');

			const result = await createContactAction({
				firstName: '   ',
				lastName: '   ',
			});

			expect(result?.validationErrors).toBeDefined();
			expect(mockCreateContact).not.toHaveBeenCalled();
		});

		it('rejects invalid email', async () => {
			const { createContactAction } = await import('@/app/actions/contacts');

			const result = await createContactAction({
				email: 'not-an-email',
			});

			expect(result?.validationErrors).toBeDefined();
		});
	});

	describe('updateContactAction', () => {
		it('trims changed fields and clears blank notes', async () => {
			const { updateContactAction } = await import('@/app/actions/contacts');

			const result = await updateContactAction({
				contactId: '550e8400-e29b-41d4-a716-446655440001',
				firstName: '  Jane  ',
				email: '  jane@example.com  ',
				notes: '   ',
			});

			expect(result?.data).toBeDefined();
			expect(mockUpdateContact).toHaveBeenCalledWith(
				WORKSPACE_ID,
				'550e8400-e29b-41d4-a716-446655440001',
				expect.objectContaining({
					firstName: 'Jane',
					email: 'jane@example.com',
					notes: null,
				}),
				expect.any(Object),
			);
		});
	});

	describe('listContactsAction', () => {
		it('lists contacts with pagination', async () => {
			const { listContactsAction } = await import('@/app/actions/contacts');

			const result = await listContactsAction({
				limit: 10,
				offset: 0,
			});

			expect(result?.data).toBeDefined();
			expect(mockGetAccessibleContacts).toHaveBeenCalledWith(
				WORKSPACE_ID,
				'user-1',
				expect.any(Object),
				{
					limit: 10,
					offset: 0,
				},
			);
		});
	});
});
