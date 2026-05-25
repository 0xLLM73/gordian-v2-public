'use server';

import { isRuntimeEnvEnabled } from '@/lib/runtime-env';
import { getInternalSecret, workspaceAction } from '@/lib/safe-action';
import { isStoredSessionUnwrapOutsideImportsAllowed } from '@/lib/telegram-session-policy';
import { track } from '@/lib/track';
import {
	type getLatestTelegramImportProgress,
	getLatestTelegramImportProgressWithHistory,
	getUserTelegramAccountIds,
	hasCurrentTelegramConsent,
} from '@repo/db';
import {
	DEFAULT_TELEGRAM_SYNC_SCOPE,
	TELEGRAM_CONSENT_VERSION,
	TELEGRAM_SYNC_SCOPES,
	isAiAnalysisAvailable,
} from '@repo/shared';
import { z } from 'zod';

const WORKER_SYNC_TIMEOUT_MS = 8000;

interface WorkerImportResponse {
	importRunId?: string;
	status?: string;
	error?: string;
}

function telegramAccountOptions(accountIds: string[]) {
	return accountIds.map((_, index) => ({
		key: String(index),
		label: `Telegram account ${index + 1}`,
	}));
}

function resolveTelegramAccountId(
	accountIds: string[],
	accountKey: string | undefined,
	operation: 'sync' | 'large import',
): string {
	if (accountIds.length === 0) throw new Error('No linked Telegram account');
	if (accountIds.length === 1) return accountIds[0];

	const message = `Select one Telegram account before starting a ${operation}`;
	if (!accountKey) throw new Error(message);
	const index = Number.parseInt(accountKey, 10);
	if (!Number.isInteger(index) || index < 0 || index >= accountIds.length) {
		throw new Error(message);
	}
	return accountIds[index];
}

function toIso(value: Date | null): string | null {
	return value ? value.toISOString() : null;
}

function serializeImportProgress(
	progress: Awaited<ReturnType<typeof getLatestTelegramImportProgress>>,
) {
	if (!progress) return null;
	return {
		...progress,
		requestedAt: toIso(progress.requestedAt),
		startedAt: toIso(progress.startedAt),
		completedAt: toIso(progress.completedAt),
		pausedAt: toIso(progress.pausedAt),
		cancelledAt: toIso(progress.cancelledAt),
		failedAt: toIso(progress.failedAt),
		lastHeartbeatAt: toIso(progress.lastHeartbeatAt),
		createdAt: toIso(progress.createdAt),
		updatedAt: toIso(progress.updatedAt),
	};
}

async function callTelegramImportWorker(
	path: string,
	body: Record<string, unknown>,
	failureMessage: string,
): Promise<WorkerImportResponse> {
	const workerUrl = process.env.WORKER_URL;
	if (!workerUrl) throw new Error('WORKER_URL is not configured');

	const response = await fetch(`${workerUrl}${path}`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Internal-Secret': getInternalSecret(),
		},
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		throw new Error(failureMessage);
	}

	return (await response.json()) as WorkerImportResponse;
}

export const triggerSyncAction = workspaceAction
	.schema(
		z.object({
			syncScope: z.enum(TELEGRAM_SYNC_SCOPES).default(DEFAULT_TELEGRAM_SYNC_SCOPE),
			enableAiProcessing: z.boolean().default(false),
			telegramAccountKey: z.string().regex(/^\d+$/).optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		if (!isRuntimeEnvEnabled('TELEGRAM_MTPROTO_ENABLED')) {
			throw new Error('Telegram sync is disabled on this deployment');
		}
		if (!isStoredSessionUnwrapOutsideImportsAllowed()) {
			throw new Error('Telegram contact sync is disabled; use Telegram history import');
		}

		const accountIds = await getUserTelegramAccountIds(ctx.session.user.id);
		const sourceAccountId = resolveTelegramAccountId(
			accountIds,
			parsedInput.telegramAccountKey,
			'sync',
		);

		const workerUrl = process.env.WORKER_URL;
		if (!workerUrl) throw new Error('WORKER_URL is not configured');

		const enableAiProcessing =
			parsedInput.syncScope !== 'contacts_only' &&
			parsedInput.enableAiProcessing &&
			isAiAnalysisAvailable(process.env);

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), WORKER_SYNC_TIMEOUT_MS);
		let response: Response;
		try {
			response = await fetch(`${workerUrl}/telegram/sync-contacts`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Internal-Secret': getInternalSecret(),
				},
				body: JSON.stringify({
					userId: ctx.session.user.id,
					workspaceId: ctx.workspaceId,
					syncScope: parsedInput.syncScope,
					enableAiProcessing,
					sourceAccountId,
				}),
				signal: controller.signal,
			});
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') {
				return { queued: false, error: 'Timed out waiting for the local worker to queue sync' };
			}
			return { queued: false, error: 'Could not reach the local worker' };
		} finally {
			clearTimeout(timeout);
		}

		if (!response.ok) return { queued: false, error: 'Failed to trigger sync' };

		track(ctx.workspaceId, ctx.session.user.id, 'onboarding.sync_started', {
			sync_scope: parsedInput.syncScope,
			ai_processing_enabled: enableAiProcessing,
		});

		return { queued: true, error: null };
	});

export const getTelegramImportStatusAction = workspaceAction
	.schema(z.object({}))
	.action(async ({ ctx }) => {
		const accountIds = await getUserTelegramAccountIds(ctx.session.user.id);
		const progress = await getLatestTelegramImportProgressWithHistory(
			ctx.workspaceId,
			ctx.session.user.id,
		);
		return {
			import: serializeImportProgress(progress.latest),
			lastDataImport: serializeImportProgress(progress.lastDataImport),
			telegramAccounts: telegramAccountOptions(accountIds),
		};
	});

const startTelegramImportSchema = z.object({
	confirmLargeImport: z.literal(true),
	telegramAccountKey: z.string().regex(/^\d+$/).optional(),
});

export const startTelegramImportAction = workspaceAction
	.schema(startTelegramImportSchema)
	.action(async ({ parsedInput, ctx }) => {
		if (!isRuntimeEnvEnabled('TELEGRAM_MTPROTO_ENABLED')) {
			throw new Error('Telegram import is disabled on this deployment');
		}

		const accountIds = await getUserTelegramAccountIds(ctx.session.user.id);
		const sourceAccountId = resolveTelegramAccountId(
			accountIds,
			parsedInput.telegramAccountKey,
			'large import',
		);

		const hasConsent = await hasCurrentTelegramConsent(
			ctx.session.user.id,
			ctx.workspaceId,
			TELEGRAM_CONSENT_VERSION,
		);
		if (!hasConsent) throw new Error('Telegram import consent is required');

		const result = await callTelegramImportWorker(
			'/telegram/history-import/start',
			{
				userId: ctx.session.user.id,
				workspaceId: ctx.workspaceId,
				sourceAccountId,
				largeImportConfirmed: true,
			},
			'Failed to start Telegram import',
		);

		track(ctx.workspaceId, ctx.session.user.id, 'telegram.history_import_started', {
			scope: 'all_private_and_groups',
		});

		return { importRunId: result.importRunId, status: result.status };
	});

const importRunSchema = z.object({ runId: z.string().uuid() });

export const pauseTelegramImportAction = workspaceAction
	.schema(importRunSchema)
	.action(async ({ parsedInput, ctx }) => {
		const result = await callTelegramImportWorker(
			`/telegram/history-import/${parsedInput.runId}/pause`,
			{ userId: ctx.session.user.id, workspaceId: ctx.workspaceId },
			'Failed to pause Telegram import',
		);
		return { importRunId: result.importRunId, status: result.status };
	});

export const resumeTelegramImportAction = workspaceAction
	.schema(importRunSchema)
	.action(async ({ parsedInput, ctx }) => {
		const result = await callTelegramImportWorker(
			`/telegram/history-import/${parsedInput.runId}/resume`,
			{ userId: ctx.session.user.id, workspaceId: ctx.workspaceId },
			'Failed to resume Telegram import',
		);
		return { importRunId: result.importRunId, status: result.status };
	});

export const cancelTelegramImportAction = workspaceAction
	.schema(importRunSchema)
	.action(async ({ parsedInput, ctx }) => {
		const result = await callTelegramImportWorker(
			`/telegram/history-import/${parsedInput.runId}/cancel`,
			{ userId: ctx.session.user.id, workspaceId: ctx.workspaceId },
			'Failed to cancel Telegram import',
		);
		return { importRunId: result.importRunId, status: result.status };
	});
