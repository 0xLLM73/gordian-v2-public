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

const mockGetMessagesByContact = vi.fn(() =>
	Promise.resolve([
		{
			id: 'msg-1',
			text: 'Hello there',
			isOutgoing: false,
			sentAt: new Date('2026-01-15T10:00:00Z'),
		},
		{
			id: 'msg-2',
			text: 'Hi!',
			isOutgoing: true,
			sentAt: new Date('2026-01-15T10:01:00Z'),
		},
	]),
);
const mockCanAccessContact = vi.fn(() => Promise.resolve(true));

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	canAccessContact: mockCanAccessContact,
	getMessagesByContact: mockGetMessagesByContact,
}));

describe('message actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('getMessagesByContactAction', () => {
		it('calls DAL with correct params', async () => {
			const { getMessagesByContactAction } = await import('@/app/actions/messages');

			const result = await getMessagesByContactAction({
				contactId: '550e8400-e29b-41d4-a716-446655440001',
			});

			expect(result?.data).toBeDefined();
			expect(mockCanAccessContact).toHaveBeenCalledWith(
				WORKSPACE_ID,
				'user-1',
				'550e8400-e29b-41d4-a716-446655440001',
			);
			expect(mockGetMessagesByContact).toHaveBeenCalledWith(
				WORKSPACE_ID,
				'550e8400-e29b-41d4-a716-446655440001',
				expect.any(Object),
				{ limit: 50, offset: 0 },
			);
		});

		it('denies messages for inaccessible contacts', async () => {
			const { getMessagesByContactAction } = await import('@/app/actions/messages');
			mockCanAccessContact.mockResolvedValueOnce(false);

			const result = await getMessagesByContactAction({
				contactId: '550e8400-e29b-41d4-a716-446655440001',
			});

			expect(result?.serverError).toBe('Not found');
			expect(mockGetMessagesByContact).not.toHaveBeenCalled();
		});

		it('passes custom limit and offset for pagination', async () => {
			const { getMessagesByContactAction } = await import('@/app/actions/messages');

			await getMessagesByContactAction({
				contactId: '550e8400-e29b-41d4-a716-446655440001',
				limit: 25,
				offset: 50,
			});

			expect(mockGetMessagesByContact).toHaveBeenCalledWith(
				WORKSPACE_ID,
				'550e8400-e29b-41d4-a716-446655440001',
				expect.any(Object),
				{ limit: 25, offset: 50 },
			);
		});

		it('rejects invalid contactId format', async () => {
			const { getMessagesByContactAction } = await import('@/app/actions/messages');

			const result = await getMessagesByContactAction({
				contactId: 'not-a-uuid',
			});

			expect(result?.validationErrors).toBeDefined();
		});

		it('rejects limit exceeding max', async () => {
			const { getMessagesByContactAction } = await import('@/app/actions/messages');

			const result = await getMessagesByContactAction({
				contactId: '550e8400-e29b-41d4-a716-446655440001',
				limit: 200,
			});

			expect(result?.validationErrors).toBeDefined();
		});
	});
});
