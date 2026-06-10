import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * IDOR regression test: verifies that workspaceAction derives the workspace
 * from the authenticated session (via getUserWorkspaceId), NOT from client input.
 */

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

const REAL_WORKSPACE_ID = '550e8400-e29b-41d4-a716-446655440000';
const ATTACKER_WORKSPACE_ID = '660e8400-e29b-41d4-a716-446655440099';

const mockGetUserWorkspaceId = vi.fn(
	(): Promise<string | null> => Promise.resolve(REAL_WORKSPACE_ID),
);
const mockGetWorkspaceEnvelope = vi.fn(() =>
	Promise.resolve({
		encryptedWrk: Buffer.from('mock'),
		kmsContext: { WorkspaceID: REAL_WORKSPACE_ID },
		wrkVersion: 1,
	}),
);

vi.mock('@/lib/workspace', () => ({
	getUserWorkspaceId: mockGetUserWorkspaceId,
	getWorkspaceEnvelope: mockGetWorkspaceEnvelope,
}));

const mockGetAccessibleContacts = vi.fn(() => Promise.resolve([{ id: '1' }]));
vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	canAccessContact: vi.fn(() => Promise.resolve(true)),
	getAccessibleContact: vi.fn(),
	getAccessibleContacts: mockGetAccessibleContacts,
}));

describe('workspaceAction IDOR prevention', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('derives workspaceId from session, not from client input', async () => {
		const { listContactsAction } = await import('@/app/actions/contacts');

		// Action no longer accepts workspaceId — the schema only has limit/offset.
		// The middleware resolves workspace from session.
		await listContactsAction({ limit: 10 });

		// The DAL was called with the REAL workspace ID from session lookup
		expect(mockGetUserWorkspaceId).toHaveBeenCalledWith('user-1');
		expect(mockGetAccessibleContacts).toHaveBeenCalledWith(
			REAL_WORKSPACE_ID,
			'user-1',
			expect.any(Object),
			expect.any(Object),
		);

		// Verify it was NOT called with the attacker's workspace
		expect(mockGetAccessibleContacts).not.toHaveBeenCalledWith(
			ATTACKER_WORKSPACE_ID,
			expect.anything(),
			expect.anything(),
			expect.anything(),
		);
	});

	it('rejects users with no workspace', async () => {
		mockGetUserWorkspaceId.mockResolvedValueOnce(null);
		const { listContactsAction } = await import('@/app/actions/contacts');

		const result = await listContactsAction({ limit: 10 });

		expect(result?.serverError).toBe('No workspace found');
		expect(mockGetAccessibleContacts).not.toHaveBeenCalled();
	});

	it('passes envelope from middleware to action via ctx', async () => {
		const { listContactsAction } = await import('@/app/actions/contacts');

		await listContactsAction({});

		// getWorkspaceEnvelope was called with the session-derived workspace ID
		expect(mockGetWorkspaceEnvelope).toHaveBeenCalledWith(REAL_WORKSPACE_ID);
	});
});

describe('publicServerActionErrorMessage', () => {
	it('maps local worker connection failures to actionable setup copy', async () => {
		const { publicServerActionErrorMessage } = await import('@/lib/safe-action');

		expect(publicServerActionErrorMessage(new Error('fetch failed'))).toBe(
			'Could not reach the local worker. Start it with pnpm --filter worker dev or update WORKER_URL, then retry.',
		);
	});

	it('keeps unknown server errors generic', async () => {
		const { publicServerActionErrorMessage } = await import('@/lib/safe-action');

		expect(publicServerActionErrorMessage(new Error('database exploded'))).toBe(
			'An unexpected error occurred. Please try again.',
		);
	});
});
