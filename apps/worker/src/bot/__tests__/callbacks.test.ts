import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUpdateCommitmentStatus = vi.fn();
const mockGetActiveCommitments = vi.fn();

vi.mock('@repo/db', () => ({
	updateCommitmentStatus: mockUpdateCommitmentStatus,
	getActiveCommitments: mockGetActiveCommitments,
}));

// Mock grammY Composer to capture the handler directly (bypasses filter checks)
let capturedHandler: ((ctx: unknown, next: () => void) => Promise<void>) | null = null;
vi.mock('grammy', () => ({
	Composer: class MockComposer {
		on(_filter: string, handler: (ctx: unknown, next: () => void) => Promise<void>) {
			capturedHandler = handler;
		}
		middleware() {
			return capturedHandler;
		}
	},
}));

function createMockCtx(data: string, workspaceId?: string, envelope?: unknown) {
	return {
		callbackQuery: { data },
		session: {
			data: {
				workspaceId,
				...(envelope ? { envelope } : {}),
			},
		},
		answerCallbackQuery: vi.fn(),
		editMessageReplyMarkup: vi.fn(),
		reply: vi.fn(),
	};
}

const mockEnvelope = {
	encryptedWrk: Buffer.from('test').toString('base64'),
	kmsContext: { WorkspaceID: 'ws-1' },
	wrkVersion: 1,
};

describe('callbacksComposer', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('fulfill:{id} marks commitment completed and removes markup', async () => {
		mockUpdateCommitmentStatus.mockResolvedValue({ id: 'commit-1' });

		const ctx = createMockCtx('fulfill:commit-1', 'ws-1');
		const next = vi.fn();

		const { callbacksComposer } = await import('../../bot/features/callbacks');
		const handler = callbacksComposer.middleware() as (
			ctx: unknown,
			next: () => void,
		) => Promise<void>;
		await handler(ctx, next);

		expect(mockUpdateCommitmentStatus).toHaveBeenCalledWith('ws-1', 'commit-1', 'completed');
		expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: 'Marked as completed!' });
		expect(ctx.editMessageReplyMarkup).toHaveBeenCalledWith({ reply_markup: undefined });
	});

	it('dismiss:{id} marks commitment dismissed and removes markup', async () => {
		mockUpdateCommitmentStatus.mockResolvedValue({ id: 'commit-2' });

		const ctx = createMockCtx('dismiss:commit-2', 'ws-1');
		const next = vi.fn();

		const { callbacksComposer } = await import('../../bot/features/callbacks');
		const handler = callbacksComposer.middleware() as (
			ctx: unknown,
			next: () => void,
		) => Promise<void>;
		await handler(ctx, next);

		expect(mockUpdateCommitmentStatus).toHaveBeenCalledWith('ws-1', 'commit-2', 'dismissed');
		expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: 'Dismissed.' });
		expect(ctx.editMessageReplyMarkup).toHaveBeenCalledWith({ reply_markup: undefined });
	});

	it('snooze:{id} answers with snooze message and removes markup', async () => {
		const ctx = createMockCtx('snooze:commit-3', 'ws-1');
		const next = vi.fn();

		const { callbacksComposer } = await import('../../bot/features/callbacks');
		const handler = callbacksComposer.middleware() as (
			ctx: unknown,
			next: () => void,
		) => Promise<void>;
		await handler(ctx, next);

		expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
			text: 'Snoozed. Will remind you later.',
		});
		expect(ctx.editMessageReplyMarkup).toHaveBeenCalledWith({ reply_markup: undefined });
	});

	it('brief_detail:commitments lists active commitments', async () => {
		mockGetActiveCommitments.mockResolvedValue([
			{ description: 'Send report', dueDate: '2026-03-01' },
			{ description: 'Follow up with VC', dueDate: '2026-03-05' },
		]);

		const ctx = createMockCtx('brief_detail:commitments', 'ws-1', mockEnvelope);
		const next = vi.fn();

		const { callbacksComposer } = await import('../../bot/features/callbacks');
		const handler = callbacksComposer.middleware() as (
			ctx: unknown,
			next: () => void,
		) => Promise<void>;
		await handler(ctx, next);

		expect(ctx.answerCallbackQuery).toHaveBeenCalled();
		expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Active commitments'));
	});

	it('brief_detail:followups lists overdue commitments', async () => {
		mockGetActiveCommitments.mockResolvedValue([
			{ description: 'Overdue task', dueDate: '2020-01-01' },
			{ description: 'Future task', dueDate: '2099-12-31' },
		]);

		const ctx = createMockCtx('brief_detail:followups', 'ws-1', mockEnvelope);
		const next = vi.fn();

		const { callbacksComposer } = await import('../../bot/features/callbacks');
		const handler = callbacksComposer.middleware() as (
			ctx: unknown,
			next: () => void,
		) => Promise<void>;
		await handler(ctx, next);

		expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Overdue follow-ups'));
	});

	it('brief_detail:activity replies with dashboard redirect', async () => {
		const ctx = createMockCtx('brief_detail:activity', 'ws-1', mockEnvelope);
		const next = vi.fn();

		const { callbacksComposer } = await import('../../bot/features/callbacks');
		const handler = callbacksComposer.middleware() as (
			ctx: unknown,
			next: () => void,
		) => Promise<void>;
		await handler(ctx, next);

		expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('web dashboard'));
	});

	it('unknown prefix calls next()', async () => {
		const ctx = createMockCtx('unknown_action:123', 'ws-1');
		const next = vi.fn();

		const { callbacksComposer } = await import('../../bot/features/callbacks');
		const handler = callbacksComposer.middleware() as (
			ctx: unknown,
			next: () => void,
		) => Promise<void>;
		await handler(ctx, next);

		expect(next).toHaveBeenCalled();
		expect(ctx.answerCallbackQuery).not.toHaveBeenCalled();
	});

	it('missing workspaceId answers with onboarding message', async () => {
		const ctx = createMockCtx('fulfill:commit-1', undefined);
		const next = vi.fn();

		const { callbacksComposer } = await import('../../bot/features/callbacks');
		const handler = callbacksComposer.middleware() as (
			ctx: unknown,
			next: () => void,
		) => Promise<void>;
		await handler(ctx, next);

		expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
			text: 'Please complete onboarding first.',
		});
		expect(mockUpdateCommitmentStatus).not.toHaveBeenCalled();
	});

	it('empty entityId answers with invalid action', async () => {
		const ctx = createMockCtx('fulfill:', 'ws-1');
		const next = vi.fn();

		const { callbacksComposer } = await import('../../bot/features/callbacks');
		const handler = callbacksComposer.middleware() as (
			ctx: unknown,
			next: () => void,
		) => Promise<void>;
		await handler(ctx, next);

		expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: 'Invalid action.' });
	});

	it('catches errors and answers with fallback message', async () => {
		mockUpdateCommitmentStatus.mockRejectedValue(new Error('DB down'));

		const ctx = createMockCtx('fulfill:commit-1', 'ws-1');
		const next = vi.fn();

		const { callbacksComposer } = await import('../../bot/features/callbacks');
		const handler = callbacksComposer.middleware() as (
			ctx: unknown,
			next: () => void,
		) => Promise<void>;
		await handler(ctx, next);

		expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
			text: 'Something went wrong. Try again.',
		});
	});
});
