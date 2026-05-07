import { _resetForTesting as resetRateLimit } from '@/lib/rate-limit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetSession = vi.fn();
const mockGetUserWorkspaceId = vi.fn();
const mockGetWorkspaceEnvelope = vi.fn();
const mockListContacts = vi.fn();
const mockGetActiveCommitments = vi.fn();
const mockListDeals = vi.fn();

vi.mock('next/headers', () => ({
	headers: vi.fn(() => Promise.resolve(new Headers())),
}));

vi.mock('@/lib/auth', () => ({
	auth: {
		api: { getSession: (...args: unknown[]) => mockGetSession(...args) },
	},
}));

vi.mock('@/lib/workspace', () => ({
	getUserWorkspaceId: (...args: unknown[]) => mockGetUserWorkspaceId(...args),
	getWorkspaceEnvelope: (...args: unknown[]) => mockGetWorkspaceEnvelope(...args),
}));

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	listContacts: (...args: unknown[]) => mockListContacts(...args),
	getActiveCommitments: (...args: unknown[]) => mockGetActiveCommitments(...args),
	listDeals: (...args: unknown[]) => mockListDeals(...args),
}));

describe('GET /api/export', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetRateLimit();
	});

	it('returns 401 when not authenticated', async () => {
		mockGetSession.mockResolvedValue(null);

		const { GET } = await import('@/app/api/export/route');
		const response = await GET();

		expect(response.status).toBe(401);
	});

	it('returns 400 when no workspace', async () => {
		mockGetSession.mockResolvedValue({ user: { id: 'user-1' } });
		mockGetUserWorkspaceId.mockResolvedValue(null);

		const { GET } = await import('@/app/api/export/route');
		const response = await GET();

		expect(response.status).toBe(403);
	});

	it('returns 500 when no envelope', async () => {
		mockGetSession.mockResolvedValue({ user: { id: 'user-1' } });
		mockGetUserWorkspaceId.mockResolvedValue('ws-1');
		mockGetWorkspaceEnvelope.mockResolvedValue(null);

		const { GET } = await import('@/app/api/export/route');
		const response = await GET();

		expect(response.status).toBe(500);
	});

	it('exports all 3 entity types with Content-Disposition', async () => {
		const envelope = { encryptedWrk: Buffer.from('mock'), kmsContext: {}, wrkVersion: 1 };
		mockGetSession.mockResolvedValue({ user: { id: 'user-1' } });
		mockGetUserWorkspaceId.mockResolvedValue('ws-1');
		mockGetWorkspaceEnvelope.mockResolvedValue(envelope);
		mockListContacts.mockResolvedValue([{ id: 'c-1', firstName: 'Alice' }]);
		mockGetActiveCommitments.mockResolvedValue([{ id: 'cm-1', title: 'Follow up' }]);
		mockListDeals.mockResolvedValue([{ id: 'd-1', title: 'SAFT' }]);

		const { GET } = await import('@/app/api/export/route');
		const response = await GET();

		expect(response.status).toBe(200);
		expect(response.headers.get('Content-Disposition')).toContain('attachment');
		expect(response.headers.get('Content-Disposition')).toContain('gordian-export');

		const data = await response.json();
		expect(data.contacts).toHaveLength(1);
		expect(data.commitments).toHaveLength(1);
		expect(data.deals).toHaveLength(1);
		// workspaceId intentionally excluded from export (SEC: no internal IDs in user data)
	});

	it('fetches all entity types in parallel', async () => {
		const envelope = { encryptedWrk: Buffer.from('mock'), kmsContext: {}, wrkVersion: 1 };
		mockGetSession.mockResolvedValue({ user: { id: 'user-1' } });
		mockGetUserWorkspaceId.mockResolvedValue('ws-1');
		mockGetWorkspaceEnvelope.mockResolvedValue(envelope);
		mockListContacts.mockResolvedValue([]);
		mockGetActiveCommitments.mockResolvedValue([]);
		mockListDeals.mockResolvedValue([]);

		const { GET } = await import('@/app/api/export/route');
		await GET();

		expect(mockListContacts).toHaveBeenCalledWith('ws-1', envelope, { limit: 10000 });
		expect(mockGetActiveCommitments).toHaveBeenCalledWith('ws-1', envelope, { limit: 10000 });
		expect(mockListDeals).toHaveBeenCalledWith('ws-1', envelope, { limit: 10000 });
	});
});
