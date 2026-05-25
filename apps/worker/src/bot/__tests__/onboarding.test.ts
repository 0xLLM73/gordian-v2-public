import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockDbLimit = vi.fn();

vi.mock('@repo/db', () => ({
	accounts: {
		userId: 'user_id',
		providerId: 'provider_id',
		accountId: 'account_id',
	},
	workspaces: { id: 'id', ownerId: 'owner_id' },
	db: {
		select: () => ({
			from: () => ({
				where: () => ({
					limit: (...args: unknown[]) => mockDbLimit(...args),
				}),
			}),
		}),
	},
	eq: vi.fn(),
	and: vi.fn(),
}));

const mockCreateHandoffToken = vi.fn();

vi.mock('@repo/shared/handoff-token', () => ({
	createHandoffToken: mockCreateHandoffToken,
}));

vi.mock('grammy', () => {
	const handlers = new Map<string, (ctx: unknown) => Promise<void>>();
	const filters = new Map<
		string,
		{ filter: (ctx: unknown) => boolean; handler: (ctx: unknown) => Promise<void> }
	>();
	let filterCount = 0;
	return {
		Composer: vi.fn().mockImplementation(() => ({
			command: vi.fn((name: string, handler: (ctx: unknown) => Promise<void>) => {
				handlers.set(name, handler);
			}),
			on: vi.fn(() => ({
				filter: vi.fn(
					(filterFn: (ctx: unknown) => boolean, handler: (ctx: unknown) => Promise<void>) => {
						filters.set(`filter-${filterCount++}`, { filter: filterFn, handler });
					},
				),
			})),
			_handlers: handlers,
			_filters: filters,
		})),
	};
});

describe('onboarding bot commands', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.resetModules();
		vi.stubEnv('TELEGRAM_MTPROTO_ENABLED', 'true');
		mockDbLimit.mockReturnValue([]);
	});

	async function getHandler(name: string) {
		const mod = await import('../../bot/features/onboarding');
		const composer = mod.onboardingComposer as unknown as {
			_handlers: Map<string, (ctx: unknown) => Promise<void>>;
		};
		return composer._handlers.get(name);
	}

	function makeCtx(fromId?: number) {
		return {
			from: fromId ? { id: fromId } : undefined,
			session: { step: 'idle' as string, data: {} },
			reply: vi.fn(),
		};
	}

	it('/start resets session and shows welcome', async () => {
		const handler = await getHandler('start');
		const ctx = makeCtx(12345);
		await handler!(ctx);
		expect(ctx.session.step).toBe('idle');
		expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Welcome to Gordian'));
	});

	it('/link with no from.id replies error', async () => {
		const handler = await getHandler('link');
		const ctx = makeCtx();
		await handler!(ctx);
		expect(ctx.reply).toHaveBeenCalledWith('Could not determine your Telegram ID.');
	});

	it('/link explains public build when MTProto is disabled', async () => {
		vi.stubEnv('TELEGRAM_MTPROTO_ENABLED', 'false');

		const handler = await getHandler('link');
		const ctx = makeCtx(99999);
		await handler!(ctx);

		expect(mockDbLimit).not.toHaveBeenCalled();
		expect(ctx.reply).toHaveBeenCalledWith(
			expect.stringContaining('disabled in this public build'),
		);
	});

	it('/link for unlinked user starts phone flow', async () => {
		mockDbLimit.mockReturnValue([]);

		const handler = await getHandler('link');
		const ctx = makeCtx(99999);
		await handler!(ctx);

		expect(ctx.session.step).toBe('onboarding_phone');
		expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('phone number'));
	});

	it('/link for linked user generates handoff token', async () => {
		mockDbLimit
			.mockReturnValueOnce([{ userId: 'user-1' }]) // account found
			.mockReturnValueOnce([{ id: 'ws-1' }]); // workspace found

		mockCreateHandoffToken.mockResolvedValue('jwt-token-123');

		const handler = await getHandler('link');
		const ctx = makeCtx(12345);

		process.env.WEB_URL = 'https://example-crm.test';
		await handler!(ctx);

		expect(mockCreateHandoffToken).toHaveBeenCalledWith({
			userId: 'user-1',
			workspaceId: 'ws-1',
			action: 'bot-link',
		});
		expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('jwt-token-123'));
	});

	it('/link for linked user without workspace shows message', async () => {
		mockDbLimit
			.mockReturnValueOnce([{ userId: 'user-1' }]) // account found
			.mockReturnValueOnce([]); // no workspace

		const handler = await getHandler('link');
		const ctx = makeCtx(12345);
		await handler!(ctx);

		expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('no workspace was found'));
	});

	it('/help shows available commands', async () => {
		const handler = await getHandler('help');
		const ctx = makeCtx(12345);
		await handler!(ctx);
		expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('/deals'));
		expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('/brief'));
	});

	it('/cancel resets to idle', async () => {
		const handler = await getHandler('cancel');
		const ctx = makeCtx(12345);
		ctx.session.step = 'onboarding_phone';
		await handler!(ctx);
		expect(ctx.session.step).toBe('idle');
		expect(ctx.reply).toHaveBeenCalledWith('Action cancelled. Back to idle.');
	});
});
