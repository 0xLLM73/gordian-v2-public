'use server';

import { getOptionalWorkerInternalSecret } from '@/lib/runtime-env';
import { workspaceAction } from '@/lib/safe-action';
import { track } from '@/lib/track';
import {
	createCorrectionDiff,
	createGoldenExample,
	getActiveCommitments as dalGetActive,
	getCommitmentsByContact as dalGetByContact,
	snoozeCommitment as dalSnooze,
	updateCommitmentStatus as dalUpdateStatus,
	finalizeBanditReward,
	getCommitmentForFeedback,
	markCommitmentFulfilled,
} from '@repo/db';
import { commitmentStatusSchema } from '@repo/shared';
import { z } from 'zod';

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
		// SEC-PROJ-001: Never send extractionContext, embedding, or banditTraceId to the client.
		// Quote and contact name are user-facing data (safe for display in review flows).
		return raw.map((c) => ({
			id: c.id,
			title: c.title,
			commitmentType: c.commitmentType,
			status: c.status,
			assignee: c.assignee,
			confidence: c.confidence,
			dueDate: c.dueDate,
			contactId: c.contactId,
			fulfilledAt: c.fulfilledAt,
			snoozedUntil: c.snoozedUntil,
			createdAt: c.createdAt,
			quote: c.quote,
			contactFirstName: c.contactFirstName,
			contactLastName: c.contactLastName,
		}));
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
		return dalGetByContact(ctx.workspaceId, parsedInput.contactId, ctx.envelope, {
			status: parsedInput.status,
			limit: parsedInput.limit,
		});
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
		if (parsedInput.status === 'dismissed' && ctx.envelope) {
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

		return result;
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

		return result;
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
