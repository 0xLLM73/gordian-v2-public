import { describe, expect, it, vi } from 'vitest';

// Mock all bot dependencies so we can import sanitizeUpdate without initializing the bot
vi.mock('@grammyjs/runner', () => ({ sequentialize: vi.fn(() => vi.fn()) }));
vi.mock('@grammyjs/storage-redis', () => ({ RedisAdapter: vi.fn() }));
vi.mock('grammy', () => ({
	// biome-ignore lint/complexity/useArrowFunction: Vitest 4 class mocks must be constructible.
	Bot: vi.fn(function () {
		return {
			use: vi.fn(),
			catch: vi.fn(),
		};
	}),
	session: vi.fn(() => vi.fn()),
}));
vi.mock('../../redis', () => ({ connection: {} }));
vi.mock('../features/briefs', () => ({ briefsComposer: {} }));
vi.mock('../features/callbacks', () => ({ callbacksComposer: {} }));
vi.mock('../features/deals', () => ({ dealsComposer: {} }));
vi.mock('../features/goals', () => ({ goalsComposer: {} }));
vi.mock('../features/notifications', () => ({ notificationsComposer: {} }));
vi.mock('../features/onboarding', () => ({ onboardingComposer: {} }));
vi.mock('../features/summary', () => ({ summaryComposer: {} }));
vi.mock('../features/follow-up-plans', () => ({ followUpPlansComposer: {} }));
vi.mock('../features/calibration', () => ({ calibrationComposer: {} }));
vi.mock('../features/digest', () => ({ digestComposer: {} }));

describe('sanitizeUpdate (SEC-025)', () => {
	it('strips PII from message updates — retains only structural fields', async () => {
		const { sanitizeUpdate } = await import('../index');

		const update = {
			update_id: 12345,
			message: {
				message_id: 99,
				text: 'Call me at +1-555-123-4567',
				date: 1708300000,
				from: {
					id: 777,
					first_name: 'Alice',
					last_name: 'Smith',
					phone_number: '+15551234567',
				},
				chat: {
					id: 888,
					type: 'private',
					title: 'My Secret Chat',
				},
			},
		};

		const sanitized = sanitizeUpdate(update as Record<string, unknown>);

		// Must contain structural fields
		expect(sanitized.update_id).toBe(12345);
		expect((sanitized.message as Record<string, unknown>).message_id).toBe(99);
		expect((sanitized.message as Record<string, unknown>).chat_id).toBe(888);
		expect((sanitized.message as Record<string, unknown>).chat_type).toBe('private');
		expect((sanitized.message as Record<string, unknown>).date).toBe(1708300000);

		// Must NOT contain PII
		const str = JSON.stringify(sanitized);
		expect(str).not.toContain('Alice');
		expect(str).not.toContain('Smith');
		expect(str).not.toContain('+15551234567');
		expect(str).not.toContain('Call me at');
		expect(str).not.toContain('My Secret Chat');
	});

	it('strips PII from callback_query updates', async () => {
		const { sanitizeUpdate } = await import('../index');

		const update = {
			update_id: 99999,
			callback_query: {
				id: 'cbq-1',
				data: 'action:approve',
				from: {
					id: 42,
					first_name: 'Bob',
					last_name: 'Jones',
				},
			},
		};

		const sanitized = sanitizeUpdate(update as Record<string, unknown>);

		expect(sanitized.update_id).toBe(99999);
		expect((sanitized.callback_query as Record<string, unknown>).id).toBe('cbq-1');
		expect((sanitized.callback_query as Record<string, unknown>).data).toBe('action:approve');

		const str = JSON.stringify(sanitized);
		expect(str).not.toContain('Bob');
		expect(str).not.toContain('Jones');
	});

	it('handles updates with no message or callback_query', async () => {
		const { sanitizeUpdate } = await import('../index');

		const update = { update_id: 1 };
		const sanitized = sanitizeUpdate(update);
		expect(sanitized).toEqual({ update_id: 1 });
	});

	it('namespaces Redis-backed grammY sessions', async () => {
		const previousToken = process.env.BOT_TOKEN;
		process.env.BOT_TOKEN = 'test-bot-token';
		try {
			const grammy = await import('grammy');
			const { GRAMMY_SESSION_KEY_PREFIX, initBot } = await import('../index');
			const sessionMock = vi.mocked(grammy.session);
			sessionMock.mockClear();

			await initBot();

			expect(sessionMock).toHaveBeenCalledWith(
				expect.objectContaining({
					prefix: GRAMMY_SESSION_KEY_PREFIX,
				}),
			);
		} finally {
			if (previousToken === undefined) {
				process.env.BOT_TOKEN = undefined;
			} else {
				process.env.BOT_TOKEN = previousToken;
			}
		}
	});
});
