import type { SealedEnvelope } from '@repo/crypto';
import {
	advanceStep,
	db,
	eq,
	getFollowUpPlan,
	getFollowUpPlanSteps,
	getReadySteps,
	workspaces,
} from '@repo/db';

const FOLLOW_UP_PLAN_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour

/**
 * Fetch the workspace encryption envelope and owner ID from the database.
 */
async function getWorkspaceEnvelope(
	workspaceId: string,
): Promise<{ envelope: SealedEnvelope; ownerId: string } | null> {
	const result = await db
		.select({
			encryptedWrk: workspaces.encryptedWrk,
			kmsContext: workspaces.kmsContext,
			wrkVersion: workspaces.wrkVersion,
			ownerId: workspaces.ownerId,
		})
		.from(workspaces)
		.where(eq(workspaces.id, workspaceId))
		.limit(1);

	if (result.length === 0) return null;

	const ws = result[0];
	return {
		envelope: {
			encryptedWrk: Buffer.from(ws.encryptedWrk, 'base64'),
			kmsContext: ws.kmsContext as Record<string, string>,
			wrkVersion: ws.wrkVersion,
		},
		ownerId: ws.ownerId,
	};
}

/**
 * Follow-up plan step processor — runs on setInterval (DragonflyDB-safe, no BullMQ repeat).
 * Checks for ready steps and generates drafts via the bandit system.
 */
export async function processFollowUpPlanSteps(): Promise<void> {
	try {
		const readySteps = await getReadySteps();

		if (readySteps.length === 0) return;

		console.log(`[follow-up-plan] Processing ${readySteps.length} ready steps`);

		const { generateDraftWithBandit } = await import('../ai/draft-generation');
		const { buildVoiceModifier } = await import('../ai/voice-modifier');
		const { getLatestSummary, getVoiceProfile, getContactStyleOverride } = await import('@repo/db');

		for (const { step, cadence } of readySteps) {
			try {
				// Resolve envelope for this workspace
				const workspaceData = await getWorkspaceEnvelope(cadence.workspaceId);
				if (!workspaceData) {
					console.warn(
						`[follow-up-plan] No envelope for workspace=${cadence.workspaceId.slice(0, 8)}, skipping`,
					);
					continue;
				}
				const { envelope, ownerId } = workspaceData;

				// Re-query encrypted plan/step data using per-workspace envelope
				const [decryptedPlan, decryptedSteps] = await Promise.all([
					getFollowUpPlan(cadence.workspaceId, cadence.id, envelope),
					getFollowUpPlanSteps(cadence.workspaceId, cadence.id, envelope),
				]);
				const decryptedStep = decryptedSteps.find((s) => s.id === step.id);
				const planTitle = decryptedPlan?.title ?? '';
				const stepPrompt = decryptedStep?.prompt ?? '';

				// Get contact summary for context
				const summary = await getLatestSummary(cadence.workspaceId, cadence.contactId, envelope);
				const contactSummary = summary?.summary ?? 'No summary available';

				// Build context from step prompt + plan config
				const context = `Follow-up Plan: ${planTitle}\nStep ${step.stepNumber}/${cadence.totalSteps}\nInstructions: ${stepPrompt}`;

				// Build voice modifier for personalized draft tone
				let voiceModifier: string | undefined;
				try {
					const [profile, contactOverride] = await Promise.all([
						getVoiceProfile(ownerId, cadence.workspaceId),
						getContactStyleOverride(cadence.workspaceId, cadence.contactId),
					]);
					const result = buildVoiceModifier(profile, contactOverride);
					if (result.modifier) voiceModifier = result.modifier;
				} catch {
					// Non-fatal — draft without voice modifier
				}

				// Generate draft using the bandit system — pass ownerId as userId for correct reward attribution
				const draft = await generateDraftWithBandit(
					contactSummary,
					context,
					ownerId,
					voiceModifier,
				);

				// Advance the step with the generated draft
				await advanceStep(cadence.workspaceId, step.id, draft.text, draft.armType, envelope);

				console.log(
					`[follow-up-plan] Step ${step.stepNumber}/${cadence.totalSteps} processed for plan=${cadence.id.slice(0, 8)} arm=${draft.armType}`,
				);
			} catch (err) {
				console.error(
					`[follow-up-plan] Failed to process step ${step.id.slice(0, 8)}:`,
					(err as Error).message,
				);
			}
		}
	} catch (err) {
		console.error('[follow-up-plan] Step processing failed:', (err as Error).message);
	}
}

let followUpPlanInterval: ReturnType<typeof setInterval> | null = null;

/** Schedule periodic follow-up plan step processing — DragonflyDB-safe (no BullMQ repeat) */
export function scheduleFollowUpPlanProcessor(): void {
	// Initial check after 60 seconds
	setTimeout(() => {
		processFollowUpPlanSteps().catch((err) =>
			console.error('[follow-up-plan] Initial processing failed:', err.message),
		);
	}, 60_000);

	// Then every hour
	followUpPlanInterval = setInterval(() => {
		processFollowUpPlanSteps().catch((err) =>
			console.error('[follow-up-plan] Periodic processing failed:', err.message),
		);
	}, FOLLOW_UP_PLAN_CHECK_INTERVAL);

	console.log('[follow-up-plan] Scheduled step processor every 1 hour');
}

/** Stop the follow-up plan processor interval for graceful shutdown */
export function stopFollowUpPlanProcessor(): void {
	if (followUpPlanInterval) {
		clearInterval(followUpPlanInterval);
		followUpPlanInterval = null;
	}
}
