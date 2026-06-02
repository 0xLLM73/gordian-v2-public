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
	isFeatureEnabled: mockIsFeatureEnabled,
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

	it('sends session notifications when Bot API and send gates are both enabled', async () => {
		const res = await postNotifySession({ telegramUserId: TG_ID });

		expect(res.status).toBe(200);
		expect(fetch).toHaveBeenCalledWith(
			'https://api.telegram.org/bottest-bot-token/sendMessage',
			expect.objectContaining({ method: 'POST' }),
		);
	});
});
