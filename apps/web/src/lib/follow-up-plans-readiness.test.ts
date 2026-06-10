import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetUserTelegramAccountIds = vi.hoisted(() => vi.fn());
const mockHasCurrentTelegramConsent = vi.hoisted(() => vi.fn());
const mockGetLatestTelegramImportProgressWithHistory = vi.hoisted(() => vi.fn());

vi.mock('@repo/db', () => ({
	TELEGRAM_IMPORT_ACTIVE_STATUSES: ['queued', 'discovering', 'importing', 'pausing', 'paused'],
	getUserTelegramAccountIds: mockGetUserTelegramAccountIds,
	hasCurrentTelegramConsent: mockHasCurrentTelegramConsent,
	getLatestTelegramImportProgressWithHistory: mockGetLatestTelegramImportProgressWithHistory,
}));

describe('getFollowUpPlanReadiness', () => {
	beforeEach(() => {
		vi.unstubAllEnvs();
		vi.clearAllMocks();
		mockGetUserTelegramAccountIds.mockResolvedValue(['telegram-account-1']);
		mockHasCurrentTelegramConsent.mockResolvedValue(true);
		mockGetLatestTelegramImportProgressWithHistory.mockResolvedValue({
			latest: null,
			lastDataImport: null,
		});
	});

	it('reports local draft AI and Telegram import readiness', async () => {
		vi.stubEnv('CHAT_LLM_PROVIDER', 'local');
		vi.stubEnv('CHAT_LLM_BASE_URL', 'http://localhost:11434/v1');
		vi.stubEnv('CHAT_LLM_MODEL', 'qwen3.5:9b');
		vi.stubEnv('TELEGRAM_MTPROTO_ENABLED', 'true');
		mockGetLatestTelegramImportProgressWithHistory.mockResolvedValue({
			latest: null,
			lastDataImport: {
				completedAt: new Date('2026-06-09T12:00:00Z'),
				updatedAt: new Date('2026-06-09T12:01:00Z'),
			},
		});

		const { getFollowUpPlanReadiness } = await import('./follow-up-plans-readiness');
		const result = await getFollowUpPlanReadiness({ userId: 'user-1', workspaceId: 'ws-1' });

		expect(result.localAi).toEqual(
			expect.objectContaining({
				status: 'ready',
				value: 'qwen3.5:9b',
			}),
		);
		expect(result.telegram).toEqual(
			expect.objectContaining({
				status: 'ready',
				value: 'Context ready',
			}),
		);
		expect(result.notifications).toEqual(
			expect.objectContaining({
				status: 'unknown',
				value: 'Optional',
			}),
		);
	});

	it('reports blocked local AI and missing Telegram account without requiring hosted services', async () => {
		mockGetUserTelegramAccountIds.mockResolvedValue([]);

		const { getFollowUpPlanReadiness } = await import('./follow-up-plans-readiness');
		const result = await getFollowUpPlanReadiness({ userId: 'user-1', workspaceId: 'ws-1' });

		expect(result.localAi).toEqual(
			expect.objectContaining({
				status: 'blocked',
				value: 'Not configured',
			}),
		);
		expect(result.telegram).toEqual(
			expect.objectContaining({
				status: 'blocked',
				value: 'Not linked',
			}),
		);
	});
});
