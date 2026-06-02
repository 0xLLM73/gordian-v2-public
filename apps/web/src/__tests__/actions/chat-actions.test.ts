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
const CONTACT_ID = '660e8400-e29b-41d4-a716-446655440001';
const MOCK_ENVELOPE = {
	encryptedWrk: Buffer.from('test'),
	kmsContext: { workspaceId: WORKSPACE_ID },
	wrkVersion: 1,
};

const mockGetWorkspaceEnvelope = vi.fn();
vi.mock('@/lib/workspace', () => ({
	getUserWorkspaceId: vi.fn(() => Promise.resolve(WORKSPACE_ID)),
	getWorkspaceEnvelope: mockGetWorkspaceEnvelope,
}));

const mockGetAccessibleContact = vi.fn();
const mockAppendAuditLog = vi.fn();
vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	createCommitment: vi.fn().mockResolvedValue({ id: 'c1', title: 'Test' }),
	createDeal: vi.fn().mockResolvedValue(null),
	createGoal: vi.fn().mockResolvedValue(null),
	updateDeal: vi.fn().mockResolvedValue(null),
	getAccessibleContact: (...args: unknown[]) => mockGetAccessibleContact(...args),
	trackBehavior: vi.fn().mockResolvedValue(null),
	appendAuditLog: mockAppendAuditLog,
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('executeTelegramSendAction', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubEnv('WORKER_URL', 'http://localhost:3001');
		vi.stubEnv('WORKER_INTERNAL_SECRET', 'test-secret');
		vi.stubEnv('TELEGRAM_SEND_ENABLED', 'true');
		mockGetWorkspaceEnvelope.mockResolvedValue(MOCK_ENVELOPE);
	});

	it('sends message to worker with correct payload', async () => {
		const { executeTelegramSendAction } = await import('@/app/actions/chat-actions');

		mockGetAccessibleContact.mockResolvedValue({
			id: CONTACT_ID,
			firstName: 'Alice',
			telegramId: '12345',
		});
		mockFetch.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ success: true }),
		});

		const result = await executeTelegramSendAction({
			contactId: CONTACT_ID,
			draftText: 'Hey Alice!',
			contactName: 'Alice',
		});

		expect(result?.data).toEqual({ success: true, contactName: 'Alice' });
		expect(mockFetch).toHaveBeenCalledWith(
			'http://localhost:3001/telegram/send-message',
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({
					'Content-Type': 'application/json',
					'X-Internal-Secret': 'test-secret',
				}),
			}),
		);

		const body = JSON.parse(mockFetch.mock.calls[0][1].body);
		expect(body.userId).toBe('user-1');
		expect(body.workspaceId).toBe(WORKSPACE_ID);
		expect(body.contactId).toBe(CONTACT_ID);
		expect(body.contactTelegramId).toBe('12345');
		expect(body.text).toBe('Hey Alice!');
		expect(body.idempotencyKey).toBeDefined();
		expect(mockAppendAuditLog).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: { channel: 'telegram', contactNameProvided: true },
			}),
		);
		expect(JSON.stringify(mockAppendAuditLog.mock.calls[0][0].metadata)).not.toContain('Alice');
	});

	it('does not call worker when Telegram sending is disabled', async () => {
		vi.resetModules();
		process.env.TELEGRAM_SEND_ENABLED = 'false';
		const { executeTelegramSendAction } = await import('@/app/actions/chat-actions');
		mockGetAccessibleContact.mockResolvedValue({
			id: CONTACT_ID,
			firstName: 'Alice',
			telegramId: '12345',
		});

		const result = await executeTelegramSendAction({
			contactId: CONTACT_ID,
			draftText: 'Hey Alice!',
			contactName: 'Alice',
		});

		expect(result?.serverError).toBeDefined();
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('fails when contact has no telegramId', async () => {
		const { executeTelegramSendAction } = await import('@/app/actions/chat-actions');

		mockGetAccessibleContact.mockResolvedValue({
			id: CONTACT_ID,
			firstName: 'Bob',
			telegramId: null,
		});

		const result = await executeTelegramSendAction({
			contactId: CONTACT_ID,
			draftText: 'Hello Bob',
			contactName: 'Bob',
		});

		expect(result?.serverError).toBeDefined();
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('fails when contact not found', async () => {
		const { executeTelegramSendAction } = await import('@/app/actions/chat-actions');

		mockGetAccessibleContact.mockResolvedValue(null);

		const result = await executeTelegramSendAction({
			contactId: CONTACT_ID,
			draftText: 'Hello',
			contactName: 'Unknown',
		});

		expect(result?.serverError).toBeDefined();
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('propagates worker error response', async () => {
		const { executeTelegramSendAction } = await import('@/app/actions/chat-actions');

		mockGetAccessibleContact.mockResolvedValue({
			id: CONTACT_ID,
			firstName: 'Alice',
			telegramId: '12345',
		});
		mockFetch.mockResolvedValue({
			ok: false,
			json: () => Promise.resolve({ error: 'Rate limit: max 5/contact/hour' }),
		});

		const result = await executeTelegramSendAction({
			contactId: CONTACT_ID,
			draftText: 'Hello',
			contactName: 'Alice',
		});

		expect(result?.serverError).toBeDefined();
	});

	it('validates input schema — rejects empty draftText', async () => {
		const { executeTelegramSendAction } = await import('@/app/actions/chat-actions');

		const result = await executeTelegramSendAction({
			contactId: CONTACT_ID,
			draftText: '',
			contactName: 'Alice',
		});

		expect(result?.validationErrors).toBeDefined();
	});

	it('validates input schema — rejects invalid contactId', async () => {
		const { executeTelegramSendAction } = await import('@/app/actions/chat-actions');

		const result = await executeTelegramSendAction({
			contactId: 'not-a-uuid',
			draftText: 'Hello',
			contactName: 'Alice',
		});

		expect(result?.validationErrors).toBeDefined();
	});
});
