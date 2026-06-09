'use server';

import { getOptionalWorkerInternalSecret } from '@/lib/runtime-env';
import { getInternalSecret, workspaceAction } from '@/lib/safe-action';
import { track } from '@/lib/track';
import {
	createCorrectionDiff,
	createGoldenExample,
	getActiveCommitments as dalGetActive,
	getCommitmentsByContact as dalGetByContact,
	getCommitmentsForFirstLook as dalGetFirstLook,
	snoozeCommitment as dalSnooze,
	updateCommitmentStatus as dalUpdateStatus,
	finalizeBanditReward,
	getCommitmentForFeedback,
	markCommitmentFulfilled,
} from '@repo/db';
import { canRunCloudRationaleExtraction, commitmentStatusSchema } from '@repo/shared';
import { z } from 'zod';

const commitmentPeriodUnitSchema = z.enum(['days', 'weeks', 'months']);

type CommitmentReprocessWorkerResponse =
	| {
			status: 'dry_run';
			workspaceId?: string;
			contactLimit: number;
			batchSize: number;
			wouldProcessContacts: number;
			wouldProcessMessages: number;
			maxAgeDays?: number;
			confirmToken: string;
	  }
	| {
			status: 'queued';
			contactsProcessed: number;
			messagesQueued: number;
			maxAgeDays?: number;
	  };

type CommitmentPreviewRow = {
	id: string;
	contactId?: string | null;
	title?: string | null;
	commitmentType?: string | null;
	status?: string | null;
	assignee?: string | null;
	confidence?: number | null;
	dueDate?: Date | string | null;
	quote?: string | null;
	fulfilledAt?: Date | string | null;
	snoozedUntil?: Date | string | null;
	createdAt?: Date | string | null;
	contactFirstName?: string | null;
	contactLastName?: string | null;
	sourceMessageAgeDays?: number | null;
};

type CommitmentMutationRow = {
	id: string;
	contactId?: string | null;
	status?: string | null;
	fulfilledAt?: Date | string | null;
	snoozedUntil?: Date | string | null;
	updatedAt?: Date | string | null;
};

function toCommitmentPreviewDto(c: CommitmentPreviewRow) {
	return {
		id: c.id,
		title: c.title ?? null,
		commitmentType: c.commitmentType ?? null,
		status: c.status ?? null,
		assignee: c.assignee ?? null,
		confidence: c.confidence ?? null,
		dueDate: c.dueDate ?? null,
		contactId: c.contactId ?? null,
		fulfilledAt: c.fulfilledAt ?? null,
		snoozedUntil: c.snoozedUntil ?? null,
		createdAt: c.createdAt ?? null,
		quote: c.quote ?? null,
		contactFirstName: c.contactFirstName ?? null,
		contactLastName: c.contactLastName ?? null,
		sourceMessageAgeDays: c.sourceMessageAgeDays ?? null,
	};
}

function toCommitmentMutationDto(c: CommitmentMutationRow | null | undefined) {
	if (!c) return null;
	return {
		id: c.id,
		status: c.status ?? null,
		contactId: c.contactId ?? null,
		fulfilledAt: c.fulfilledAt ?? null,
		snoozedUntil: c.snoozedUntil ?? null,
		updatedAt: c.updatedAt ?? null,
	};
}

function periodToDays(value: number, unit: z.infer<typeof commitmentPeriodUnitSchema>) {
	const multiplier = unit === 'months' ? 30 : unit === 'weeks' ? 7 : 1;
	return Math.min(value * multiplier, 3650);
}

function isCommitmentReprocessWorkerResponse(
	value: unknown,
): value is CommitmentReprocessWorkerResponse {
	if (!value || typeof value !== 'object') return false;
	const record = value as Record<string, unknown>;
	if (record.status === 'dry_run') {
		return (
			typeof record.contactLimit === 'number' &&
			typeof record.batchSize === 'number' &&
			typeof record.wouldProcessContacts === 'number' &&
			typeof record.wouldProcessMessages === 'number' &&
			typeof record.confirmToken === 'string'
		);
	}
	if (record.status === 'queued') {
		return (
			typeof record.contactsProcessed === 'number' && typeof record.messagesQueued === 'number'
		);
	}
	return false;
}

async function callCommitmentReprocessWorker(
	body: Record<string, unknown>,
): Promise<CommitmentReprocessWorkerResponse> {
	const workerUrl = process.env.WORKER_URL;
	if (!workerUrl) throw new Error('WORKER_URL is not configured');

	const response = await fetch(`${workerUrl}/admin/reprocess-messages`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Internal-Secret': getInternalSecret(),
		},
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		throw new Error('Failed to find commitments');
	}

	const payload = (await response.json()) as unknown;
	if (!isCommitmentReprocessWorkerResponse(payload)) {
		throw new Error('Failed to find commitments');
	}
	return payload;
}

export const getActiveCommitmentsAction = workspaceAction
	.schema(
		z.object({
			limit: z.number().int().positive().optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		if (!ctx.envelope) throw new Error('Workspace encryption key not found');
		const raw = await dalGetActive(ctx.workspaceId, ctx.envelope, {
			limit: parsedInput.limit,
		});
		return raw.map(toCommitmentPreviewDto);
	});

export const getFirstLookCommitmentsAction = workspaceAction
	.schema(
		z.object({
			limit: z.number().int().positive().optional(),
			maxAgeDays: z.number().int().positive().optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		if (!ctx.envelope) throw new Error('Workspace encryption key not found');
		const raw = await dalGetFirstLook(ctx.workspaceId, ctx.envelope, {
			limit: parsedInput.limit,
			maxAgeDays: parsedInput.maxAgeDays,
		});
		return raw.map(toCommitmentPreviewDto);
	});

export const findCommitmentsForPeriodAction = workspaceAction
	.schema(
		z.object({
			periodValue: z.number().int().min(1).max(365),
			periodUnit: commitmentPeriodUnitSchema.default('days'),
			batchSize: z.number().int().min(1).max(200).default(200),
			contactLimit: z.number().int().min(1).max(100).default(100),
			confirmToken: z.string().min(1).optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const maxAgeDays = periodToDays(parsedInput.periodValue, parsedInput.periodUnit);
		const isConfirm = Boolean(parsedInput.confirmToken);
		const result = await callCommitmentReprocessWorker({
			workspaceId: ctx.workspaceId,
			userId: ctx.session.user.id,
			batchSize: parsedInput.batchSize,
			contactLimit: parsedInput.contactLimit,
			maxAgeDays,
			dryRun: !isConfirm,
			confirm: isConfirm,
			confirmToken: parsedInput.confirmToken,
		});

		if (result.status === 'dry_run') {
			return {
				status: result.status,
				batchSize: result.batchSize,
				contactLimit: result.contactLimit,
				wouldProcessContacts: result.wouldProcessContacts,
				wouldProcessMessages: result.wouldProcessMessages,
				maxAgeDays: result.maxAgeDays ?? maxAgeDays,
				periodValue: parsedInput.periodValue,
				periodUnit: parsedInput.periodUnit,
				confirmToken: result.confirmToken,
			};
		}

		return {
			status: result.status,
			contactsProcessed: result.contactsProcessed,
			messagesQueued: result.messagesQueued,
			maxAgeDays: result.maxAgeDays ?? maxAgeDays,
			periodValue: parsedInput.periodValue,
			periodUnit: parsedInput.periodUnit,
		};
	});

export const getCommitmentsByContactAction = workspaceAction
	.schema(
		z.object({
			contactId: z.string().uuid(),
			status: commitmentStatusSchema.optional(),
			limit: z.number().int().positive().optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		if (!ctx.envelope) throw new Error('Workspace encryption key not found');
		const raw = await dalGetByContact(ctx.workspaceId, parsedInput.contactId, ctx.envelope, {
			status: parsedInput.status,
			limit: parsedInput.limit,
		});
		return raw.map(toCommitmentPreviewDto);
	});

export const updateCommitmentStatusAction = workspaceAction
	.schema(
		z.object({
			commitmentId: z.string().uuid(),
			status: commitmentStatusSchema,
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const result = await dalUpdateStatus(
			ctx.workspaceId,
			parsedInput.commitmentId,
			parsedInput.status,
		);

		// Close the recursive learning loop: send reward signal to bandit
		if (result?.banditTraceId) {
			const rewardScore =
				parsedInput.status === 'completed'
					? 1.0
					: parsedInput.status === 'dismissed'
						? 0.0
						: parsedInput.status === 'active'
							? 0.75
							: 0.5;
			await finalizeBanditReward(result.banditTraceId, rewardScore);

			// Send feedback to Helicone dashboard (non-blocking, fire-and-forget)
			if (parsedInput.status === 'dismissed' || parsedInput.status === 'completed') {
				const workerUrl = process.env.WORKER_URL ?? 'http://localhost:3001';
				const internalSecret = getOptionalWorkerInternalSecret();
				if (internalSecret) {
					fetch(`${workerUrl}/feedback/helicone`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'X-Internal-Secret': internalSecret,
						},
						body: JSON.stringify({
							heliconeRequestId: result.banditTraceId,
							rating: parsedInput.status === 'completed',
							comment: `User ${parsedInput.status} commitment`,
						}),
					}).catch(() => {}); // Fire-and-forget
				}
			}
		}

		// DPG Phase 2: Extract rationale when commitment dismissed (fire-and-forget)
		if (parsedInput.status === 'dismissed' && ctx.envelope && canRunCloudRationaleExtraction()) {
			const { fireRationaleExtraction } = await import('@/lib/rationale-hook');
			fireRationaleExtraction({
				action: 'commitment_dismissed',
				label: 'Commitment dismissed', // SEC-PROV-009: structural only
				entityId: parsedInput.commitmentId,
				entityType: 'commitment',
				contactId: result?.contactId ?? undefined,
				workspaceId: ctx.workspaceId,
				envelope: ctx.envelope,
			});
		}

		// Context Graph: Record decision event (fire-and-forget)
		if (ctx.envelope) {
			const { fireDecisionRecording } = await import('@/lib/decision-hook');
			fireDecisionRecording({
				userId: ctx.session.user.id,
				workspaceId: ctx.workspaceId,
				decisionType: 'commitment',
				label: 'commitment-created', // SEC-PROV-009: structural only
				entityId: parsedInput.commitmentId,
				envelope: ctx.envelope,
			});
		}

		// Auto-create Silver golden example on dismiss (feeds recursive learning pipeline)
		if (parsedInput.status === 'dismissed' && ctx.envelope) {
			getCommitmentForFeedback(ctx.workspaceId, parsedInput.commitmentId, ctx.envelope)
				.then((commitment) => {
					if (!commitment) return;
					return createGoldenExample(
						{
							workspaceId: ctx.workspaceId,
							featureDomain: 'commitment_extraction',
							inputContext: commitment.extractionContext || commitment.quote || commitment.title,
							modelPrediction: {
								title: commitment.title,
								commitment_type: commitment.commitmentType,
								assignee: commitment.assignee,
								confidence: commitment.confidence,
							},
							correctedOutput: { no_commitment: true },
							source: 'implicit_signal',
							sourceInteractionId: commitment.id,
						},
						ctx.envelope,
					);
				})
				.catch(() => {}); // Fire-and-forget — never block the dismiss action
		}

		if (parsedInput.status === 'completed') {
			track(ctx.workspaceId, ctx.session.user.id, 'fulfill_commitment', {
				commitmentId: parsedInput.commitmentId,
			});
		}

		if (parsedInput.status === 'active') {
			track(ctx.workspaceId, ctx.session.user.id, 'confirm_commitment', {
				commitmentId: parsedInput.commitmentId,
			});
		}

		return toCommitmentMutationDto(result);
	});

export const snoozeCommitmentAction = workspaceAction
	.schema(
		z.object({
			commitmentId: z.string().uuid(),
			snoozedUntil: z.coerce.date(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		if (parsedInput.snoozedUntil <= new Date()) {
			throw new Error('Snooze date must be in the future');
		}

		const result = await dalSnooze(
			ctx.workspaceId,
			parsedInput.commitmentId,
			parsedInput.snoozedUntil,
		);

		track(ctx.workspaceId, ctx.session.user.id, 'snooze_commitment', {
			commitmentId: parsedInput.commitmentId,
			snoozedUntil: parsedInput.snoozedUntil.toISOString(),
		});

		return toCommitmentMutationDto(result);
	});

// ─── First Look: Analytics Events ───────────────────────────────────────────

const cardEventSchema = z.enum(['commitment.card_viewed', 'commitment.card_ignored']);

/**
 * Track commitment card viewport events from client components.
 * Used by IntersectionObserver (card_viewed) and 10s inaction timer (card_ignored).
 */
export const trackCommitmentCardEventAction = workspaceAction
	.schema(
		z.object({
			commitmentId: z.string().uuid(),
			event: cardEventSchema,
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		track(ctx.workspaceId, ctx.session.user.id, parsedInput.event, {
			commitmentId: parsedInput.commitmentId,
			source: 'first_look',
		});
		return { success: true };
	});

// ─── First Look: Confirm/Dismiss with Bandit Feedback ──────────────────────

const dismissReasonSchema = z.enum(['still_pending', 'already_done', 'not_real']);

/**
 * Confirm a commitment from First Look review.
 * Sets status='active' and sends positive bandit reward (1.0).
 */
export const confirmCommitmentAction = workspaceAction
	.schema(z.object({ commitmentId: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		const result = await dalUpdateStatus(ctx.workspaceId, parsedInput.commitmentId, 'active');

		if (result?.banditTraceId) {
			await finalizeBanditReward(result.banditTraceId, 1.0);
		}

		track(ctx.workspaceId, ctx.session.user.id, 'confirm_commitment', {
			commitmentId: parsedInput.commitmentId,
			source: 'first_look',
		});

		return { success: true };
	});

/**
 * Dismiss a commitment from First Look review with reason.
 * - 'still_pending': no status change, no bandit signal
 * - 'already_done': mark fulfilled, positive reward (1.0)
 * - 'not_real': mark dismissed, negative reward (0.0) + correction diff for bandit learning
 */
export const dismissCommitmentAction = workspaceAction
	.schema(
		z.object({
			commitmentId: z.string().uuid(),
			reason: dismissReasonSchema,
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const { commitmentId, reason } = parsedInput;

		if (reason === 'still_pending') {
			return { success: true };
		}

		if (reason === 'already_done') {
			if (!ctx.envelope) throw new Error('Workspace encryption key not found');
			const result = await markCommitmentFulfilled(
				ctx.workspaceId,
				commitmentId,
				'User confirmed during First Look review',
				ctx.envelope,
			);

			if (result?.banditTraceId) {
				await finalizeBanditReward(result.banditTraceId, 1.0);
			}

			track(ctx.workspaceId, ctx.session.user.id, 'fulfill_commitment', {
				commitmentId,
				source: 'first_look',
			});

			return { success: true };
		}

		// reason === 'not_real' — NEGATIVE bandit signal + correction diff
		const result = await dalUpdateStatus(ctx.workspaceId, commitmentId, 'dismissed');

		if (result?.banditTraceId) {
			await finalizeBanditReward(result.banditTraceId, 0.0);
		}

		// Create correction diff in golden_dataset (fire-and-forget)
		if (ctx.envelope) {
			getCommitmentForFeedback(ctx.workspaceId, commitmentId, ctx.envelope)
				.then(async (commitment) => {
					if (!commitment) return;
					const example = await createGoldenExample(
						{
							workspaceId: ctx.workspaceId,
							featureDomain: 'commitment_extraction',
							inputContext: commitment.extractionContext || commitment.quote || commitment.title,
							modelPrediction: {
								title: commitment.title,
								commitment_type: commitment.commitmentType,
								assignee: commitment.assignee,
								confidence: commitment.confidence,
							},
							correctedOutput: { no_commitment: true },
							correctionReasoning: `User marked as not a real commitment during First Look (type=${commitment.commitmentType}, confidence=${commitment.confidence})`,
							source: 'implicit_signal',
							sourceInteractionId: commitment.id,
						},
						ctx.envelope,
					);

					if (example) {
						await createCorrectionDiff({
							workspaceId: ctx.workspaceId,
							goldenId: example.id,
							diffType: 'false_positive',
							severityScore: 5,
							description: `User dismissed as not a real commitment (type=${commitment.commitmentType}, confidence=${commitment.confidence})`,
						});
					}
				})
				.catch(() => {}); // Fire-and-forget — never block the dismiss action
		}

		track(ctx.workspaceId, ctx.session.user.id, 'dismiss_commitment', {
			commitmentId,
			reason: 'not_real',
			source: 'first_look',
		});

		return { success: true };
	});
