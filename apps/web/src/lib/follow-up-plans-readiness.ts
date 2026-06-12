import {
	getLatestTelegramImportProgressWithHistory,
	getUserTelegramAccountIds,
	hasCurrentTelegramConsent,
	TELEGRAM_IMPORT_ACTIVE_STATUSES,
} from '@repo/db';
import { getChatLlmRuntime, TELEGRAM_CONSENT_VERSION } from '@repo/shared';
import type { FollowUpPlanReadiness } from './follow-up-plans-readiness-types';
import { isRuntimeEnvEnabled } from './runtime-env';

function formatDate(value: Date | string | null | undefined) {
	if (!value) return null;
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return date.toLocaleDateString();
}

function localAiReadiness(): FollowUpPlanReadiness['localAi'] {
	try {
		const runtime = getChatLlmRuntime(process.env);
		if (runtime.mode === 'local' && runtime.model) {
			return {
				status: 'ready',
				label: 'Local AI',
				value: runtime.model,
				detail: `${runtime.label} is configured for follow-up draft generation.`,
			};
		}

		return {
			status: 'blocked',
			label: 'Local AI',
			value: 'Not configured',
			detail:
				'Use template-only or reminder-only mode until CHAT_LLM_PROVIDER=local is configured.',
		};
	} catch (err) {
		return {
			status: 'blocked',
			label: 'Local AI',
			value: 'Config error',
			detail: err instanceof Error ? err.message : 'Local AI runtime could not be read.',
		};
	}
}

export async function getFollowUpPlanReadiness(input: {
	userId: string;
	workspaceId: string;
}): Promise<FollowUpPlanReadiness> {
	const [accountIds, hasConsent, importProgress] = await Promise.all([
		getUserTelegramAccountIds(input.userId),
		hasCurrentTelegramConsent(input.userId, input.workspaceId, TELEGRAM_CONSENT_VERSION),
		getLatestTelegramImportProgressWithHistory(input.workspaceId, input.userId),
	]);

	const latestImport = importProgress.latest;
	const lastDataImport = importProgress.lastDataImport;
	const activeImport = latestImport
		? (TELEGRAM_IMPORT_ACTIVE_STATUSES as readonly string[]).includes(latestImport.status)
		: false;
	const lastImportDate = formatDate(
		lastDataImport?.completedAt ?? lastDataImport?.updatedAt ?? null,
	);
	const telegramEnabled = isRuntimeEnvEnabled('TELEGRAM_MTPROTO_ENABLED');

	const telegram: FollowUpPlanReadiness['telegram'] =
		accountIds.length === 0
			? {
					status: 'blocked',
					label: 'Telegram',
					value: 'Not linked',
					detail: 'Link Telegram before opening destinations or importing fresh context.',
				}
			: !telegramEnabled
				? {
						status: 'warning',
						label: 'Telegram',
						value: 'Import off',
						detail: 'Telegram is linked, but local MTProto import is disabled for this runtime.',
					}
				: !hasConsent
					? {
							status: 'warning',
							label: 'Telegram',
							value: 'Consent needed',
							detail: 'History import consent is required before refreshing local context.',
						}
					: activeImport && latestImport
						? {
								status: 'ready',
								label: 'Telegram',
								value: 'Import active',
								detail: `History import is ${latestImport.status}; follow-ups remain manual while it runs.`,
							}
						: lastDataImport
							? {
									status: 'ready',
									label: 'Telegram',
									value: 'Context ready',
									detail: lastImportDate
										? `Latest local import activity was ${lastImportDate}.`
										: 'Local Telegram context has been imported.',
								}
							: {
									status: 'warning',
									label: 'Telegram',
									value: 'No import yet',
									detail:
										'Manual plans still work; imported history improves draft context and reply pauses.',
								};

	return {
		localAi: localAiReadiness(),
		telegram,
		notifications: {
			status: 'unknown',
			label: 'Notifications',
			value: 'Optional',
			detail: 'Browser reminders are optional; manual review remains available without them.',
		},
	};
}
