import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockValues = vi.fn<(value: Record<string, unknown>) => Promise<void>>(() =>
	Promise.resolve(),
);
const mockInsert = vi.fn(() => ({ values: mockValues }));

vi.mock('../client', () => ({
	db: {
		insert: mockInsert,
	},
}));

describe('audit log redaction guardrails', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockValues.mockReturnValue(Promise.resolve());
	});

	it('keeps structural audit metadata and strips raw sensitive payload fields', async () => {
		const { appendAuditLog } = await import('../dal/audit-log');
		const fakeOpenAiKey = ['sk', 'testtesttesttesttesttest'].join('-');

		appendAuditLog({
			workspaceId: '11111111-1111-4111-8111-111111111111',
			actorType: 'system',
			actorId: 'sync-worker',
			action: 'generate',
			resourceType: 'message',
			metadata: {
				operation: 'telegram_import_auto_connection_reprocess',
				runId: '22222222-2222-4222-8222-222222222222',
				contactsProcessed: 3,
				messagesQueued: 12,
				sourceAccountFiltered: true,
				messageText: 'CONFIDENTIAL MESSAGE BODY',
				prompt: 'Summarize the private investor call',
				telegramId: '123456789',
				sourceAccountId: '987654321',
				apiKey: fakeOpenAiKey,
				email: 'investor@example.com',
				databaseUrl: 'postgres://user:password@localhost:5432/app',
				unapprovedFreeText: 'wire details and private notes',
			},
		});

		expect(mockValues).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({
					operation: 'telegram_import_auto_connection_reprocess',
					runId: '22222222-2222-4222-8222-222222222222',
					contactsProcessed: 3,
					messagesQueued: 12,
					sourceAccountFiltered: true,
				}),
			}),
		);

		const stored = mockValues.mock.calls[0]?.[0] as { metadata: Record<string, unknown> };
		const serialized = JSON.stringify(stored.metadata);

		expect(stored.metadata).not.toHaveProperty('unapprovedFreeText');
		expect(serialized).not.toContain('CONFIDENTIAL MESSAGE BODY');
		expect(serialized).not.toContain('Summarize the private investor call');
		expect(serialized).not.toContain('123456789');
		expect(serialized).not.toContain('987654321');
		expect(serialized).not.toContain(fakeOpenAiKey);
		expect(serialized).not.toContain('investor@example.com');
		expect(serialized).not.toContain('password');
		expect(serialized).toContain('[redacted]');
	});

	it('redacts audit append failures before writing to process logs', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const { appendAuditLog } = await import('../dal/audit-log');
		const fakeOpenAiKey = ['sk', 'testtesttesttesttesttest'].join('-');
		mockValues.mockReturnValueOnce(
			Promise.reject(
				new Error(
					`insert failed OPENAI_API_KEY=${fakeOpenAiKey} redis://default:secret@localhost:6379 investor@example.com +1 (415) 555-2671`,
				),
			),
		);

		appendAuditLog({
			workspaceId: '11111111-1111-4111-8111-111111111111',
			actorType: 'system',
			actorId: 'sync-worker',
			action: 'sync',
			resourceType: 'message',
			metadata: { operation: 'telegram_import_auto_connection_reprocess' },
		});
		await Promise.resolve();
		await Promise.resolve();

		const logged = consoleError.mock.calls.flat().join('\n');
		expect(logged).toContain('[audit-log] Failed to append audit log');
		expect(logged).not.toContain(fakeOpenAiKey);
		expect(logged).not.toContain('default:secret');
		expect(logged).not.toContain('investor@example.com');
		expect(logged).not.toContain('+1 (415) 555-2671');
		expect(logged).toContain('[redacted]');
		expect(logged).toContain('[email]');
		expect(logged).toContain('[phone]');

		consoleError.mockRestore();
	});
});
