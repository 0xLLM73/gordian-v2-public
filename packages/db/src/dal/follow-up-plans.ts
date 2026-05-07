import { withKeys } from '@repo/crypto';
import type { SealedEnvelope } from '@repo/crypto';
import { and, asc, count, eq, inArray, lte, sql } from 'drizzle-orm';
import { db } from '../client';
import { contacts } from '../schema/contacts';
import { draftLogs } from '../schema/drafts';
import { followUpPlanSteps, followUpPlans } from '../schema/follow-up-plans';

// ─── Templates ────────────────────────────────────────────────────────────────

export interface FollowUpPlanTemplate {
	id: string;
	title: string;
	description: string;
	steps: Array<{ prompt: string; delayHours: number }>;
}

export const FOLLOW_UP_PLAN_TEMPLATES: FollowUpPlanTemplate[] = [
	{
		id: 'vc-followup',
		title: 'VC Follow-up',
		description: 'Post-meeting follow-up sequence for investors',
		steps: [
			{ prompt: 'Thank them for the meeting, highlight one key discussion point', delayHours: 2 },
			{
				prompt: 'Share a relevant article or data point related to what was discussed',
				delayHours: 72,
			},
			{
				prompt: 'Check in on next steps, reference any commitments made in the meeting',
				delayHours: 168,
			},
			{ prompt: 'Soft close: ask about timeline for decision or next meeting', delayHours: 336 },
		],
	},
	{
		id: 'post-intro',
		title: 'Post-Introduction',
		description: 'Nurture sequence after being introduced to someone',
		steps: [
			{
				prompt: 'Thank them for connecting, mention the person who introduced you',
				delayHours: 1,
			},
			{
				prompt: 'Share something valuable related to their work or interests',
				delayHours: 48,
			},
			{
				prompt: 'Suggest a specific time to meet or call, reference shared interests',
				delayHours: 120,
			},
		],
	},
	{
		id: 'deal-nurture',
		title: 'Deal Nurture',
		description: 'Keep a deal warm during negotiation phases',
		steps: [
			{ prompt: 'Share an update on progress or a relevant market insight', delayHours: 48 },
			{
				prompt: 'Ask if they have any questions or concerns about the deal terms',
				delayHours: 120,
			},
			{
				prompt: 'Provide social proof: mention a similar successful deal or partnership',
				delayHours: 168,
			},
			{
				prompt: 'Gentle push toward next steps with a specific proposal or timeline',
				delayHours: 240,
			},
		],
	},
	{
		id: 're-engage',
		title: 'Re-engage',
		description: 'Reconnect with a dormant contact',
		steps: [
			{
				prompt: 'Warm re-connection referencing a shared memory or past conversation topic',
				delayHours: 0,
			},
			{
				prompt: 'Share something they would find valuable based on their interests',
				delayHours: 72,
			},
			{
				prompt: 'Suggest catching up over coffee or a quick call, keep it low-pressure',
				delayHours: 168,
			},
		],
	},
];

// ─── Max Active Follow-up Plans ──────────────────────────────────────────────

const MAX_ACTIVE_FOLLOW_UP_PLANS = 10;

// ─── Create ───────────────────────────────────────────────────────────────────

export interface CreateFollowUpPlanInput {
	contactId: string;
	title: string;
	templateId?: string;
	config?: Record<string, unknown>;
	steps: Array<{ prompt: string; delayHours: number }>;
}

export async function createFollowUpPlan(
	workspaceId: string,
	input: CreateFollowUpPlanInput,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		// SEC-106: Verify contactId belongs to this workspace before INSERT
		const [contact] = await db
			.select({ id: contacts.id })
			.from(contacts)
			.where(and(eq(contacts.id, input.contactId), eq(contacts.workspaceId, workspaceId)))
			.limit(1);

		if (!contact) {
			throw new Error('Not found');
		}

		// Enforce max active follow-up plans per workspace
		const [activeCount] = await db
			.select({ count: count() })
			.from(followUpPlans)
			.where(and(eq(followUpPlans.workspaceId, workspaceId), eq(followUpPlans.status, 'active')));

		if (activeCount && activeCount.count >= MAX_ACTIVE_FOLLOW_UP_PLANS) {
			throw new Error(
				`Maximum of ${MAX_ACTIVE_FOLLOW_UP_PLANS} active follow-up plans per workspace`,
			);
		}

		const [plan] = await db
			.insert(followUpPlans)
			.values({
				workspaceId,
				contactId: input.contactId,
				title: input.title,
				templateId: input.templateId,
				totalSteps: input.steps.length,
				config: input.config ?? {},
			})
			.returning();

		// Create steps
		if (input.steps.length > 0) {
			await db.insert(followUpPlanSteps).values(
				input.steps.map((step, i) => ({
					cadenceId: plan.id,
					workspaceId,
					stepNumber: i + 1,
					prompt: step.prompt,
					delayHours: step.delayHours,
				})),
			);
		}

		return plan;
	});
}

// ─── State Machine Transitions ────────────────────────────────────────────────

export async function activateFollowUpPlan(workspaceId: string, planId: string) {
	// SEC-105: Transaction prevents TOCTOU race on max active plans check
	return db.transaction(async (tx) => {
		const [activeCount] = await tx
			.select({ count: count() })
			.from(followUpPlans)
			.where(and(eq(followUpPlans.workspaceId, workspaceId), eq(followUpPlans.status, 'active')));

		if (activeCount && activeCount.count >= MAX_ACTIVE_FOLLOW_UP_PLANS) {
			throw new Error(
				`Maximum of ${MAX_ACTIVE_FOLLOW_UP_PLANS} active follow-up plans per workspace`,
			);
		}

		const now = new Date();

		const [updated] = await tx
			.update(followUpPlans)
			.set({ status: 'active', activatedAt: now, updatedAt: now })
			.where(
				and(
					eq(followUpPlans.id, planId),
					eq(followUpPlans.workspaceId, workspaceId),
					eq(followUpPlans.status, 'draft'),
				),
			)
			.returning();

		if (!updated) return null;

		// SEC-112: Schedule first step (scoped to workspace)
		const [firstStep] = await tx
			.select()
			.from(followUpPlanSteps)
			.where(
				and(
					eq(followUpPlanSteps.cadenceId, planId),
					eq(followUpPlanSteps.workspaceId, workspaceId),
					eq(followUpPlanSteps.stepNumber, 1),
				),
			)
			.limit(1);

		if (firstStep) {
			const scheduledAt = new Date(now.getTime() + firstStep.delayHours * 60 * 60 * 1000);
			await tx
				.update(followUpPlanSteps)
				.set({ status: 'ready', scheduledAt })
				.where(eq(followUpPlanSteps.id, firstStep.id));
		}

		return updated;
	});
}

export async function pauseFollowUpPlan(workspaceId: string, planId: string) {
	const [updated] = await db
		.update(followUpPlans)
		.set({ status: 'paused', pausedAt: new Date(), updatedAt: new Date() })
		.where(
			and(
				eq(followUpPlans.id, planId),
				eq(followUpPlans.workspaceId, workspaceId),
				eq(followUpPlans.status, 'active'),
			),
		)
		.returning();
	return updated ?? null;
}

export async function resumeFollowUpPlan(workspaceId: string, planId: string) {
	// SEC-105: Transaction prevents TOCTOU race on max active plans check
	return db.transaction(async (tx) => {
		const [activeCount] = await tx
			.select({ count: count() })
			.from(followUpPlans)
			.where(and(eq(followUpPlans.workspaceId, workspaceId), eq(followUpPlans.status, 'active')));

		if (activeCount && activeCount.count >= MAX_ACTIVE_FOLLOW_UP_PLANS) {
			throw new Error(
				`Maximum of ${MAX_ACTIVE_FOLLOW_UP_PLANS} active follow-up plans per workspace`,
			);
		}

		const [updated] = await tx
			.update(followUpPlans)
			.set({ status: 'active', pausedAt: null, updatedAt: new Date() })
			.where(
				and(
					eq(followUpPlans.id, planId),
					eq(followUpPlans.workspaceId, workspaceId),
					eq(followUpPlans.status, 'paused'),
				),
			)
			.returning();
		return updated ?? null;
	});
}

export async function cancelFollowUpPlan(workspaceId: string, planId: string) {
	const [updated] = await db
		.update(followUpPlans)
		.set({ status: 'cancelled', updatedAt: new Date() })
		.where(
			and(
				eq(followUpPlans.id, planId),
				eq(followUpPlans.workspaceId, workspaceId),
				inArray(followUpPlans.status, ['draft', 'active', 'paused']),
			),
		)
		.returning();
	return updated ?? null;
}

// ─── Step Operations ──────────────────────────────────────────────────────────

/**
 * Get steps that are ready to be processed (scheduledAt <= now, status = ready).
 * Excludes encrypted fields (title, prompt, draftText) — caller must re-query
 * per-workspace using getFollowUpPlan/getFollowUpPlanSteps with the workspace envelope.
 */
export async function getReadySteps() {
	return db
		.select({
			step: {
				id: followUpPlanSteps.id,
				cadenceId: followUpPlanSteps.cadenceId,
				workspaceId: followUpPlanSteps.workspaceId,
				stepNumber: followUpPlanSteps.stepNumber,
				delayHours: followUpPlanSteps.delayHours,
				status: followUpPlanSteps.status,
				scheduledAt: followUpPlanSteps.scheduledAt,
			},
			cadence: {
				id: followUpPlans.id,
				workspaceId: followUpPlans.workspaceId,
				contactId: followUpPlans.contactId,
				status: followUpPlans.status,
				totalSteps: followUpPlans.totalSteps,
				completedSteps: followUpPlans.completedSteps,
				config: followUpPlans.config,
			},
		})
		.from(followUpPlanSteps)
		.innerJoin(followUpPlans, eq(followUpPlanSteps.cadenceId, followUpPlans.id))
		.where(
			and(
				eq(followUpPlanSteps.status, 'ready'),
				lte(followUpPlanSteps.scheduledAt, new Date()),
				eq(followUpPlans.status, 'active'),
			),
		)
		.orderBy(asc(followUpPlanSteps.scheduledAt));
}

/** Mark a step as sent and advance to the next step (or complete the plan) */
export async function advanceStep(
	workspaceId: string,
	stepId: string,
	draftText: string,
	armType: string | undefined,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const now = new Date();

		// Mark current step as sent (only if ready)
		const [sentStep] = await db
			.update(followUpPlanSteps)
			.set({ status: 'sent', draftText, armType, sentAt: now })
			.where(
				and(
					eq(followUpPlanSteps.id, stepId),
					eq(followUpPlanSteps.workspaceId, workspaceId),
					eq(followUpPlanSteps.status, 'ready'),
				),
			)
			.returning();

		if (!sentStep) return null;

		// SEC-113: Increment completed steps on plan (scoped to workspace)
		await db
			.update(followUpPlans)
			.set({
				completedSteps: sql`${followUpPlans.completedSteps} + 1`,
				updatedAt: now,
			})
			.where(
				and(eq(followUpPlans.id, sentStep.cadenceId), eq(followUpPlans.workspaceId, workspaceId)),
			);

		// SEC-113: Check if there's a next step (scoped to workspace)
		const [nextStep] = await db
			.select()
			.from(followUpPlanSteps)
			.where(
				and(
					eq(followUpPlanSteps.cadenceId, sentStep.cadenceId),
					eq(followUpPlanSteps.workspaceId, workspaceId),
					eq(followUpPlanSteps.stepNumber, sentStep.stepNumber + 1),
				),
			)
			.limit(1);

		if (nextStep) {
			// Schedule next step
			const scheduledAt = new Date(now.getTime() + nextStep.delayHours * 60 * 60 * 1000);
			await db
				.update(followUpPlanSteps)
				.set({ status: 'ready', scheduledAt })
				.where(
					and(
						eq(followUpPlanSteps.id, nextStep.id),
						eq(followUpPlanSteps.workspaceId, workspaceId),
					),
				);
		} else {
			// No more steps — mark plan as completed
			await db
				.update(followUpPlans)
				.set({ status: 'completed', completedAt: now, updatedAt: now })
				.where(
					and(eq(followUpPlans.id, sentStep.cadenceId), eq(followUpPlans.workspaceId, workspaceId)),
				);
		}

		return sentStep;
	});
}

/** Skip a step and advance to the next one */
export async function skipStep(workspaceId: string, stepId: string) {
	const now = new Date();

	const [skippedStep] = await db
		.update(followUpPlanSteps)
		.set({ status: 'skipped' })
		.where(
			and(
				eq(followUpPlanSteps.id, stepId),
				eq(followUpPlanSteps.workspaceId, workspaceId),
				inArray(followUpPlanSteps.status, ['pending', 'ready']),
			),
		)
		.returning();

	if (!skippedStep) return null;

	// SEC-113: Increment completed steps (scoped to workspace)
	await db
		.update(followUpPlans)
		.set({
			completedSteps: sql`${followUpPlans.completedSteps} + 1`,
			updatedAt: now,
		})
		.where(
			and(eq(followUpPlans.id, skippedStep.cadenceId), eq(followUpPlans.workspaceId, workspaceId)),
		);

	// SEC-113: Schedule next step (scoped to workspace)
	const [nextStep] = await db
		.select()
		.from(followUpPlanSteps)
		.where(
			and(
				eq(followUpPlanSteps.cadenceId, skippedStep.cadenceId),
				eq(followUpPlanSteps.workspaceId, workspaceId),
				eq(followUpPlanSteps.stepNumber, skippedStep.stepNumber + 1),
			),
		)
		.limit(1);

	if (nextStep) {
		const scheduledAt = new Date(now.getTime() + nextStep.delayHours * 60 * 60 * 1000);
		await db
			.update(followUpPlanSteps)
			.set({ status: 'ready', scheduledAt })
			.where(
				and(eq(followUpPlanSteps.id, nextStep.id), eq(followUpPlanSteps.workspaceId, workspaceId)),
			);
	} else {
		await db
			.update(followUpPlans)
			.set({ status: 'completed', completedAt: now, updatedAt: now })
			.where(
				and(
					eq(followUpPlans.id, skippedStep.cadenceId),
					eq(followUpPlans.workspaceId, workspaceId),
				),
			);
	}

	return skippedStep;
}

// ─── HITL Review Actions ─────────────────────────────────────────────────────

/** Approve a step in pending_review — marks it sent, increments progress, schedules next step */
export async function approveStep(workspaceId: string, stepId: string, envelope: SealedEnvelope) {
	return withKeys(envelope, async () => {
		const now = new Date();

		const [step] = await db
			.update(followUpPlanSteps)
			.set({ status: 'sent', sentAt: now })
			.where(
				and(
					eq(followUpPlanSteps.id, stepId),
					eq(followUpPlanSteps.workspaceId, workspaceId),
					eq(followUpPlanSteps.status, 'pending_review'),
				),
			)
			.returning();

		if (!step) return null;

		// Increment completed steps on plan
		await db
			.update(followUpPlans)
			.set({
				completedSteps: sql`${followUpPlans.completedSteps} + 1`,
				updatedAt: now,
			})
			.where(and(eq(followUpPlans.id, step.cadenceId), eq(followUpPlans.workspaceId, workspaceId)));

		// Schedule next step or complete plan
		const [nextStep] = await db
			.select()
			.from(followUpPlanSteps)
			.where(
				and(
					eq(followUpPlanSteps.cadenceId, step.cadenceId),
					eq(followUpPlanSteps.workspaceId, workspaceId),
					eq(followUpPlanSteps.stepNumber, step.stepNumber + 1),
				),
			)
			.limit(1);

		if (nextStep) {
			const scheduledAt = new Date(now.getTime() + nextStep.delayHours * 60 * 60 * 1000);
			await db
				.update(followUpPlanSteps)
				.set({ status: 'ready', scheduledAt })
				.where(
					and(
						eq(followUpPlanSteps.id, nextStep.id),
						eq(followUpPlanSteps.workspaceId, workspaceId),
					),
				);
		} else {
			await db
				.update(followUpPlans)
				.set({ status: 'completed', completedAt: now, updatedAt: now })
				.where(
					and(eq(followUpPlans.id, step.cadenceId), eq(followUpPlans.workspaceId, workspaceId)),
				);
		}

		return step;
	});
}

/** Edit draft text then approve — updates draftText, marks sent, logs edit in draftLogs */
export async function editAndApproveStep(
	workspaceId: string,
	stepId: string,
	editedText: string,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const now = new Date();

		// Get current step to read original draftText
		const [current] = await db
			.select()
			.from(followUpPlanSteps)
			.where(
				and(
					eq(followUpPlanSteps.id, stepId),
					eq(followUpPlanSteps.workspaceId, workspaceId),
					eq(followUpPlanSteps.status, 'pending_review'),
				),
			)
			.limit(1);

		if (!current) return null;

		// Compute edit distance (simple character-level diff)
		const editDistance =
			Math.abs((current.draftText?.length ?? 0) - editedText.length) +
			Math.min(current.draftText?.length ?? 0, editedText.length) -
			[...Array(Math.min(current.draftText?.length ?? 0, editedText.length))].filter(
				(_, i) => (current.draftText ?? '')[i] === editedText[i],
			).length;

		// Update step with edited text and mark sent
		const [step] = await db
			.update(followUpPlanSteps)
			.set({ status: 'sent', draftText: editedText, sentAt: now })
			.where(and(eq(followUpPlanSteps.id, stepId), eq(followUpPlanSteps.workspaceId, workspaceId)))
			.returning();

		if (!step) return null;

		// Log the edit in draftLogs
		const plan = await db
			.select({ contactId: followUpPlans.contactId })
			.from(followUpPlans)
			.where(and(eq(followUpPlans.id, step.cadenceId), eq(followUpPlans.workspaceId, workspaceId)))
			.limit(1);

		if (plan[0]) {
			await db.insert(draftLogs).values({
				workspaceId,
				contactId: plan[0].contactId,
				armType:
					(step.armType as 'casual_nudge' | 'professional_value' | 'direct_ask' | 'soft_memory') ??
					'casual_nudge',
				generatedText: current.draftText ?? '',
				editedText,
				editDistance,
				wasSent: true,
				wasDiscarded: false,
				sentAt: now,
			});
		}

		// Increment completed steps
		await db
			.update(followUpPlans)
			.set({
				completedSteps: sql`${followUpPlans.completedSteps} + 1`,
				updatedAt: now,
			})
			.where(and(eq(followUpPlans.id, step.cadenceId), eq(followUpPlans.workspaceId, workspaceId)));

		// Schedule next step or complete plan
		const [nextStep] = await db
			.select()
			.from(followUpPlanSteps)
			.where(
				and(
					eq(followUpPlanSteps.cadenceId, step.cadenceId),
					eq(followUpPlanSteps.workspaceId, workspaceId),
					eq(followUpPlanSteps.stepNumber, step.stepNumber + 1),
				),
			)
			.limit(1);

		if (nextStep) {
			const scheduledAt = new Date(now.getTime() + nextStep.delayHours * 60 * 60 * 1000);
			await db
				.update(followUpPlanSteps)
				.set({ status: 'ready', scheduledAt })
				.where(
					and(
						eq(followUpPlanSteps.id, nextStep.id),
						eq(followUpPlanSteps.workspaceId, workspaceId),
					),
				);
		} else {
			await db
				.update(followUpPlans)
				.set({ status: 'completed', completedAt: now, updatedAt: now })
				.where(
					and(eq(followUpPlans.id, step.cadenceId), eq(followUpPlans.workspaceId, workspaceId)),
				);
		}

		return step;
	});
}

/** Reject a step in pending_review — marks it skipped, logs discard in draftLogs */
export async function rejectStep(workspaceId: string, stepId: string, envelope: SealedEnvelope) {
	return withKeys(envelope, async () => {
		const now = new Date();

		// Get current step for the draftLog
		const [current] = await db
			.select()
			.from(followUpPlanSteps)
			.where(
				and(
					eq(followUpPlanSteps.id, stepId),
					eq(followUpPlanSteps.workspaceId, workspaceId),
					eq(followUpPlanSteps.status, 'pending_review'),
				),
			)
			.limit(1);

		if (!current) return null;

		const [step] = await db
			.update(followUpPlanSteps)
			.set({ status: 'skipped' })
			.where(and(eq(followUpPlanSteps.id, stepId), eq(followUpPlanSteps.workspaceId, workspaceId)))
			.returning();

		if (!step) return null;

		// Log the rejection in draftLogs
		const plan = await db
			.select({ contactId: followUpPlans.contactId })
			.from(followUpPlans)
			.where(and(eq(followUpPlans.id, step.cadenceId), eq(followUpPlans.workspaceId, workspaceId)))
			.limit(1);

		if (plan[0] && current.draftText) {
			await db.insert(draftLogs).values({
				workspaceId,
				contactId: plan[0].contactId,
				armType:
					(step.armType as 'casual_nudge' | 'professional_value' | 'direct_ask' | 'soft_memory') ??
					'casual_nudge',
				generatedText: current.draftText,
				wasSent: false,
				wasDiscarded: true,
			});
		}

		// Increment completed steps (skipped still counts toward progress)
		await db
			.update(followUpPlans)
			.set({
				completedSteps: sql`${followUpPlans.completedSteps} + 1`,
				updatedAt: now,
			})
			.where(and(eq(followUpPlans.id, step.cadenceId), eq(followUpPlans.workspaceId, workspaceId)));

		// Schedule next step or complete plan
		const [nextStep] = await db
			.select()
			.from(followUpPlanSteps)
			.where(
				and(
					eq(followUpPlanSteps.cadenceId, step.cadenceId),
					eq(followUpPlanSteps.workspaceId, workspaceId),
					eq(followUpPlanSteps.stepNumber, step.stepNumber + 1),
				),
			)
			.limit(1);

		if (nextStep) {
			const scheduledAt = new Date(now.getTime() + nextStep.delayHours * 60 * 60 * 1000);
			await db
				.update(followUpPlanSteps)
				.set({ status: 'ready', scheduledAt })
				.where(
					and(
						eq(followUpPlanSteps.id, nextStep.id),
						eq(followUpPlanSteps.workspaceId, workspaceId),
					),
				);
		} else {
			await db
				.update(followUpPlans)
				.set({ status: 'completed', completedAt: now, updatedAt: now })
				.where(
					and(eq(followUpPlans.id, step.cadenceId), eq(followUpPlans.workspaceId, workspaceId)),
				);
		}

		return step;
	});
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function listFollowUpPlans(
	workspaceId: string,
	opts: { status?: string; contactId?: string; limit?: number } | undefined,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const conditions = [eq(followUpPlans.workspaceId, workspaceId)];
		if (opts?.status) {
			conditions.push(
				eq(followUpPlans.status, opts.status as (typeof followUpPlans.status.enumValues)[number]),
			);
		}
		if (opts?.contactId) {
			conditions.push(eq(followUpPlans.contactId, opts.contactId));
		}

		return db
			.select()
			.from(followUpPlans)
			.where(and(...conditions))
			.orderBy(asc(followUpPlans.createdAt))
			.limit(opts?.limit ?? 50);
	});
}

export async function getFollowUpPlan(
	workspaceId: string,
	planId: string,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const [result] = await db
			.select()
			.from(followUpPlans)
			.where(and(eq(followUpPlans.id, planId), eq(followUpPlans.workspaceId, workspaceId)))
			.limit(1);
		return result ?? null;
	});
}

export async function getFollowUpPlanSteps(
	workspaceId: string,
	planId: string,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		return db
			.select()
			.from(followUpPlanSteps)
			.where(
				and(
					eq(followUpPlanSteps.cadenceId, planId),
					eq(followUpPlanSteps.workspaceId, workspaceId),
				),
			)
			.orderBy(asc(followUpPlanSteps.stepNumber));
	});
}

/** Auto-pause follow-up plans for a contact when they reply (called from sync worker) */
export async function autoPauseOnReply(workspaceId: string, contactId: string) {
	const result = await db
		.update(followUpPlans)
		.set({ status: 'paused', pausedAt: new Date(), updatedAt: new Date() })
		.where(
			and(
				eq(followUpPlans.workspaceId, workspaceId),
				eq(followUpPlans.contactId, contactId),
				eq(followUpPlans.status, 'active'),
			),
		)
		.returning({ id: followUpPlans.id });
	return result;
}
