import type { SealedEnvelope } from '@repo/crypto';
import {
	FOLLOW_UP_PLAN_READY_STEP_BATCH_SIZE,
	claimReadyFollowUpPlanStep,
	db,
	eq,
	getFollowUpPlan,
	getFollowUpPlanSteps,
	getReadySteps,
	markStepPendingReview,
	recordFollowUpPlanStepProcessingFailure,
	recordFollowUpPlanWorkerHeartbeat,
	workspaces,
} from '@repo/db';

const FOLLOW_UP_PLAN_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour
type FollowUpPlanAiMode = 'local_ai' | 'template_only' | 'reminder_only';

function getFollowUpPlanAiMode(config: unknown): FollowUpPlanAiMode {
	if (!config || typeof config !== 'object') return 'local_ai';
	const value = (config as Record<string, unknown>).aiMode;
	if (value === 'template_only' || value === 'reminder_only') return value;
	return 'local_ai';
}

function buildNonAiReviewText(input: {
	aiMode: Exclude<FollowUpPlanAiMode, 'local_ai'>;
	planTitle: string;
	stepNumber: number;
	totalSteps: number;
	stepPrompt: string;
}) {
	const header =
		input.aiMode === 'template_only' ? 'Template-only follow-up draft' : 'Reminder-only follow-up';
	const instruction =
		input.aiMode === 'template_only'
			? 'Review this template text, edit it into your voice, send it manually, then mark it sent.'
			: 'Use this as a reminder to write and send the follow-up manually, then mark it sent.';
	return [
		header,
		`Plan: ${input.planTitle || 'Follow-up plan'}`,
		`Step ${input.stepNumber}/${input.totalSteps}`,
		'',
		input.stepPrompt,
		'',
		instruction,
	].join('\n');
}

function replaceKnownContactAliases(text: string, aliases: string[], replacement: string): string {
	return aliases.reduce((current, alias) => {
		const escaped = alias.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		if (!escaped) return current;
		return current.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), replacement);
	}, text);
}

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

async function recordWorkerHeartbeat(
	input: Parameters<typeof recordFollowUpPlanWorkerHeartbeat>[0],
): Promise<void> {
	try {
		await recordFollowUpPlanWorkerHeartbeat(input);
	} catch (err) {
		console.warn('[follow-up-plan] Failed to record worker heartbeat:', (err as Error).message);
	}
}

async function recordStepProcessingFailure(
	workspaceId: string,
	stepId: string,
	errorSummary: string,
): Promise<void> {
	try {
		await recordFollowUpPlanStepProcessingFailure(workspaceId, stepId, { errorSummary });
	} catch (err) {
		console.warn(
			`[follow-up-plan] Failed to record processing error for step=${stepId.slice(0, 8)}:`,
			(err as Error).message,
		);
	}
}

/**
 * Follow-up plan step processor — runs on setInterval (DragonflyDB-safe, no BullMQ repeat).
 * Checks for ready steps and generates drafts via the bandit system.
 */
export async function processFollowUpPlanSteps(): Promise<void> {
	let processedSteps = 0;
	let failedSteps = 0;
	const batchSize = FOLLOW_UP_PLAN_READY_STEP_BATCH_SIZE;

	try {
		await recordWorkerHeartbeat({
			status: 'running',
			processedSteps,
			failedSteps,
			metadata: { batchSize },
		});
		const readySteps = await getReadySteps({ limit: batchSize });

		if (readySteps.length === 0) {
			await recordWorkerHeartbeat({
				status: 'idle',
				processedSteps,
				failedSteps,
				metadata: { readySteps: 0, batchSize, batchFull: false },
			});
			return;
		}

		const batchFull = readySteps.length >= batchSize;
		console.log(
			`[follow-up-plan] Processing ${readySteps.length} ready steps${batchFull ? ` (batch limit ${batchSize})` : ''}`,
		);

		const { generateDraftWithBandit } = await import('../ai/draft-generation');
		const { buildVoiceModifier } = await import('../ai/voice-modifier');
		const { deriveKeys, generatePersonPseudonym, maskEntities, prefilterEntities, unwrapWrk } =
			await import('@repo/crypto');
		const { getContact, getLatestSummary, getVoiceProfile, getContactStyleOverride } = await import(
			'@repo/db'
		);

		for (const { step, cadence } of readySteps) {
			try {
				const claim = await claimReadyFollowUpPlanStep(cadence.workspaceId, step.id);
				if (!claim) continue;

				// Resolve envelope for this workspace
				const workspaceData = await getWorkspaceEnvelope(cadence.workspaceId);
				if (!workspaceData) {
					failedSteps += 1;
					await recordStepProcessingFailure(
						cadence.workspaceId,
						step.id,
						'Workspace encryption envelope unavailable.',
					);
					console.warn(
						`[follow-up-plan] No envelope for workspace=${cadence.workspaceId.slice(0, 8)}, skipping`,
					);
					continue;
				}
				const { envelope, ownerId } = workspaceData;
				const wrk = await unwrapWrk(envelope);
				const keys = await deriveKeys(wrk, cadence.workspaceId, envelope.wrkVersion);
				const contactPseudonym = generatePersonPseudonym(cadence.contactId, keys.bik);

				// Re-query encrypted plan/step data using per-workspace envelope
				const [decryptedPlan, decryptedSteps, contact] = await Promise.all([
					getFollowUpPlan(cadence.workspaceId, cadence.id, envelope),
					getFollowUpPlanSteps(cadence.workspaceId, cadence.id, envelope),
					getContact(cadence.workspaceId, cadence.contactId, envelope),
				]);
				const decryptedStep = decryptedSteps.find((s) => s.id === step.id);
				const planTitle = decryptedPlan?.title ?? '';
				const stepPrompt = decryptedStep?.prompt ?? '';
				const aiMode = getFollowUpPlanAiMode(cadence.config);
				const contactName = contact
					? [contact.firstName, contact.lastName].filter(Boolean).join(' ')
					: '';
				const contactAliases = [
					contactName,
					contact?.firstName,
					contact?.lastName,
					(contact as Record<string, unknown> | null | undefined)?.username,
				].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
				const maskDraftContext = (value: string) =>
					replaceKnownContactAliases(
						maskEntities(value, keys.bik, prefilterEntities(value)).maskedText,
						contactAliases,
						contactPseudonym,
					);

				if (aiMode === 'template_only' || aiMode === 'reminder_only') {
					const reviewText = buildNonAiReviewText({
						aiMode,
						planTitle,
						stepNumber: step.stepNumber,
						totalSteps: cadence.totalSteps,
						stepPrompt,
					});
					const queuedStep = await markStepPendingReview(
						cadence.workspaceId,
						step.id,
						reviewText,
						undefined,
						envelope,
						{
							source: aiMode,
							activitySummary:
								aiMode === 'template_only'
									? 'Template-only follow-up queued for review.'
									: 'Reminder-only follow-up queued for review.',
							metadata: { trigger: 'worker_generation', aiMode },
						},
					);
					if (!queuedStep) {
						failedSteps += 1;
						await recordStepProcessingFailure(
							cadence.workspaceId,
							step.id,
							'Step was no longer ready after draft generation.',
						);
						continue;
					}
					processedSteps += 1;

					console.log(
						`[follow-up-plan] Step ${step.stepNumber}/${cadence.totalSteps} queued for ${aiMode} review for plan=${cadence.id.slice(0, 8)}`,
					);
					continue;
				}

				// Get contact summary for context
				const summary = await getLatestSummary(cadence.workspaceId, cadence.contactId, envelope);
				const contactSummary = summary?.summary
					? `Contact: ${contactPseudonym}\n${maskDraftContext(summary.summary)}`
					: `Contact: ${contactPseudonym}\nNo summary available`;

				// Build context from step prompt + plan config
				const context = maskDraftContext(
					`Follow-up Plan: ${planTitle}\nStep ${step.stepNumber}/${cadence.totalSteps}\nInstructions: ${stepPrompt}`,
				);

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

				// Queue the generated draft for human review. Approval/rejection advances the plan.
				const queuedStep = await markStepPendingReview(
					cadence.workspaceId,
					step.id,
					draft.text,
					draft.armType,
					envelope,
				);
				if (!queuedStep) {
					failedSteps += 1;
					await recordStepProcessingFailure(
						cadence.workspaceId,
						step.id,
						'Step was no longer ready after draft generation.',
					);
					continue;
				}
				processedSteps += 1;

				console.log(
					`[follow-up-plan] Step ${step.stepNumber}/${cadence.totalSteps} queued for review for plan=${cadence.id.slice(0, 8)} arm=${draft.armType}`,
				);
			} catch (err) {
				failedSteps += 1;
				await recordStepProcessingFailure(cadence.workspaceId, step.id, (err as Error).message);
				console.error(
					`[follow-up-plan] Failed to process step ${step.id.slice(0, 8)}:`,
					(err as Error).message,
				);
			}
		}
		await recordWorkerHeartbeat({
			status: 'idle',
			processedSteps,
			failedSteps,
			metadata: { readySteps: readySteps.length, batchSize, batchFull },
		});
	} catch (err) {
		await recordWorkerHeartbeat({
			status: 'error',
			processedSteps,
			failedSteps,
			errorSummary: (err as Error).message,
			metadata: { batchSize },
		});
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
