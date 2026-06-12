import { randomUUID } from 'node:crypto';
import type { SealedEnvelope } from '@repo/crypto';
import { withKeys } from '@repo/crypto';
import { and, asc, count, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../client';
import { contacts } from '../schema/contacts';
import { draftLogs } from '../schema/drafts';
import {
	followUpPlanActivityEvents,
	followUpPlanDraftRevisions,
	followUpPlanSendRecords,
	followUpPlanSteps,
	followUpPlans,
	followUpPlanTemplateVersions,
	followUpPlanUserTemplateVersions,
	followUpPlanWorkerHeartbeats,
} from '../schema/follow-up-plans';

// ─── Templates ────────────────────────────────────────────────────────────────

export interface FollowUpPlanTemplate {
	id: string;
	title: string;
	description: string;
	version: number;
	source: 'built_in' | 'user';
	category?: string | null;
	steps: Array<{ prompt: string; delayHours: number }>;
}

export interface CreateFollowUpPlanTemplateInput {
	title: string;
	description?: string | null;
	category?: string | null;
	steps: Array<{ prompt: string; delayHours: number }>;
}

export interface CreateFollowUpPlanTemplateFromPlanInput {
	title?: string | null;
	description?: string | null;
	category?: string | null;
}

const BUILT_IN_FOLLOW_UP_PLAN_TEMPLATE_SOURCE = 'built_in' as const;
const BUILT_IN_FOLLOW_UP_PLAN_TEMPLATE_VERSION = 1;

export const FOLLOW_UP_PLAN_TEMPLATES: FollowUpPlanTemplate[] = [
	{
		id: 'vc-followup',
		title: 'VC Follow-up',
		description: 'Post-meeting follow-up sequence for investors',
		version: BUILT_IN_FOLLOW_UP_PLAN_TEMPLATE_VERSION,
		source: BUILT_IN_FOLLOW_UP_PLAN_TEMPLATE_SOURCE,
		category: 'Investor',
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
		version: BUILT_IN_FOLLOW_UP_PLAN_TEMPLATE_VERSION,
		source: BUILT_IN_FOLLOW_UP_PLAN_TEMPLATE_SOURCE,
		category: 'Network',
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
		version: BUILT_IN_FOLLOW_UP_PLAN_TEMPLATE_VERSION,
		source: BUILT_IN_FOLLOW_UP_PLAN_TEMPLATE_SOURCE,
		category: 'Deal',
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
		version: BUILT_IN_FOLLOW_UP_PLAN_TEMPLATE_VERSION,
		source: BUILT_IN_FOLLOW_UP_PLAN_TEMPLATE_SOURCE,
		category: 'Relationship',
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

function normalizeTemplateSteps(value: unknown): FollowUpPlanTemplate['steps'] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((step) => {
		if (!step || typeof step !== 'object') return [];
		const prompt = (step as Record<string, unknown>).prompt;
		const delayHours = (step as Record<string, unknown>).delayHours;
		if (typeof prompt !== 'string' || !prompt.trim()) return [];
		if (typeof delayHours !== 'number' || !Number.isFinite(delayHours)) return [];
		return [{ prompt, delayHours: Math.max(0, Math.trunc(delayHours)) }];
	});
}

function parseEncryptedTemplateSteps(value: string): FollowUpPlanTemplate['steps'] {
	try {
		return normalizeTemplateSteps(JSON.parse(value));
	} catch {
		return [];
	}
}

function validateTemplateSteps(steps: Array<{ prompt: string; delayHours: number }>) {
	const normalized = normalizeTemplateSteps(steps);
	if (normalized.length === 0) {
		throw new Error('At least one template step is required');
	}
	if (normalized.length > 20) {
		throw new Error('Templates can include at most 20 steps');
	}
	return normalized;
}

export async function seedBuiltInFollowUpPlanTemplates() {
	const now = new Date();
	const rows = FOLLOW_UP_PLAN_TEMPLATES.map((template) => ({
		templateId: template.id,
		version: template.version,
		source: template.source,
		title: template.title,
		description: template.description,
		category: template.category ?? null,
		steps: template.steps,
		isActive: true,
		metadata: {
			seededFrom: 'FOLLOW_UP_PLAN_TEMPLATES',
		},
		createdAt: now,
		updatedAt: now,
	}));

	await db.insert(followUpPlanTemplateVersions).values(rows).onConflictDoNothing();
	return rows.length;
}

export async function listFollowUpPlanTemplates(
	workspaceId?: string,
	envelope?: SealedEnvelope,
): Promise<FollowUpPlanTemplate[]> {
	await seedBuiltInFollowUpPlanTemplates();

	const rows = await db
		.select()
		.from(followUpPlanTemplateVersions)
		.where(
			and(
				eq(followUpPlanTemplateVersions.source, BUILT_IN_FOLLOW_UP_PLAN_TEMPLATE_SOURCE),
				eq(followUpPlanTemplateVersions.isActive, true),
			),
		)
		.orderBy(
			asc(followUpPlanTemplateVersions.templateId),
			desc(followUpPlanTemplateVersions.version),
		)
		.limit(100);

	const latestById = new Map<string, FollowUpPlanTemplate>();
	for (const row of rows) {
		if (latestById.has(row.templateId)) continue;
		latestById.set(row.templateId, {
			id: row.templateId,
			title: row.title,
			description: row.description,
			version: row.version,
			source: row.source === 'built_in' ? 'built_in' : BUILT_IN_FOLLOW_UP_PLAN_TEMPLATE_SOURCE,
			category: row.category,
			steps: normalizeTemplateSteps(row.steps),
		});
	}

	const builtIns = rows.length === 0 ? FOLLOW_UP_PLAN_TEMPLATES : [...latestById.values()];
	const templates = builtIns.filter((template) => template.steps.length > 0);

	if (!workspaceId || !envelope) return templates;

	const userTemplates = await withKeys(envelope, async () => {
		const userRows = await db
			.select()
			.from(followUpPlanUserTemplateVersions)
			.where(
				and(
					eq(followUpPlanUserTemplateVersions.workspaceId, workspaceId),
					eq(followUpPlanUserTemplateVersions.isActive, true),
				),
			)
			.orderBy(
				asc(followUpPlanUserTemplateVersions.templateId),
				desc(followUpPlanUserTemplateVersions.version),
			)
			.limit(100);

		const latestUserById = new Map<string, FollowUpPlanTemplate>();
		for (const row of userRows) {
			if (latestUserById.has(row.templateId)) continue;
			const steps = parseEncryptedTemplateSteps(row.steps);
			if (steps.length === 0) continue;
			latestUserById.set(row.templateId, {
				id: row.templateId,
				title: row.title,
				description: row.description,
				version: row.version,
				source: 'user',
				category: row.category,
				steps,
			});
		}
		return [...latestUserById.values()];
	});

	return [...userTemplates, ...templates];
}

export async function createFollowUpPlanTemplate(
	workspaceId: string,
	input: CreateFollowUpPlanTemplateInput,
	envelope: SealedEnvelope,
): Promise<FollowUpPlanTemplate> {
	const title = input.title.trim();
	if (!title) throw new Error('Template title is required');
	const steps = validateTemplateSteps(input.steps);
	const now = new Date();
	const templateId = `local-${randomUUID()}`;
	const description = input.description?.trim() || 'Local follow-up template';
	const category = input.category?.trim() || null;

	return withKeys(envelope, async () => {
		const [created] = await db
			.insert(followUpPlanUserTemplateVersions)
			.values({
				workspaceId,
				templateId,
				version: 1,
				title,
				description,
				category,
				steps: JSON.stringify(steps),
				isActive: true,
				metadata: {
					createdFrom: 'follow_up_plan_wizard',
				},
				createdAt: now,
				updatedAt: now,
			})
			.returning();

		return {
			id: created?.templateId ?? templateId,
			title: created?.title ?? title,
			description: created?.description ?? description,
			version: created?.version ?? 1,
			source: 'user',
			category: created?.category ?? category,
			steps: created?.steps ? parseEncryptedTemplateSteps(created.steps) : steps,
		};
	});
}

export async function createFollowUpPlanTemplateVersion(
	workspaceId: string,
	templateId: string,
	input: CreateFollowUpPlanTemplateInput,
	envelope: SealedEnvelope,
): Promise<FollowUpPlanTemplate> {
	const normalizedTemplateId = templateId.trim();
	if (!normalizedTemplateId) throw new Error('Template id is required');
	const title = input.title.trim();
	if (!title) throw new Error('Template title is required');
	const steps = validateTemplateSteps(input.steps);
	const now = new Date();
	const description = input.description?.trim() || 'Local follow-up template';
	const category = input.category?.trim() || null;

	return withKeys(envelope, async () => {
		const latestRows = await db
			.select()
			.from(followUpPlanUserTemplateVersions)
			.where(
				and(
					eq(followUpPlanUserTemplateVersions.workspaceId, workspaceId),
					eq(followUpPlanUserTemplateVersions.templateId, normalizedTemplateId),
					eq(followUpPlanUserTemplateVersions.isActive, true),
				),
			)
			.orderBy(desc(followUpPlanUserTemplateVersions.version))
			.limit(1);

		const latest = latestRows[0];
		if (!latest) {
			throw new Error('Local template not found');
		}

		const nextVersion = latest.version + 1;
		const [created] = await db
			.insert(followUpPlanUserTemplateVersions)
			.values({
				workspaceId,
				templateId: normalizedTemplateId,
				version: nextVersion,
				title,
				description,
				category,
				steps: JSON.stringify(steps),
				isActive: true,
				metadata: {
					createdFrom: 'follow_up_plan_wizard',
					previousVersion: latest.version,
				},
				createdAt: now,
				updatedAt: now,
			})
			.returning();

		return {
			id: created?.templateId ?? normalizedTemplateId,
			title: created?.title ?? title,
			description: created?.description ?? description,
			version: created?.version ?? nextVersion,
			source: 'user',
			category: created?.category ?? category,
			steps: created?.steps ? parseEncryptedTemplateSteps(created.steps) : steps,
		};
	});
}

export async function createFollowUpPlanTemplateFromPlan(
	workspaceId: string,
	followUpPlanId: string,
	input: CreateFollowUpPlanTemplateFromPlanInput,
	envelope: SealedEnvelope,
): Promise<FollowUpPlanTemplate> {
	return withKeys(envelope, async () => {
		const [plan] = await db
			.select()
			.from(followUpPlans)
			.where(and(eq(followUpPlans.id, followUpPlanId), eq(followUpPlans.workspaceId, workspaceId)))
			.limit(1);

		if (!plan) {
			throw new Error('Follow-up plan not found');
		}

		const planSteps = await db
			.select()
			.from(followUpPlanSteps)
			.where(
				and(
					eq(followUpPlanSteps.cadenceId, followUpPlanId),
					eq(followUpPlanSteps.workspaceId, workspaceId),
				),
			)
			.orderBy(asc(followUpPlanSteps.stepNumber))
			.limit(20);

		const steps = validateTemplateSteps(
			planSteps.map((step) => ({
				prompt: step.prompt,
				delayHours: step.delayHours,
			})),
		);

		const now = new Date();
		const templateId = `local-${randomUUID()}`;
		const title = input.title?.trim() || `${plan.title} template`;
		const description =
			input.description?.trim() || `Local template duplicated from ${plan.title}.`;
		const category = input.category?.trim() || null;

		const [created] = await db
			.insert(followUpPlanUserTemplateVersions)
			.values({
				workspaceId,
				templateId,
				version: 1,
				title,
				description,
				category,
				steps: JSON.stringify(steps),
				isActive: true,
				metadata: {
					createdFrom: 'follow_up_plan_detail',
					sourcePlanId: followUpPlanId,
				},
				createdAt: now,
				updatedAt: now,
			})
			.returning();

		await appendFollowUpPlanActivity(workspaceId, {
			followUpPlanId,
			eventType: 'template_created',
			summary: 'Plan saved as a local template.',
			metadata: {
				templateId: created?.templateId ?? templateId,
				templateVersion: created?.version ?? 1,
			},
		});

		return {
			id: created?.templateId ?? templateId,
			title: created?.title ?? title,
			description: created?.description ?? description,
			version: created?.version ?? 1,
			source: 'user',
			category: created?.category ?? category,
			steps: created?.steps ? parseEncryptedTemplateSteps(created.steps) : steps,
		};
	});
}

// ─── Max Active Follow-up Plans ──────────────────────────────────────────────

const MAX_ACTIVE_FOLLOW_UP_PLANS = 10;

export const FOLLOW_UP_PLAN_ACTIVITY_TYPES = [
	'plan_created',
	'plan_activated',
	'plan_paused',
	'plan_resumed',
	'plan_cancelled',
	'plan_completed',
	'draft_pending_review',
	'draft_copied',
	'telegram_opened',
	'manual_send_confirmed',
	'draft_skipped',
	'step_rescheduled',
	'template_created',
	'draft_regeneration_requested',
] as const;

export type FollowUpPlanActivityType = (typeof FOLLOW_UP_PLAN_ACTIVITY_TYPES)[number];

export const FOLLOW_UP_PLAN_DRAFT_STATUSES = [
	'pending_review',
	'edited',
	'sent_version',
	'rejected',
	'superseded',
	'failed',
] as const;

export type FollowUpPlanDraftStatus = (typeof FOLLOW_UP_PLAN_DRAFT_STATUSES)[number];

export const FOLLOW_UP_PLAN_SEND_STATUSES = [
	'copied',
	'telegram_opened',
	'manual_confirmed',
	'skipped',
] as const;

export type FollowUpPlanSendStatus = (typeof FOLLOW_UP_PLAN_SEND_STATUSES)[number];

export const FOLLOW_UP_PLAN_WORKER_ID = 'follow-up-plan-processor';
export const FOLLOW_UP_PLAN_WORKER_HEARTBEAT_STALE_MS = 2 * 60 * 60 * 1000;
export const FOLLOW_UP_PLAN_STEP_PROCESSING_LEASE_MS = 30 * 60 * 1000;
export const FOLLOW_UP_PLAN_READY_STEP_BATCH_SIZE = 25;

export const FOLLOW_UP_PLAN_WORKER_HEARTBEAT_STATUSES = ['running', 'idle', 'error'] as const;

export type FollowUpPlanWorkerHeartbeatStatus =
	(typeof FOLLOW_UP_PLAN_WORKER_HEARTBEAT_STATUSES)[number];

export type FollowUpPlanWorkerHealthStatus = 'running' | 'stale' | 'unknown' | 'error';

export interface AppendFollowUpPlanActivityInput {
	followUpPlanId: string;
	stepId?: string | null;
	eventType: FollowUpPlanActivityType;
	summary: string;
	metadata?: Record<string, unknown>;
}

export interface InsertFollowUpPlanDraftRevisionInput {
	followUpPlanId: string;
	stepId: string;
	status: FollowUpPlanDraftStatus;
	source?: string;
	draftText: string;
	armType?: string | null;
	metadata?: Record<string, unknown>;
	createdAt?: Date;
}

export interface InsertFollowUpPlanSendRecordInput {
	followUpPlanId: string;
	stepId: string;
	status: FollowUpPlanSendStatus;
	channel?: string;
	metadata?: Record<string, unknown>;
}

export interface RecordFollowUpPlanWorkerHeartbeatInput {
	status?: FollowUpPlanWorkerHeartbeatStatus;
	processedSteps?: number;
	failedSteps?: number;
	errorSummary?: string | null;
	metadata?: Record<string, unknown>;
	now?: Date;
}

export interface ClaimReadyFollowUpPlanStepInput {
	now?: Date;
	leaseMs?: number;
}

export interface MarkStepPendingReviewOptions {
	source?: string;
	activitySummary?: string;
	metadata?: Record<string, unknown>;
}

export interface RecordFollowUpPlanStepProcessingFailureInput {
	errorSummary: string;
	now?: Date;
	retryAfterMs?: number;
}

export interface RescheduleFollowUpPlanStepInput {
	scheduledAt: Date;
	reason?: string | null;
}

export interface FollowUpPlanWorkerHealth {
	status: FollowUpPlanWorkerHealthStatus;
	label: string;
	detail: string;
	lastSeenAt: Date | null;
	ageMs: number | null;
	staleAfterMs: number;
	heartbeatStatus: FollowUpPlanWorkerHeartbeatStatus | null;
	processedSteps: number;
	failedSteps: number;
}

function formatHeartbeatAge(ageMs: number) {
	if (ageMs < 60_000) return 'less than a minute ago';
	const minutes = Math.round(ageMs / 60_000);
	if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
	const hours = Math.round(minutes / 60);
	return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}

function summarizeProcessingError(value: string) {
	return value.trim().slice(0, 500) || 'Follow-up step processing failed.';
}

function publicFollowUpWorkerErrorSummary(value: string) {
	const summary = summarizeProcessingError(value);
	if (/(failed query|params:|select |insert |update |delete | from ")/i.test(summary)) {
		return 'Worker database query failed.';
	}
	return summary;
}

export async function recordFollowUpPlanWorkerHeartbeat(
	input: RecordFollowUpPlanWorkerHeartbeatInput = {},
) {
	const now = input.now ?? new Date();
	const status = input.status ?? 'running';
	const values = {
		status,
		lastSeenAt: now,
		processedSteps: input.processedSteps ?? 0,
		failedSteps: input.failedSteps ?? 0,
		metadata: input.metadata ?? {},
		lastErrorSummary: input.errorSummary
			? publicFollowUpWorkerErrorSummary(input.errorSummary)
			: null,
		updatedAt: now,
		...(status === 'running' ? { lastStartedAt: now } : {}),
		...(status === 'idle' ? { lastCompletedAt: now } : {}),
		...(status === 'error' ? { lastFailedAt: now } : {}),
	};

	const [updated] = await db
		.update(followUpPlanWorkerHeartbeats)
		.set(values)
		.where(eq(followUpPlanWorkerHeartbeats.workerId, FOLLOW_UP_PLAN_WORKER_ID))
		.returning();

	if (updated) return updated;

	const [created] = await db
		.insert(followUpPlanWorkerHeartbeats)
		.values({
			workerId: FOLLOW_UP_PLAN_WORKER_ID,
			createdAt: now,
			...values,
		})
		.returning();

	return created ?? null;
}

export async function getFollowUpPlanWorkerHealth(opts?: {
	now?: Date;
	staleAfterMs?: number;
}): Promise<FollowUpPlanWorkerHealth> {
	const now = opts?.now ?? new Date();
	const staleAfterMs = opts?.staleAfterMs ?? FOLLOW_UP_PLAN_WORKER_HEARTBEAT_STALE_MS;
	const [heartbeat] = await db
		.select()
		.from(followUpPlanWorkerHeartbeats)
		.where(eq(followUpPlanWorkerHeartbeats.workerId, FOLLOW_UP_PLAN_WORKER_ID))
		.limit(1);

	if (!heartbeat?.lastSeenAt) {
		return {
			status: 'unknown',
			label: 'No heartbeat',
			detail: 'The follow-up worker has not reported yet.',
			lastSeenAt: null,
			ageMs: null,
			staleAfterMs,
			heartbeatStatus: null,
			processedSteps: 0,
			failedSteps: 0,
		};
	}

	const lastSeenAt =
		heartbeat.lastSeenAt instanceof Date ? heartbeat.lastSeenAt : new Date(heartbeat.lastSeenAt);
	const ageMs = Math.max(0, now.getTime() - lastSeenAt.getTime());
	const ageLabel = formatHeartbeatAge(ageMs);
	const heartbeatStatus = heartbeat.status as FollowUpPlanWorkerHeartbeatStatus;
	const processedSteps = heartbeat.processedSteps ?? 0;
	const failedSteps = heartbeat.failedSteps ?? 0;

	if (ageMs > staleAfterMs) {
		return {
			status: 'stale',
			label: 'Worker stopped',
			detail: `No follow-up worker heartbeat since ${ageLabel}. Due steps wait until the local worker is running; start it with pnpm --filter worker dev.`,
			lastSeenAt,
			ageMs,
			staleAfterMs,
			heartbeatStatus,
			processedSteps,
			failedSteps,
		};
	}

	if (heartbeatStatus === 'error') {
		return {
			status: 'error',
			label: 'Worker error',
			detail:
				(heartbeat.lastErrorSummary
					? publicFollowUpWorkerErrorSummary(heartbeat.lastErrorSummary)
					: null) || 'The last follow-up worker run failed. Drafts are not sent automatically.',
			lastSeenAt,
			ageMs,
			staleAfterMs,
			heartbeatStatus,
			processedSteps,
			failedSteps,
		};
	}

	return {
		status: 'running',
		label: heartbeatStatus === 'running' ? 'Worker running' : 'Worker ready',
		detail:
			heartbeatStatus === 'running'
				? `Last follow-up worker heartbeat was ${ageLabel}.`
				: `Last follow-up worker check completed ${ageLabel}.`,
		lastSeenAt,
		ageMs,
		staleAfterMs,
		heartbeatStatus,
		processedSteps,
		failedSteps,
	};
}

export async function claimReadyFollowUpPlanStep(
	workspaceId: string,
	stepId: string,
	input: ClaimReadyFollowUpPlanStepInput = {},
) {
	const now = input.now ?? new Date();
	const leaseMs = input.leaseMs ?? FOLLOW_UP_PLAN_STEP_PROCESSING_LEASE_MS;
	const leaseExpiresAt = new Date(now.getTime() + leaseMs);

	const [step] = await db
		.update(followUpPlanSteps)
		.set({
			processingStartedAt: now,
			processingLeaseExpiresAt: leaseExpiresAt,
			processingAttempts: sql`${followUpPlanSteps.processingAttempts} + 1`,
			lastProcessingError: null,
		})
		.where(
			and(
				eq(followUpPlanSteps.id, stepId),
				eq(followUpPlanSteps.workspaceId, workspaceId),
				eq(followUpPlanSteps.status, 'ready'),
				or(
					isNull(followUpPlanSteps.processingLeaseExpiresAt),
					lte(followUpPlanSteps.processingLeaseExpiresAt, now),
				),
			),
		)
		.returning();

	return step ?? null;
}

export async function recordFollowUpPlanStepProcessingFailure(
	workspaceId: string,
	stepId: string,
	input: RecordFollowUpPlanStepProcessingFailureInput,
) {
	const now = input.now ?? new Date();
	const retryAt = new Date(
		now.getTime() + (input.retryAfterMs ?? FOLLOW_UP_PLAN_STEP_PROCESSING_LEASE_MS),
	);
	const [step] = await db
		.update(followUpPlanSteps)
		.set({
			processingLeaseExpiresAt: retryAt,
			lastProcessingError: summarizeProcessingError(input.errorSummary),
		})
		.where(
			and(
				eq(followUpPlanSteps.id, stepId),
				eq(followUpPlanSteps.workspaceId, workspaceId),
				eq(followUpPlanSteps.status, 'ready'),
			),
		)
		.returning();

	return step ?? null;
}

export async function appendFollowUpPlanActivity(
	workspaceId: string,
	input: AppendFollowUpPlanActivityInput,
) {
	await db.insert(followUpPlanActivityEvents).values({
		workspaceId,
		followUpPlanId: input.followUpPlanId,
		stepId: input.stepId ?? null,
		eventType: input.eventType,
		summary: input.summary,
		metadata: input.metadata ?? {},
	});
}

async function getLatestDraftRevision(workspaceId: string, followUpPlanId: string, stepId: string) {
	const [latest] = await db
		.select()
		.from(followUpPlanDraftRevisions)
		.where(
			and(
				eq(followUpPlanDraftRevisions.workspaceId, workspaceId),
				eq(followUpPlanDraftRevisions.followUpPlanId, followUpPlanId),
				eq(followUpPlanDraftRevisions.stepId, stepId),
			),
		)
		.orderBy(desc(followUpPlanDraftRevisions.version))
		.limit(1);
	return latest ?? null;
}

async function insertFollowUpPlanDraftRevision(
	workspaceId: string,
	input: InsertFollowUpPlanDraftRevisionInput,
) {
	const latest = await getLatestDraftRevision(workspaceId, input.followUpPlanId, input.stepId);
	const now = input.createdAt ?? new Date();
	const version = (latest?.version ?? 0) + 1;

	await db.insert(followUpPlanDraftRevisions).values({
		workspaceId,
		followUpPlanId: input.followUpPlanId,
		stepId: input.stepId,
		version,
		status: input.status,
		source: input.source ?? 'local_ai',
		draftText: input.draftText,
		armType: input.armType ?? null,
		metadata: input.metadata ?? {},
		approvedAt: input.status === 'sent_version' ? now : null,
		rejectedAt: input.status === 'rejected' ? now : null,
		supersededAt: input.status === 'superseded' ? now : null,
		sentAt: input.status === 'sent_version' ? now : null,
		updatedAt: now,
	});

	return { followUpPlanId: input.followUpPlanId, stepId: input.stepId, version };
}

async function updateLatestDraftRevisionStatus(
	workspaceId: string,
	followUpPlanId: string,
	stepId: string,
	status: FollowUpPlanDraftStatus,
	now = new Date(),
) {
	const latest = await getLatestDraftRevision(workspaceId, followUpPlanId, stepId);
	if (!latest) return null;

	await db
		.update(followUpPlanDraftRevisions)
		.set({
			status,
			approvedAt: status === 'sent_version' ? now : latest.approvedAt,
			rejectedAt: status === 'rejected' ? now : latest.rejectedAt,
			supersededAt: status === 'superseded' ? now : latest.supersededAt,
			sentAt: status === 'sent_version' ? now : latest.sentAt,
			updatedAt: now,
		})
		.where(
			and(
				eq(followUpPlanDraftRevisions.id, latest.id),
				eq(followUpPlanDraftRevisions.workspaceId, workspaceId),
			),
		);

	return latest;
}

export async function createFollowUpPlanDraftRevision(
	workspaceId: string,
	input: InsertFollowUpPlanDraftRevisionInput,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const [step] = await db
			.select({ id: followUpPlanSteps.id })
			.from(followUpPlanSteps)
			.where(
				and(
					eq(followUpPlanSteps.id, input.stepId),
					eq(followUpPlanSteps.cadenceId, input.followUpPlanId),
					eq(followUpPlanSteps.workspaceId, workspaceId),
				),
			)
			.limit(1);

		if (!step) return null;
		return insertFollowUpPlanDraftRevision(workspaceId, input);
	});
}

export async function recordFollowUpPlanStepCopied(
	workspaceId: string,
	followUpPlanId: string,
	stepId: string,
) {
	const [step] = await db
		.select({ id: followUpPlanSteps.id })
		.from(followUpPlanSteps)
		.where(
			and(
				eq(followUpPlanSteps.id, stepId),
				eq(followUpPlanSteps.cadenceId, followUpPlanId),
				eq(followUpPlanSteps.workspaceId, workspaceId),
				eq(followUpPlanSteps.status, 'pending_review'),
			),
		)
		.limit(1);

	if (!step) return null;

	await insertFollowUpPlanSendRecord(workspaceId, {
		followUpPlanId,
		stepId,
		status: 'copied',
	});
	await appendFollowUpPlanActivity(workspaceId, {
		followUpPlanId,
		stepId,
		eventType: 'draft_copied',
		summary: 'Draft copied for manual sending.',
		metadata: { status: 'copied' },
	});

	return { followUpPlanId, stepId, status: 'copied' as const };
}

export async function recordFollowUpPlanTelegramOpened(
	workspaceId: string,
	followUpPlanId: string,
	stepId: string,
) {
	const [step] = await db
		.select({ id: followUpPlanSteps.id })
		.from(followUpPlanSteps)
		.where(
			and(
				eq(followUpPlanSteps.id, stepId),
				eq(followUpPlanSteps.cadenceId, followUpPlanId),
				eq(followUpPlanSteps.workspaceId, workspaceId),
				eq(followUpPlanSteps.status, 'pending_review'),
			),
		)
		.limit(1);

	if (!step) return null;

	await insertFollowUpPlanSendRecord(workspaceId, {
		followUpPlanId,
		stepId,
		status: 'telegram_opened',
		channel: 'telegram',
	});
	await appendFollowUpPlanActivity(workspaceId, {
		followUpPlanId,
		stepId,
		eventType: 'telegram_opened',
		summary: 'Telegram destination opened for manual sending.',
		metadata: { status: 'telegram_opened', channel: 'telegram' },
	});

	return { followUpPlanId, stepId, status: 'telegram_opened' as const };
}

async function insertFollowUpPlanSendRecord(
	workspaceId: string,
	input: InsertFollowUpPlanSendRecordInput,
) {
	const now = new Date();
	await db.insert(followUpPlanSendRecords).values({
		workspaceId,
		followUpPlanId: input.followUpPlanId,
		stepId: input.stepId,
		status: input.status,
		channel: input.channel ?? 'manual',
		metadata: input.metadata ?? {},
		copiedAt: input.status === 'copied' ? now : null,
		telegramOpenedAt: input.status === 'telegram_opened' ? now : null,
		manualConfirmedAt: input.status === 'manual_confirmed' ? now : null,
		updatedAt: now,
	});
}

// ─── Create ───────────────────────────────────────────────────────────────────

export interface CreateFollowUpPlanInput {
	contactId: string;
	title: string;
	objective?: string | null;
	templateId?: string;
	templateVersion?: number | null;
	templateSource?: string | null;
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

		const { objective: configObjective, ...safeConfig } = input.config ?? {};
		const objective =
			typeof input.objective === 'string'
				? input.objective
				: typeof configObjective === 'string'
					? configObjective
					: null;
		const templateSource = input.templateSource ?? (input.templateId ? 'built_in' : null);
		const templateVersion = input.templateVersion ?? null;

		const [plan] = await db
			.insert(followUpPlans)
			.values({
				workspaceId,
				contactId: input.contactId,
				title: input.title,
				objective: objective?.trim() || null,
				templateId: input.templateId,
				templateVersion,
				templateSource,
				totalSteps: input.steps.length,
				config: safeConfig,
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

		await appendFollowUpPlanActivity(workspaceId, {
			followUpPlanId: plan.id,
			eventType: 'plan_created',
			summary: 'Plan created as draft.',
			metadata: {
				templateId: input.templateId ?? null,
				templateVersion,
				templateSource,
				totalSteps: input.steps.length,
			},
		});

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

		await tx.insert(followUpPlanActivityEvents).values({
			workspaceId,
			followUpPlanId: planId,
			stepId: firstStep?.id ?? null,
			eventType: 'plan_activated',
			summary: 'Plan activated.',
			metadata: { firstStepId: firstStep?.id ?? null },
		});

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
	if (updated) {
		await appendFollowUpPlanActivity(workspaceId, {
			followUpPlanId: planId,
			eventType: 'plan_paused',
			summary: 'Plan paused.',
		});
	}
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
		if (updated) {
			await tx.insert(followUpPlanActivityEvents).values({
				workspaceId,
				followUpPlanId: planId,
				eventType: 'plan_resumed',
				summary: 'Plan resumed.',
				metadata: {},
			});
		}
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
	if (updated) {
		await appendFollowUpPlanActivity(workspaceId, {
			followUpPlanId: planId,
			eventType: 'plan_cancelled',
			summary: 'Plan cancelled.',
		});
	}
	return updated ?? null;
}

// ─── Step Operations ──────────────────────────────────────────────────────────

/**
 * Get steps that are ready to be processed (scheduledAt <= now, status = ready).
 * Excludes encrypted fields (title, prompt, draftText) — caller must re-query
 * per-workspace using getFollowUpPlan/getFollowUpPlanSteps with the workspace envelope.
 */
export async function getReadySteps(opts?: { limit?: number }) {
	const limit = Math.min(
		Math.max(1, Math.floor(opts?.limit ?? FOLLOW_UP_PLAN_READY_STEP_BATCH_SIZE)),
		100,
	);
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
				or(
					isNull(followUpPlanSteps.processingLeaseExpiresAt),
					lte(followUpPlanSteps.processingLeaseExpiresAt, new Date()),
				),
				eq(followUpPlans.status, 'active'),
			),
		)
		.orderBy(asc(followUpPlanSteps.scheduledAt))
		.limit(limit);
}

/** Store a generated draft for human review. Review actions advance or skip the plan. */
export async function markStepPendingReview(
	workspaceId: string,
	stepId: string,
	draftText: string,
	armType: string | undefined,
	envelope: SealedEnvelope,
	options?: MarkStepPendingReviewOptions,
) {
	return withKeys(envelope, async () => {
		const [step] = await db
			.update(followUpPlanSteps)
			.set({
				status: 'pending_review',
				draftText,
				armType,
				processingLeaseExpiresAt: null,
				lastProcessingError: null,
			})
			.where(
				and(
					eq(followUpPlanSteps.id, stepId),
					eq(followUpPlanSteps.workspaceId, workspaceId),
					eq(followUpPlanSteps.status, 'ready'),
				),
			)
			.returning();

		if (step) {
			await insertFollowUpPlanDraftRevision(workspaceId, {
				followUpPlanId: step.cadenceId,
				stepId: step.id,
				status: 'pending_review',
				source: options?.source ?? 'local_ai',
				draftText,
				armType: armType ?? null,
				metadata: options?.metadata ?? { trigger: 'worker_generation' },
			});
			await appendFollowUpPlanActivity(workspaceId, {
				followUpPlanId: step.cadenceId,
				stepId: step.id,
				eventType: 'draft_pending_review',
				summary: options?.activitySummary ?? 'Local draft generated for review.',
				metadata: options?.metadata ?? { armType: armType ?? null },
			});
		}

		return step ?? null;
	});
}

export async function rescheduleFollowUpPlanStep(
	workspaceId: string,
	planId: string,
	stepId: string,
	input: RescheduleFollowUpPlanStepInput,
) {
	const now = new Date();
	const reason = input.reason?.trim().slice(0, 500) || null;

	const [step] = await db
		.update(followUpPlanSteps)
		.set({
			status: 'ready',
			scheduledAt: input.scheduledAt,
			draftText: null,
			armType: null,
			sentAt: null,
			processingStartedAt: null,
			processingLeaseExpiresAt: null,
			lastProcessingError: null,
		})
		.where(
			and(
				eq(followUpPlanSteps.id, stepId),
				eq(followUpPlanSteps.cadenceId, planId),
				eq(followUpPlanSteps.workspaceId, workspaceId),
				inArray(followUpPlanSteps.status, ['pending', 'ready', 'pending_review', 'failed']),
			),
		)
		.returning();

	if (!step) return null;

	await appendFollowUpPlanActivity(workspaceId, {
		followUpPlanId: planId,
		stepId,
		eventType: 'step_rescheduled',
		summary: `Step rescheduled for ${input.scheduledAt.toLocaleString()}.`,
		metadata: {
			scheduledAt: input.scheduledAt.toISOString(),
			...(reason ? { reason } : {}),
			recordedAt: now.toISOString(),
		},
	});

	return step;
}

export async function requestFollowUpPlanStepRegeneration(
	workspaceId: string,
	planId: string,
	stepId: string,
) {
	const now = new Date();
	const [step] = await db
		.update(followUpPlanSteps)
		.set({
			status: 'ready',
			scheduledAt: now,
			draftText: null,
			armType: null,
			sentAt: null,
			processingStartedAt: null,
			processingLeaseExpiresAt: null,
			lastProcessingError: null,
		})
		.where(
			and(
				eq(followUpPlanSteps.id, stepId),
				eq(followUpPlanSteps.cadenceId, planId),
				eq(followUpPlanSteps.workspaceId, workspaceId),
				inArray(followUpPlanSteps.status, ['pending_review', 'failed']),
			),
		)
		.returning();

	if (!step) return null;

	await updateLatestDraftRevisionStatus(workspaceId, planId, stepId, 'superseded', now);
	await appendFollowUpPlanActivity(workspaceId, {
		followUpPlanId: planId,
		stepId,
		eventType: 'draft_regeneration_requested',
		summary: 'Draft regeneration requested.',
		metadata: {
			scheduledAt: now.toISOString(),
		},
	});

	return step;
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

/** Mark a reviewed draft as manually sent, then schedule the next step or complete the plan. */
export async function approveStep(
	workspaceId: string,
	planId: string,
	stepId: string,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const now = new Date();

		const [step] = await db
			.update(followUpPlanSteps)
			.set({ status: 'sent', sentAt: now })
			.where(
				and(
					eq(followUpPlanSteps.id, stepId),
					eq(followUpPlanSteps.cadenceId, planId),
					eq(followUpPlanSteps.workspaceId, workspaceId),
					eq(followUpPlanSteps.status, 'pending_review'),
				),
			)
			.returning();

		if (!step) return null;

		const latestRevision = await updateLatestDraftRevisionStatus(
			workspaceId,
			step.cadenceId,
			step.id,
			'sent_version',
			now,
		);
		if (!latestRevision && step.draftText) {
			await insertFollowUpPlanDraftRevision(workspaceId, {
				followUpPlanId: step.cadenceId,
				stepId: step.id,
				status: 'sent_version',
				source: 'legacy_step_draft',
				draftText: step.draftText,
				armType: step.armType ?? null,
				metadata: { importedFromStepDraft: true },
				createdAt: now,
			});
		}

		await insertFollowUpPlanSendRecord(workspaceId, {
			followUpPlanId: step.cadenceId,
			stepId: step.id,
			status: 'manual_confirmed',
		});
		await appendFollowUpPlanActivity(workspaceId, {
			followUpPlanId: step.cadenceId,
			stepId: step.id,
			eventType: 'manual_send_confirmed',
			summary: 'Manual send confirmed.',
			metadata: { status: 'manual_confirmed' },
		});

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
			await appendFollowUpPlanActivity(workspaceId, {
				followUpPlanId: step.cadenceId,
				stepId: step.id,
				eventType: 'plan_completed',
				summary: 'Plan completed.',
			});
		}

		return step;
	});
}

/** Edit draft text then approve — updates draftText, marks sent, logs edit in draftLogs */
export async function editAndApproveStep(
	workspaceId: string,
	planId: string,
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
					eq(followUpPlanSteps.cadenceId, planId),
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
			.where(
				and(
					eq(followUpPlanSteps.id, stepId),
					eq(followUpPlanSteps.cadenceId, planId),
					eq(followUpPlanSteps.workspaceId, workspaceId),
				),
			)
			.returning();

		if (!step) return null;

		const latestRevision = await updateLatestDraftRevisionStatus(
			workspaceId,
			step.cadenceId,
			step.id,
			'superseded',
			now,
		);
		if (!latestRevision && current.draftText) {
			await insertFollowUpPlanDraftRevision(workspaceId, {
				followUpPlanId: step.cadenceId,
				stepId: step.id,
				status: 'superseded',
				source: 'legacy_step_draft',
				draftText: current.draftText,
				armType: current.armType ?? null,
				metadata: { importedFromStepDraft: true },
				createdAt: now,
			});
		}
		await insertFollowUpPlanDraftRevision(workspaceId, {
			followUpPlanId: step.cadenceId,
			stepId: step.id,
			status: 'sent_version',
			source: 'edit',
			draftText: editedText,
			armType: step.armType ?? null,
			metadata: { edited: true },
			createdAt: now,
		});

		await insertFollowUpPlanSendRecord(workspaceId, {
			followUpPlanId: step.cadenceId,
			stepId: step.id,
			status: 'manual_confirmed',
			metadata: { edited: true },
		});
		await appendFollowUpPlanActivity(workspaceId, {
			followUpPlanId: step.cadenceId,
			stepId: step.id,
			eventType: 'manual_send_confirmed',
			summary: 'Edited draft manually sent.',
			metadata: { status: 'manual_confirmed', edited: true },
		});

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
			await appendFollowUpPlanActivity(workspaceId, {
				followUpPlanId: step.cadenceId,
				stepId: step.id,
				eventType: 'plan_completed',
				summary: 'Plan completed.',
			});
		}

		return step;
	});
}

/** Skip a reviewed draft, log the discard, then schedule the next step or complete the plan. */
export async function rejectStep(
	workspaceId: string,
	planId: string,
	stepId: string,
	envelope: SealedEnvelope,
	skipReason?: string | null,
) {
	return withKeys(envelope, async () => {
		const now = new Date();
		const normalizedSkipReason = skipReason?.trim().slice(0, 500) || null;

		// Get current step for the draftLog
		const [current] = await db
			.select()
			.from(followUpPlanSteps)
			.where(
				and(
					eq(followUpPlanSteps.id, stepId),
					eq(followUpPlanSteps.cadenceId, planId),
					eq(followUpPlanSteps.workspaceId, workspaceId),
					eq(followUpPlanSteps.status, 'pending_review'),
				),
			)
			.limit(1);

		if (!current) return null;

		const [step] = await db
			.update(followUpPlanSteps)
			.set({ status: 'skipped' })
			.where(
				and(
					eq(followUpPlanSteps.id, stepId),
					eq(followUpPlanSteps.cadenceId, planId),
					eq(followUpPlanSteps.workspaceId, workspaceId),
				),
			)
			.returning();

		if (!step) return null;

		const latestRevision = await updateLatestDraftRevisionStatus(
			workspaceId,
			step.cadenceId,
			step.id,
			'rejected',
			now,
		);
		if (!latestRevision && current.draftText) {
			await insertFollowUpPlanDraftRevision(workspaceId, {
				followUpPlanId: step.cadenceId,
				stepId: step.id,
				status: 'rejected',
				source: 'legacy_step_draft',
				draftText: current.draftText,
				armType: current.armType ?? null,
				metadata: { importedFromStepDraft: true },
				createdAt: now,
			});
		}

		await insertFollowUpPlanSendRecord(workspaceId, {
			followUpPlanId: step.cadenceId,
			stepId: step.id,
			status: 'skipped',
			metadata: normalizedSkipReason ? { reason: normalizedSkipReason } : {},
		});
		await appendFollowUpPlanActivity(workspaceId, {
			followUpPlanId: step.cadenceId,
			stepId: step.id,
			eventType: 'draft_skipped',
			summary: normalizedSkipReason ? `Draft skipped: ${normalizedSkipReason}` : 'Draft skipped.',
			metadata: normalizedSkipReason
				? { status: 'skipped', reason: normalizedSkipReason }
				: { status: 'skipped' },
		});

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
			await appendFollowUpPlanActivity(workspaceId, {
				followUpPlanId: step.cadenceId,
				stepId: step.id,
				eventType: 'plan_completed',
				summary: 'Plan completed.',
			});
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

export async function listFollowUpPlanActivity(
	workspaceId: string,
	planId: string,
	opts?: { limit?: number },
) {
	return db
		.select()
		.from(followUpPlanActivityEvents)
		.where(
			and(
				eq(followUpPlanActivityEvents.workspaceId, workspaceId),
				eq(followUpPlanActivityEvents.followUpPlanId, planId),
			),
		)
		.orderBy(desc(followUpPlanActivityEvents.createdAt))
		.limit(opts?.limit ?? 50);
}

export async function listFollowUpPlanSendRecords(
	workspaceId: string,
	planId: string,
	opts?: { stepId?: string; limit?: number },
) {
	const conditions = [
		eq(followUpPlanSendRecords.workspaceId, workspaceId),
		eq(followUpPlanSendRecords.followUpPlanId, planId),
	];
	if (opts?.stepId) {
		conditions.push(eq(followUpPlanSendRecords.stepId, opts.stepId));
	}

	return db
		.select()
		.from(followUpPlanSendRecords)
		.where(and(...conditions))
		.orderBy(asc(followUpPlanSendRecords.createdAt))
		.limit(opts?.limit ?? 100);
}

export async function listFollowUpPlanDraftRevisions(
	workspaceId: string,
	planId: string,
	envelope: SealedEnvelope,
	opts?: { stepId?: string; limit?: number },
) {
	return withKeys(envelope, async () => {
		const conditions = [
			eq(followUpPlanDraftRevisions.workspaceId, workspaceId),
			eq(followUpPlanDraftRevisions.followUpPlanId, planId),
		];
		if (opts?.stepId) {
			conditions.push(eq(followUpPlanDraftRevisions.stepId, opts.stepId));
		}

		return db
			.select()
			.from(followUpPlanDraftRevisions)
			.where(and(...conditions))
			.orderBy(asc(followUpPlanDraftRevisions.createdAt), asc(followUpPlanDraftRevisions.version))
			.limit(opts?.limit ?? 100);
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
	await Promise.all(
		result.map((plan) =>
			appendFollowUpPlanActivity(workspaceId, {
				followUpPlanId: plan.id,
				eventType: 'plan_paused',
				summary: 'Plan paused because the contact replied.',
				metadata: { reason: 'contact_replied' },
			}),
		),
	);
	return result;
}
