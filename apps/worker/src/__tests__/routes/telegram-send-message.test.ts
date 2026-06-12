import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAppendAuditLog = vi.hoisted(() => vi.fn());
const mockIsFeatureEnabled = vi.hoisted(() => vi.fn());
const mockGetAccessibleContactTelegramId = vi.hoisted(() => vi.fn());

vi.mock('../../redis', () => ({
	connection: {
		eval: vi.fn(),
		ttl: vi.fn(),
		set: vi.fn().mockResolvedValue('OK'),
		del: vi.fn().mockResolvedValue(1),
		get: vi.fn(),
	},
}));

vi.mock('../../gramjs/thread', () => ({
	sendToUser: vi.fn(),
	terminateUser: vi.fn().mockResolvedValue(undefined),
	setAuthPending: vi.fn(),
}));

vi.mock('../../queues/sync', () => ({
	syncQueue: { add: vi.fn() },
}));

vi.mock('../../queues/telegram-history-import', () => ({
	enqueueTelegramHistoryImport: vi.fn(),
	queueTelegramAiConsentCatchup: vi.fn(),
}));

vi.mock('@repo/shared/handoff-token', () => ({
	verifyHandoffToken: vi.fn(),
}));

vi.mock('@repo/crypto', () => ({
	encrypt: vi.fn(() => 'enc:mock'),
	generateSessionKek: vi.fn(async () => ({
		plaintext: Buffer.alloc(32, 1),
		ciphertextBlob: Buffer.alloc(32, 2),
	})),
}));

vi.mock('@repo/db', () => ({
	appendAuditLog: mockAppendAuditLog,
	getAccessibleContactTelegramId: mockGetAccessibleContactTelegramId,
	getUserTelegramAccountIds: vi.fn().mockResolvedValue(['123456789']),
	hasUserAiAnalysisConsent: vi.fn().mockResolvedValue(true),
	isFeatureEnabled: mockIsFeatureEnabled,
	isWorkspaceMember: vi.fn().mockResolvedValue(true),
	db: {
		query: {
			accounts: {
				findFirst: vi.fn().mockResolvedValue(null),
			},
		},
	},
	accounts: {},
	and: vi.fn(),
	eq: vi.fn(),
}));

import { sendToUser } from '../../gramjs/thread';
import { connection } from '../../redis';
import { telegram } from '../../routes/telegram';

process.env.INTERNAL_AUTH_SECRET = 'test-secret';

const SECRET = 'test-secret';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const CONTACT_ID = '22222222-2222-4222-8222-222222222222';
const IDEMP_KEY = '33333333-3333-4333-8333-333333333333';
const TG_ID = '123456789';

function postSendMessage(body: object) {
	return telegram.request('/send-message', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Internal-Secret': SECRET,
		},
		body: JSON.stringify(body),
	});
}

function postNotifySession(body: object) {
	return telegram.request('/notify-session', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Internal-Secret': SECRET,
		},
		body: JSON.stringify(body),
	});
}

const VALID_BODY = {
	userId: USER_ID,
	workspaceId: WORKSPACE_ID,
	contactId: CONTACT_ID,
	contactTelegramId: TG_ID,
	text: 'Hello there',
	idempotencyKey: IDEMP_KEY,
};

describe('POST /send-message — SEC-SEND-300 audit log', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubEnv('TELEGRAM_MTPROTO_ENABLED', 'true');
		vi.stubEnv('TELEGRAM_SEND_ENABLED', 'true');
		vi.stubEnv('TELEGRAM_MTPROTO_PER_INTERACTION_UNLOCK', 'false');
		// Rate limit: allow all
		(connection.eval as ReturnType<typeof vi.fn>).mockResolvedValue(1);
		(connection.ttl as ReturnType<typeof vi.fn>).mockResolvedValue(3600);
		// Idempotency: first request
		(connection.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');
		// Feature flags: enabled, no kill switch
		mockIsFeatureEnabled.mockImplementation((flag: string) => {
			if (flag === 'telegram_send_global_kill') return Promise.resolve(false);
			if (flag === 'telegram_send_enabled') return Promise.resolve(true);
			return Promise.resolve(false);
		});
		// GramJS: success
		(sendToUser as ReturnType<typeof vi.fn>).mockResolvedValue({ messageId: 42 });
		mockGetAccessibleContactTelegramId.mockResolvedValue(TG_ID);
	});

	it('calls appendAuditLog after successful send', async () => {
		const res = await postSendMessage(VALID_BODY);

		expect(res.status).toBe(200);
		expect(mockAppendAuditLog).toHaveBeenCalledOnce();
		expect(mockAppendAuditLog).toHaveBeenCalledWith({
			workspaceId: WORKSPACE_ID,
			actorType: 'user',
			actorId: USER_ID,
			action: 'send',
			resourceType: 'message',
			resourceId: CONTACT_ID,
			metadata: { idempotencyKey: IDEMP_KEY, telegramRecipient: 'present' },
		});
	});

	it('requires internal auth before exposing the disabled send state', async () => {
		vi.stubEnv('TELEGRAM_MTPROTO_ENABLED', 'false');
		vi.stubEnv('TELEGRAM_SEND_ENABLED', 'false');

		const res = await telegram.request('/send-message', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(VALID_BODY),
		});

		expect(res.status).toBe(401);
		expect(sendToUser).not.toHaveBeenCalled();
		expect(mockAppendAuditLog).not.toHaveBeenCalled();
	});

	it('rejects sends when the deployment send gate is disabled', async () => {
		vi.stubEnv('TELEGRAM_SEND_ENABLED', 'false');

		const res = await postSendMessage(VALID_BODY);

		expect(res.status).toBe(503);
		expect(sendToUser).not.toHaveBeenCalled();
		expect(mockAppendAuditLog).not.toHaveBeenCalled();
	});

	it('rejects sends while per-interaction MTProto unlock is enforced', async () => {
		vi.stubEnv('TELEGRAM_MTPROTO_PER_INTERACTION_UNLOCK', 'true');

		const res = await postSendMessage(VALID_BODY);

		expect(res.status).toBe(503);
		expect(sendToUser).not.toHaveBeenCalled();
		expect(mockAppendAuditLog).not.toHaveBeenCalled();
	});

	it('does NOT call appendAuditLog when send fails', async () => {
		(sendToUser as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('GramJS error'));

		const res = await postSendMessage(VALID_BODY);

		expect(res.status).toBe(502);
		expect(mockAppendAuditLog).not.toHaveBeenCalled();
	});

	it('redacts send failure details before logging worker errors', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const fakeBotToken = ['123456', 'ABCdefGHIjklMNOpqrSTU'].join(':');
		(sendToUser as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error(
				`${`GramJS failed BOT_TOKEN=${fakeBotToken} session=1`.padEnd(150, 'A')} investor@example.com +1 (415) 555-2671`,
			),
		);

		const res = await postSendMessage(VALID_BODY);

		expect(res.status).toBe(502);
		expect(await res.json()).toEqual({ error: 'Send failed' });
		const logged = consoleError.mock.calls.flat().join('\n');
		expect(logged).toContain('[send-message] GramJS error');
		expect(logged).not.toContain(fakeBotToken);
		expect(logged).not.toContain('investor@example.com');
		expect(logged).not.toContain('+1 (415) 555-2671');
		expect(logged).toContain('[redacted]');
		expect(logged).toContain('[email]');
		expect(logged).toContain('[phone]');
		expect(mockAppendAuditLog).not.toHaveBeenCalled();

		consoleError.mockRestore();
	});

	it('does NOT call appendAuditLog when rate limited', async () => {
		(connection.eval as ReturnType<typeof vi.fn>).mockResolvedValue(6); // over contact limit

		const res = await postSendMessage(VALID_BODY);

		expect(res.status).toBe(429);
		expect(mockAppendAuditLog).not.toHaveBeenCalled();
	});

	it('does NOT call appendAuditLog when deduplicated', async () => {
		(connection.set as ReturnType<typeof vi.fn>).mockResolvedValue(null); // SETNX failed

		const res = await postSendMessage(VALID_BODY);

		expect(res.status).toBe(409);
		expect(mockAppendAuditLog).not.toHaveBeenCalled();
	});

	it('does NOT call appendAuditLog when feature flag disabled', async () => {
		mockIsFeatureEnabled.mockImplementation((flag: string) => {
			if (flag === 'telegram_send_global_kill') return Promise.resolve(true);
			return Promise.resolve(false);
		});

		const res = await postSendMessage(VALID_BODY);

		expect(res.status).toBe(503);
		expect(mockAppendAuditLog).not.toHaveBeenCalled();
	});

	it('rejects sends for inaccessible or mismatched contacts', async () => {
		mockGetAccessibleContactTelegramId.mockResolvedValue(null);

		const res = await postSendMessage(VALID_BODY);

		expect(res.status).toBe(404);
		expect(sendToUser).not.toHaveBeenCalled();
		expect(mockAppendAuditLog).not.toHaveBeenCalled();
	});
});

describe('POST /notify-session — outbound Bot API gate', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubEnv('TELEGRAM_BOT_ENABLED', 'true');
		vi.stubEnv('TELEGRAM_SEND_ENABLED', 'true');
		vi.stubEnv('BOT_TOKEN', 'test-bot-token');
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.resolve({ ok: true, status: 200 } as Response)),
		);
	});

	it('rejects session notifications when the deployment send gate is disabled', async () => {
		vi.stubEnv('TELEGRAM_SEND_ENABLED', 'false');

		const res = await postNotifySession({ telegramUserId: TG_ID });

		expect(res.status).toBe(503);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('requires internal auth before exposing Bot API or send gate state', async () => {
		vi.stubEnv('TELEGRAM_BOT_ENABLED', 'false');
		vi.stubEnv('TELEGRAM_SEND_ENABLED', 'false');

		const res = await telegram.request('/notify-session', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ telegramUserId: TG_ID }),
		});

		expect(res.status).toBe(401);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('sends session notifications when Bot API and send gates are both enabled', async () => {
		const res = await postNotifySession({ telegramUserId: TG_ID });

		expect(res.status).toBe(200);
		expect(fetch).toHaveBeenCalledWith(
			'https://api.telegram.org/bottest-bot-token/sendMessage',
			expect.objectContaining({ method: 'POST' }),
		);
	});

	it('redacts Bot API tokens from notification failure logs and responses', async () => {
		const botToken = '123456:ABCdefGHIjklMNOpqrSTUvwxyz';
		const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.stubEnv('BOT_TOKEN', botToken);
		vi.stubGlobal(
			'fetch',
			vi.fn(() =>
				Promise.reject(
					new Error(`request failed https://api.telegram.org/bot${botToken}/sendMessage`),
				),
			),
		);

		const res = await postNotifySession({ telegramUserId: TG_ID });
		const body = await res.json();
		const logOutput = consoleErrorSpy.mock.calls.flat().join(' ');

		expect(res.status).toBe(200);
		expect(body).toEqual({ sent: false });
		expect(logOutput).not.toContain(botToken);
		expect(logOutput).toContain('https://api.telegram.org/bot[redacted]');

		consoleErrorSpy.mockRestore();
	});
});
