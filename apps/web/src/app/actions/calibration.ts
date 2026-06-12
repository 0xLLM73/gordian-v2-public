'use server';

import {
	getCalibration,
	getDashboardStats,
	getMostActiveContacts,
	getMostNeglectedContacts,
	getPreferences,
	getUserTelegramAccountIds,
	saveConsent as saveConsentDAL,
	saveWhatMatters as saveWhatMattersDAL,
	upsertCalibration,
} from '@repo/db';
import {
	calibrationInputSchema,
	isAiAnalysisAvailable,
	redactSensitive,
	TELEGRAM_CONSENT_VERSION,
} from '@repo/shared';
import { z } from 'zod';
import { getInternalSecret, workspaceAction } from '@/lib/safe-action';

const AI_CONSENT_CATCHUP_TIMEOUT_MS = 8000;

async function queueTelegramAiConsentCatchup(input: {
	userId: string;
	workspaceId: string;
}): Promise<void> {
	const workerUrl = process.env.WORKER_URL;
	if (!workerUrl) return;

	const accountIds = await getUserTelegramAccountIds(input.userId);
	if (accountIds.length === 0) return;

	await Promise.allSettled(
		accountIds.map(async (sourceAccountId) => {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), AI_CONSENT_CATCHUP_TIMEOUT_MS);
			try {
				const response = await fetch(`${workerUrl}/telegram/ai-consent-catchup`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'X-Internal-Secret': getInternalSecret(),
					},
					body: JSON.stringify({
						userId: input.userId,
						workspaceId: input.workspaceId,
						sourceAccountId,
					}),
					signal: controller.signal,
				});
				if (!response.ok) {
					throw new Error(`AI consent catch-up failed with status ${response.status}`);
				}
			} finally {
				clearTimeout(timeout);
			}
		}),
	).then((results) => {
		const failed = results.filter((result) => result.status === 'rejected');
		if (failed.length > 0) {
			console.warn(
				'[calibration] AI consent was saved, but Telegram AI catch-up could not be queued:',
				redactSensitive(failed.map((result) => result.reason)),
			);
		}
	});
}

export const getCalibrationAction = workspaceAction.schema(z.object({})).action(async ({ ctx }) => {
	const calibration = await getCalibration(ctx.session.user.id, ctx.workspaceId, ctx.envelope);
	return { calibration };
});

export const saveCalibrationAction = workspaceAction
	.schema(calibrationInputSchema)
	.action(async ({ parsedInput, ctx }) => {
		const calibration = await upsertCalibration(
			ctx.session.user.id,
			ctx.workspaceId,
			parsedInput,
			ctx.envelope,
		);
		return { calibration };
	});

export const getCalibrationStatusAction = workspaceAction
	.schema(z.object({}))
	.action(async ({ ctx }) => {
		const calibration = await getCalibration(ctx.session.user.id, ctx.workspaceId, ctx.envelope);
		return {
			exists: calibration !== null,
			completed: calibration?.completedAt != null,
			version: calibration?.calibrationVersion ?? 0,
		};
	});

// ─── What Matters (Coffee Test + Priority Contacts) ─────────────────────────

export const saveWhatMattersAction = workspaceAction
	.schema(
		z.object({
			commitmentSensitivity: z.enum(['everything', 'specific', 'tasks_only']),
			priorityContactIds: z.array(z.string().uuid()).max(20),
			userRole: z
				.enum(['vc_investor', 'founder', 'bd', 'community', 'developer', 'other'])
				.optional(),
			primaryGoal: z.enum(['commitments', 'reconnect', 'network', 'deal_flow']).optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		await saveWhatMattersDAL(ctx.session.user.id, ctx.workspaceId, parsedInput);
		return { saved: true };
	});

export const getPriorityContactSuggestionsAction = workspaceAction
	.schema(z.object({}))
	.action(async ({ ctx }) => {
		const [mostActive, mostNeglected] = await Promise.all([
			getMostActiveContacts(ctx.workspaceId, ctx.envelope, 5),
			getMostNeglectedContacts(ctx.workspaceId, ctx.envelope, 3),
		]);
		return { mostActive, mostNeglected };
	});

// ─── Onboarding Summary (for first-look summary card) ───────────────────────

export const getOnboardingSummaryAction = workspaceAction
	.schema(z.object({}))
	.action(async ({ ctx }) => {
		const [calibration, stats, prefs] = await Promise.all([
			getCalibration(ctx.session.user.id, ctx.workspaceId, ctx.envelope),
			getDashboardStats(ctx.workspaceId),
			getPreferences(ctx.workspaceId, ctx.session.user.id),
		]);

		return {
			userRole: calibration?.userRole ?? null,
			primaryGoal: calibration?.primaryGoal ?? null,
			priorityContactCount: calibration?.priorityContactIds?.length ?? 0,
			contactCount: stats.contactCount,
			commitmentCount: stats.activeCommitmentCount,
			briefTime: prefs.briefTime,
		};
	});

// ─── Consent Persistence ────────────────────────────────────────────────────

export const saveConsentAction = workspaceAction
	.schema(
		z.object({
			consentDataProcessing: z.boolean(),
			consentAiAnalysis: z.boolean(),
			consentTelegramAccess: z.boolean(),
			consentVersion: z
				.number()
				.int()
				.min(TELEGRAM_CONSENT_VERSION)
				.default(TELEGRAM_CONSENT_VERSION),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const previousCalibration = await getCalibration(
			ctx.session.user.id,
			ctx.workspaceId,
			ctx.envelope,
		);
		const resolvedAiConsent = parsedInput.consentAiAnalysis && isAiAnalysisAvailable(process.env);

		await saveConsentDAL(ctx.session.user.id, ctx.workspaceId, {
			...parsedInput,
			consentAiAnalysis: resolvedAiConsent,
		});
		if (resolvedAiConsent && previousCalibration?.consentAiAnalysis !== true) {
			await queueTelegramAiConsentCatchup({
				userId: ctx.session.user.id,
				workspaceId: ctx.workspaceId,
			});
		}
		return { saved: true };
	});
