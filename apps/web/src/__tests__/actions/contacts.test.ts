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
const mockGetContact = vi.fn(() => Promise.resolve({ id: '1', firstName: 'John' }));
const mockCreateContact = vi.fn(() => Promise.resolve({ id: 'new-1' }));
const mockUpdateContact = vi.fn(() => Promise.resolve({ id: '1' }));
const mockListContacts = vi.fn(() => Promise.resolve([{ id: '1' }, { id: '2' }]));
const mockSearchByPhone = vi.fn(() => Promise.resolve([]));
const mockSearchByEmail = vi.fn(() => Promise.resolve([]));

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	searchContactByName: mockSearchByName,
	searchContactByPhone: mockSearchByPhone,
	searchContactByEmail: mockSearchByEmail,
	getContact: mockGetContact,
	createContact: mockCreateContact,
	updateContact: mockUpdateContact,
	listContacts: mockListContacts,
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
				query: 'John',
				field: 'name',
			});

			expect(result?.data).toBeDefined();
			expect(mockSearchByName).toHaveBeenCalledWith(WORKSPACE_ID, 'John', expect.any(Object));
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
			expect(mockGetContact).toHaveBeenCalled();
		});
	});

	describe('createContactAction', () => {
		it('creates a contact with valid input', async () => {
			const { createContactAction } = await import('@/app/actions/contacts');

			const result = await createContactAction({
				firstName: 'Jane',
				lastName: 'Doe',
				phone: '+1234567890',
			});

			expect(result?.data).toBeDefined();
			expect(mockCreateContact).toHaveBeenCalledWith(
				WORKSPACE_ID,
				expect.objectContaining({ firstName: 'Jane', lastName: 'Doe' }),
				expect.any(Object),
			);
		});

		it('rejects invalid email', async () => {
			const { createContactAction } = await import('@/app/actions/contacts');

			const result = await createContactAction({
				email: 'not-an-email',
			});

			expect(result?.validationErrors).toBeDefined();
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
			expect(mockListContacts).toHaveBeenCalledWith(WORKSPACE_ID, expect.any(Object), {
				limit: 10,
				offset: 0,
			});
		});
	});
});
