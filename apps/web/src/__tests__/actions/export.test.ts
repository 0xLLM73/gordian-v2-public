import { _resetForTesting as resetRateLimit } from '@/lib/rate-limit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetSession = vi.fn();
const mockGetUserWorkspaceId = vi.fn();
const mockGetWorkspaceEnvelope = vi.fn();
const mockGetAccessibleContacts = vi.fn();
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
	getAccessibleContacts: (...args: unknown[]) => mockGetAccessibleContacts(...args),
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

	it('exports a labeled basic CRM archive with Content-Disposition', async () => {
		const envelope = { encryptedWrk: Buffer.from('mock'), kmsContext: {}, wrkVersion: 1 };
		mockGetSession.mockResolvedValue({ user: { id: 'user-1' } });
		mockGetUserWorkspaceId.mockResolvedValue('ws-1');
		mockGetWorkspaceEnvelope.mockResolvedValue(envelope);
		mockGetAccessibleContacts.mockResolvedValue([{ id: 'c-1', firstName: 'Alice' }]);
		mockGetActiveCommitments.mockResolvedValue([
			{ id: 'cm-1', contactId: 'c-1', title: 'Follow up' },
		]);
		mockListDeals.mockResolvedValue([{ id: 'd-1', contactId: 'c-1', title: 'SAFT' }]);

		const { GET } = await import('@/app/api/export/route');
		const response = await GET();

		expect(response.status).toBe(200);
		expect(response.headers.get('Content-Disposition')).toContain('attachment');
		expect(response.headers.get('Content-Disposition')).toContain('gordian-basic-crm-export');

		const data = await response.json();
		expect(data.exportType).toBe('basic_crm');
		expect(data.description).toContain('not a complete account archive');
		expect(data.included).toEqual(['contacts', 'commitments', 'deals']);
		expect(data.excluded).toEqual(
			expect.arrayContaining(['telegram_messages', 'knowledge_graph', 'runtime_queues']),
		);
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
		mockGetAccessibleContacts.mockResolvedValue([]);
		mockGetActiveCommitments.mockResolvedValue([]);
		mockListDeals.mockResolvedValue([]);

		const { GET } = await import('@/app/api/export/route');
		await GET();

		expect(mockGetAccessibleContacts).toHaveBeenCalledWith('ws-1', 'user-1', envelope, {
			limit: 10000,
		});
		expect(mockGetActiveCommitments).toHaveBeenCalledWith('ws-1', envelope, { limit: 10000 });
		expect(mockListDeals).toHaveBeenCalledWith('ws-1', envelope, { limit: 10000 });
	});

	it('filters commitments and deals to accessible contacts', async () => {
		const envelope = { encryptedWrk: Buffer.from('mock'), kmsContext: {}, wrkVersion: 1 };
		mockGetSession.mockResolvedValue({ user: { id: 'user-1' } });
		mockGetUserWorkspaceId.mockResolvedValue('ws-1');
		mockGetWorkspaceEnvelope.mockResolvedValue(envelope);
		mockGetAccessibleContacts.mockResolvedValue([{ id: 'c-allowed', firstName: 'Alice' }]);
		mockGetActiveCommitments.mockResolvedValue([
			{ id: 'cm-allowed', contactId: 'c-allowed', title: 'Follow up' },
			{ id: 'cm-denied', contactId: 'c-denied', title: 'Hidden follow up' },
			{ id: 'cm-workspace', title: 'Unscoped follow up' },
		]);
		mockListDeals.mockResolvedValue([
			{ id: 'd-allowed', contactId: 'c-allowed', title: 'SAFT' },
			{ id: 'd-denied', contactId: 'c-denied', title: 'Hidden deal' },
		]);

		const { GET } = await import('@/app/api/export/route');
		const response = await GET();

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.contacts.map((contact: { id: string }) => contact.id)).toEqual(['c-allowed']);
		expect(data.commitments.map((commitment: { id: string }) => commitment.id)).toEqual([
			'cm-allowed',
		]);
		expect(data.deals.map((deal: { id: string }) => deal.id)).toEqual(['d-allowed']);
	});

	it('strips raw Telegram/message fields from the basic CRM export', async () => {
		const envelope = { encryptedWrk: Buffer.from('mock'), kmsContext: {}, wrkVersion: 1 };
		const sentinel = 'CONFIDENTIAL TELEGRAM SENTINEL';
		mockGetSession.mockResolvedValue({ user: { id: 'user-1' } });
		mockGetUserWorkspaceId.mockResolvedValue('ws-1');
		mockGetWorkspaceEnvelope.mockResolvedValue(envelope);
		mockGetAccessibleContacts.mockResolvedValue([
			{
				id: 'c-allowed',
				firstName: 'Alice',
				sourceAccountId: sentinel,
				telegramId: sentinel,
				telegram_id: sentinel,
				messageText: sentinel,
				message_text: sentinel,
				messages: [{ text: sentinel }],
				profile: { telegramMessages: [{ body: sentinel }] },
			},
		]);
		mockGetActiveCommitments.mockResolvedValue([
			{
				id: 'cm-allowed',
				contactId: 'c-allowed',
				title: 'Follow up',
				sourceMessageText: sentinel,
				source_message_text: sentinel,
			},
		]);
		mockListDeals.mockResolvedValue([
			{
				id: 'd-allowed',
				contactId: 'c-allowed',
				title: 'SAFT',
				metadata: {
					embedding: sentinel,
					kmsContext: sentinel,
					rawMessage: sentinel,
					safeNote: 'kept',
				},
			},
		]);

		const { GET } = await import('@/app/api/export/route');
		const response = await GET();

		expect(response.status).toBe(200);
		const serialized = JSON.stringify(await response.json());
		expect(serialized).not.toContain(sentinel);
		expect(serialized).toContain('Follow up');
		expect(serialized).toContain('kept');
	});
});
