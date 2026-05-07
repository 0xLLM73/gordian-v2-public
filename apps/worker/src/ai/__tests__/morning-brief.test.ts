import { saveBrief } from '@repo/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { selectPromptVariant } from '../bandit';
import { inferWithCache } from '../cached-inference';
import { generateEmbedding } from '../embeddings';
import { msUntilHour } from '../morning-brief';

// Capture the briefs Worker processor when the module initializes
const processorStore = vi.hoisted(() => ({
	fn: null as ((job: unknown) => Promise<unknown>) | null,
}));

const mockBroadcastUpdate = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const mockDbSelect = vi.hoisted(() => vi.fn());

vi.mock('bullmq', () => ({
	Worker: vi.fn(function MockWorker(name: string, processor: (job: unknown) => Promise<unknown>) {
		if (name === 'briefs') processorStore.fn = processor;
		return { on: vi.fn() };
	}),
	Queue: vi.fn(function MockQueue() {
		return { add: vi.fn(() => Promise.resolve()), on: vi.fn() };
	}),
}));

vi.mock('../../realtime/broadcast', () => ({
	broadcastUpdate: mockBroadcastUpdate,
}));

const mockSendMessage = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../../bot/api', () => ({
	getBotApi: vi.fn(() => ({ api: { sendMessage: mockSendMessage } })),
}));

vi.mock('@repo/db', () => ({
	getPreferences: vi.fn(() =>
		Promise.resolve({
			briefEnabled: true,
			briefTime: 7,
			briefDays: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
			timezone: 'UTC',
		}),
	),
	getActiveCommitments: vi.fn(() => Promise.resolve([])),
	getPendingRecommendations: vi.fn(() => Promise.resolve([])),
	getOutcomeStats: vi.fn(() => Promise.resolve([])),
	hybridSearch: vi.fn(() => Promise.resolve([])),
	saveBrief: vi.fn(() => Promise.resolve('brief-id-1')),
	getCalibrationForAI: vi.fn(() => Promise.resolve(null)),
	listConnections: vi.fn(() => Promise.resolve([])),
	listDeals: vi.fn(() => Promise.resolve([])),
	getStageVelocityStats: vi.fn(() => Promise.resolve({ avgDaysPerStage: {}, conversionRates: {} })),
	listGoals: vi.fn(() => Promise.resolve([])),
	decayStaleEdges: vi.fn(() => Promise.resolve()),
	db: { select: mockDbSelect },
	workspaces: {},
	accounts: { accountId: 'accountId', userId: 'userId', providerId: 'providerId' },
	contacts: { id: 'id', workspaceId: 'workspace_id', lastMessageAt: 'last_message_at' },
	eq: vi.fn(),
	and: vi.fn(),
	inArray: vi.fn(),
	sql: vi.fn(),
}));

vi.mock('../precedents', () => ({
	findRelevantPrecedents: vi.fn(() => Promise.resolve([])),
	formatPrecedents: vi.fn(() => ''),
}));

vi.mock('@repo/crypto', () => ({
	deriveKeys: vi.fn(),
	unwrapWrk: vi.fn(),
}));

vi.mock('../../../redis', () => ({ connection: {} }));
vi.mock('../bandit', () => ({ selectPromptVariant: vi.fn() }));
vi.mock('../cached-inference', () => ({ inferWithCache: vi.fn() }));
vi.mock('../embeddings', () => ({ generateEmbedding: vi.fn() }));

/** Build a chainable db.select mock result */
function chainResult(rows: unknown[]) {
	return {
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows),
			}),
		}),
	};
}

/** Helper: mock db.select to return a workspace row + Telegram account for push. */
function mockWorkspaceEnvelope() {
	mockDbSelect
		// First call: workspace envelope lookup
		.mockReturnValueOnce(
			chainResult([
				{
					encryptedWrk: Buffer.from('test-wrk-key').toString('base64'),
					kmsContext: { workspaceId: 'ws-1' },
					wrkVersion: 1,
				},
			]),
		)
		// Second call: accounts lookup for Telegram push
		.mockReturnValueOnce(chainResult([{ accountId: '123456789' }]));
}

/** Helper: mock db.select to return no workspace (workspace not found). */
function mockWorkspaceNotFound() {
	mockDbSelect.mockReturnValue(chainResult([]));
}

describe('morning-brief — workspace not found', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('skips brief and reschedules when workspace not found in DB', async () => {
		await import('../morning-brief');
		expect(processorStore.fn).not.toBeNull();

		mockWorkspaceNotFound();

		await processorStore.fn?.({
			data: { userId: 'user-1', workspaceId: 'ws-1' },
		});

		// No broadcast when workspace is missing
		expect(mockBroadcastUpdate).not.toHaveBeenCalled();
		expect(saveBrief).not.toHaveBeenCalled();
	});
});

describe('msUntilHour', () => {
	it('returns a positive number of milliseconds', () => {
		const ms = msUntilHour(7, 'America/New_York');
		expect(ms).toBeGreaterThan(0);
		// Should be at most 24 hours
		expect(ms).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
	});

	it('returns at most 24h for any timezone', () => {
		const timezones = ['America/New_York', 'Europe/London', 'Asia/Tokyo', 'UTC'];
		for (const tz of timezones) {
			const ms = msUntilHour(7, tz);
			expect(ms).toBeGreaterThan(0);
			expect(ms).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
		}
	});

	it('handles different target hours', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-05T10:30:00Z'));

		const ms0 = msUntilHour(0, 'UTC');
		const ms12 = msUntilHour(12, 'UTC');
		const ms23 = msUntilHour(23, 'UTC');

		// All should be positive and <= 24h
		expect(ms0).toBeGreaterThan(0);
		expect(ms0).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
		expect(ms12).toBeGreaterThan(0);
		expect(ms12).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
		expect(ms23).toBeGreaterThan(0);
		expect(ms23).toBeLessThanOrEqual(24 * 60 * 60 * 1000);

		vi.useRealTimers();
	});

	it('handles midnight UTC without returning a negative delay', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-05T00:20:00Z'));

		const ms = msUntilHour(0, 'UTC');
		const hours = ms / (60 * 60 * 1000);

		expect(hours).toBeGreaterThanOrEqual(0);
		expect(hours).toBeLessThanOrEqual(24);

		vi.useRealTimers();
	});

	it('returns approximately 24h when current time equals target hour', () => {
		// Get current UTC hour
		const now = new Date();
		const currentHour = now.getUTCHours();
		const ms = msUntilHour(currentHour, 'UTC');

		// Should be close to 24h (minus a few seconds of test execution time)
		// or close to 0h if we're exactly at the start of the hour
		const hours = ms / (60 * 60 * 1000);
		// Either wraps around to ~24h or is 0 if exactly at the hour boundary
		expect(hours).toBeGreaterThanOrEqual(0);
		expect(hours).toBeLessThanOrEqual(24);
	});
});

describe('briefWorker — bandit switch and saveBrief', () => {
	const TONE_TRACE_ID = '770e8400-e29b-41d4-a716-446655440002';
	const DETAIL_TRACE_ID = '880e8400-e29b-41d4-a716-446655440003';

	const fakeJob = {
		data: {
			userId: 'user-1',
			workspaceId: 'ws-1',
			timezone: 'UTC',
		},
	};

	beforeEach(async () => {
		vi.clearAllMocks();
		// Ensure module is loaded and processorStore.fn is populated
		await import('../morning-brief');

		// Resolve envelope from DB
		mockWorkspaceEnvelope();

		// generateEmbedding is called inside buildUserContext — must return a Promise
		vi.mocked(generateEmbedding).mockResolvedValue([0.1, 0.2, 0.3] as unknown as Awaited<
			ReturnType<typeof generateEmbedding>
		>);

		// Configure bandit mocks for valid selections
		vi.mocked(selectPromptVariant)
			.mockResolvedValueOnce({ variant: 'brief_tone_casual', traceId: TONE_TRACE_ID })
			.mockResolvedValueOnce({ variant: 'brief_detail_low', traceId: DETAIL_TRACE_ID });

		// Configure inference mock for valid response
		vi.mocked(inferWithCache).mockResolvedValue({
			content: [{ type: 'text', text: 'Good morning! Your brief is ready.' }],
		} as Awaited<ReturnType<typeof inferWithCache>>);
	});

	it('calls generateBriefWithBandit (selectPromptVariant x2) when envelope resolved from DB', async () => {
		await processorStore.fn?.(fakeJob);

		// Two bandit arms: tone + detail
		expect(selectPromptVariant).toHaveBeenCalledTimes(2);
		expect(selectPromptVariant).toHaveBeenCalledWith(
			'morning_brief_tone',
			expect.any(Array),
			'user-1',
		);
		expect(selectPromptVariant).toHaveBeenCalledWith(
			'morning_brief_detail',
			expect.any(Array),
			'user-1',
		);
	});

	it('calls saveBrief with bandit result and workspace context when envelope resolved from DB', async () => {
		await processorStore.fn?.(fakeJob);

		expect(saveBrief).toHaveBeenCalledWith(
			'ws-1',
			'user-1',
			expect.objectContaining({
				toneTraceId: TONE_TRACE_ID,
				detailTraceId: DETAIL_TRACE_ID,
				toneVariant: 'brief_tone_casual',
				detailVariant: 'brief_detail_low',
			}),
			expect.objectContaining({ wrkVersion: 1 }),
		);
	});

	it('broadcasts ready notification (no text) after saveBrief completes', async () => {
		await processorStore.fn?.(fakeJob);

		expect(mockBroadcastUpdate).toHaveBeenCalledWith(
			'ws-1',
			'morning-brief',
			expect.objectContaining({ ready: true }),
		);
		const payload = (mockBroadcastUpdate.mock.calls as unknown as unknown[][])[0][2] as Record<
			string,
			unknown
		>;
		expect(payload).not.toHaveProperty('text');
	});

	it('generates and saves brief when envelope resolved from DB', async () => {
		await processorStore.fn?.(fakeJob);

		// Workspace envelope was fetched via db.select
		expect(mockDbSelect).toHaveBeenCalled();
		// Both generation and storage occurred
		expect(selectPromptVariant).toHaveBeenCalledTimes(2);
		expect(saveBrief).toHaveBeenCalledWith(
			'ws-1',
			'user-1',
			expect.objectContaining({ text: expect.any(String) }),
			expect.objectContaining({ wrkVersion: 1 }),
		);
	});
});

describe('briefWorker — preferences guard', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		await import('../morning-brief');
	});

	it('skips generation when briefEnabled is false', async () => {
		const { getPreferences } = await import('@repo/db');
		vi.mocked(getPreferences).mockResolvedValue({
			briefEnabled: false,
			briefTime: 7,
			briefDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
			timezone: 'UTC',
		} as Awaited<ReturnType<typeof getPreferences>>);

		await processorStore.fn?.({
			data: { userId: 'user-1', workspaceId: 'ws-1', timezone: 'UTC' },
		});

		// No broadcast, no bandit, no save
		expect(mockBroadcastUpdate).not.toHaveBeenCalled();
		expect(selectPromptVariant).not.toHaveBeenCalled();
		expect(saveBrief).not.toHaveBeenCalled();
	});
});

describe('briefWorker — Telegram push', () => {
	const fakeJob = {
		data: { userId: 'user-1', workspaceId: 'ws-1', timezone: 'UTC' },
	};

	beforeEach(async () => {
		vi.clearAllMocks();
		await import('../morning-brief');

		// Re-set getPreferences — the "preferences guard" test leaks briefEnabled:false
		// (clearAllMocks doesn't clear mockResolvedValue implementations)
		const db = await import('@repo/db');
		vi.mocked(db.getPreferences).mockResolvedValue({
			briefEnabled: true,
			briefTime: 7,
			briefDays: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
			timezone: 'UTC',
		} as Awaited<ReturnType<typeof db.getPreferences>>);

		vi.mocked(generateEmbedding).mockResolvedValue([0.1, 0.2, 0.3] as unknown as Awaited<
			ReturnType<typeof generateEmbedding>
		>);
		vi.mocked(selectPromptVariant)
			.mockResolvedValueOnce({ variant: 'brief_tone_casual', traceId: 'tone-1' })
			.mockResolvedValueOnce({ variant: 'brief_detail_low', traceId: 'detail-1' });
		vi.mocked(inferWithCache).mockResolvedValue({
			content: [{ type: 'text', text: 'Good morning!\n\nURGENT\n- Send report to Alice' }],
		} as Awaited<ReturnType<typeof inferWithCache>>);
	});

	it('sends brief to Telegram when user has a Telegram account', async () => {
		mockWorkspaceEnvelope();

		await processorStore.fn?.(fakeJob);

		expect(mockSendMessage).toHaveBeenCalledWith(
			'123456789',
			expect.stringContaining('Good morning!'),
			{ parse_mode: 'HTML' },
		);
	});

	it('skips Telegram push when user has no Telegram account', async () => {
		mockDbSelect
			// workspace envelope
			.mockReturnValueOnce(
				chainResult([
					{
						encryptedWrk: Buffer.from('test-wrk-key').toString('base64'),
						kmsContext: { workspaceId: 'ws-1' },
						wrkVersion: 1,
					},
				]),
			)
			// accounts lookup — no Telegram account
			.mockReturnValueOnce(chainResult([]));

		await processorStore.fn?.(fakeJob);

		expect(mockSendMessage).not.toHaveBeenCalled();
		// Brief should still be saved and broadcast
		expect(saveBrief).toHaveBeenCalled();
		expect(mockBroadcastUpdate).toHaveBeenCalled();
	});

	it('does not break the pipeline when Telegram push fails', async () => {
		mockWorkspaceEnvelope();
		mockSendMessage.mockRejectedValueOnce(new Error('Forbidden: bot was blocked by the user'));

		await processorStore.fn?.(fakeJob);

		// Brief should still be broadcast even though push failed
		expect(mockBroadcastUpdate).toHaveBeenCalled();
	});

	it('formats brief with HTML bold headers', async () => {
		mockWorkspaceEnvelope();

		await processorStore.fn?.(fakeJob);

		const sentHtml = (mockSendMessage.mock.calls as unknown[][])[0][1] as string;
		expect(sentHtml).toContain('<b>URGENT</b>');
	});

	it('truncates brief text to 4096 chars for Telegram', async () => {
		mockWorkspaceEnvelope();

		const longText = 'A'.repeat(5000);
		vi.mocked(inferWithCache).mockResolvedValue({
			content: [{ type: 'text', text: longText }],
		} as Awaited<ReturnType<typeof inferWithCache>>);

		await processorStore.fn?.(fakeJob);

		const sentHtml = (mockSendMessage.mock.calls as unknown[][])[0][1] as string;
		expect(sentHtml.length).toBeLessThanOrEqual(4096);
	});
});
