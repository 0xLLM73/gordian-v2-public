'use server';

import { getInternalSecret, workspaceAction } from '@/lib/safe-action';
import {
	listIntroductions as dalList,
	updateIntroductionStatus as dalUpdateStatus,
} from '@repo/db';
import { z } from 'zod';

const introStatusSchema = z.enum(['triage', 'active', 'archive']);
const introResolutionSchema = z.enum(['completed', 'dismissed']);
const introductionPeriodUnitSchema = z.enum(['days', 'weeks', 'months']);
const updateIntroStatusInputSchema = z
	.object({
		introductionId: z.string().uuid(),
		status: introStatusSchema,
		resolution: introResolutionSchema.optional(),
	})
	.refine((input) => input.status === 'archive' || !input.resolution, {
		path: ['resolution'],
		message: 'Resolution only applies when archiving.',
	});

type IntroductionReprocessWorkerResponse =
	| {
			status: 'dry_run';
			workspaceId?: string;
			chatLimit: number;
			batchSize: number;
			wouldProcessChats: number;
			wouldProcessMessages: number;
			maxAgeDays?: number;
			confirmToken: string;
	  }
	| {
			status: 'queued';
			chatsProcessed: number;
			messagesQueued: number;
			maxAgeDays?: number;
	  };

type RelationshipScanStatus = {
	active: number;
	waiting: number;
	delayed: number;
	retainedFailed: number;
	resolvedFailed: number;
	failed: number;
	total: number;
	introductionJobs: number;
	connectionJobs: number;
	unknownJobs: number;
	progressReports: number;
	diagnostics: {
		messagesInBatch: number;
		freshSourceMessages: number;
		relationshipModelCalls: number;
		introductionKeywordMatches: number;
		introductionModelCalls: number;
		introductionRejected: number;
		connectionKeywordMatches: number;
		connectionModelCalls: number;
		connectionRejected: number;
	};
	oldestJobAt: string | null;
	newestJobAt: string | null;
	sampledAt: string;
};

type RelationshipScanCleanupResult = {
	scanned: number;
	removed: number;
	retained: number;
	sampledAt: string;
};

function periodToDays(value: number, unit: z.infer<typeof introductionPeriodUnitSchema>) {
	const multiplier = unit === 'months' ? 30 : unit === 'weeks' ? 7 : 1;
	return Math.min(value * multiplier, 3650);
}

function isIntroductionReprocessWorkerResponse(
	value: unknown,
): value is IntroductionReprocessWorkerResponse {
	if (!value || typeof value !== 'object') return false;
	const record = value as Record<string, unknown>;
	if (record.status === 'dry_run') {
		return (
			typeof record.chatLimit === 'number' &&
			typeof record.batchSize === 'number' &&
			typeof record.wouldProcessChats === 'number' &&
			typeof record.wouldProcessMessages === 'number' &&
			typeof record.confirmToken === 'string'
		);
	}
	if (record.status === 'queued') {
		return typeof record.chatsProcessed === 'number' && typeof record.messagesQueued === 'number';
	}
	return false;
}

function isRelationshipScanStatus(value: unknown): value is RelationshipScanStatus {
	if (!value || typeof value !== 'object') return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.active === 'number' &&
		typeof record.waiting === 'number' &&
		typeof record.delayed === 'number' &&
		typeof record.retainedFailed === 'number' &&
		typeof record.resolvedFailed === 'number' &&
		typeof record.failed === 'number' &&
		typeof record.total === 'number' &&
		typeof record.introductionJobs === 'number' &&
		typeof record.connectionJobs === 'number' &&
		typeof record.unknownJobs === 'number' &&
		typeof record.progressReports === 'number' &&
		Boolean(record.diagnostics) &&
		typeof record.diagnostics === 'object' &&
		typeof (record.diagnostics as Record<string, unknown>).messagesInBatch === 'number' &&
		typeof (record.diagnostics as Record<string, unknown>).freshSourceMessages === 'number' &&
		typeof (record.diagnostics as Record<string, unknown>).relationshipModelCalls === 'number' &&
		typeof (record.diagnostics as Record<string, unknown>).introductionKeywordMatches ===
			'number' &&
		typeof (record.diagnostics as Record<string, unknown>).introductionModelCalls === 'number' &&
		typeof (record.diagnostics as Record<string, unknown>).introductionRejected === 'number' &&
		typeof (record.diagnostics as Record<string, unknown>).connectionKeywordMatches === 'number' &&
		typeof (record.diagnostics as Record<string, unknown>).connectionModelCalls === 'number' &&
		typeof (record.diagnostics as Record<string, unknown>).connectionRejected === 'number' &&
		(typeof record.oldestJobAt === 'string' || record.oldestJobAt === null) &&
		(typeof record.newestJobAt === 'string' || record.newestJobAt === null) &&
		typeof record.sampledAt === 'string'
	);
}

function isRelationshipScanCleanupResult(value: unknown): value is RelationshipScanCleanupResult {
	if (!value || typeof value !== 'object') return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.scanned === 'number' &&
		typeof record.removed === 'number' &&
		typeof record.retained === 'number' &&
		typeof record.sampledAt === 'string'
	);
}

async function callIntroductionReprocessWorker(
	body: Record<string, unknown>,
): Promise<IntroductionReprocessWorkerResponse> {
	const workerUrl = process.env.WORKER_URL;
	if (!workerUrl) throw new Error('WORKER_URL is not configured');

	const response = await fetch(`${workerUrl}/admin/reprocess-introductions`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Internal-Secret': getInternalSecret(),
		},
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		throw new Error('Failed to find introductions');
	}

	const payload = (await response.json()) as unknown;
	if (!isIntroductionReprocessWorkerResponse(payload)) {
		throw new Error('Failed to find introductions');
	}
	return payload;
}

async function callRelationshipScanStatusWorker(input: {
	workspaceId: string;
	userId: string;
}): Promise<RelationshipScanStatus> {
	const workerUrl = process.env.WORKER_URL;
	if (!workerUrl) throw new Error('WORKER_URL is not configured');

	const params = new URLSearchParams({
		workspaceId: input.workspaceId,
		userId: input.userId,
	});
	const response = await fetch(`${workerUrl}/admin/relationship-extraction-status?${params}`, {
		headers: {
			'X-Internal-Secret': getInternalSecret(),
		},
	});

	if (!response.ok) {
		throw new Error('Failed to load scan status');
	}

	const payload = (await response.json()) as unknown;
	if (!isRelationshipScanStatus(payload)) {
		throw new Error('Failed to load scan status');
	}
	return payload;
}

async function callRelationshipScanCleanupWorker(input: {
	workspaceId: string;
	userId: string;
}): Promise<RelationshipScanCleanupResult> {
	const workerUrl = process.env.WORKER_URL;
	if (!workerUrl) throw new Error('WORKER_URL is not configured');

	const response = await fetch(`${workerUrl}/admin/relationship-extraction-cleanup`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Internal-Secret': getInternalSecret(),
		},
		body: JSON.stringify({
			workspaceId: input.workspaceId,
			userId: input.userId,
		}),
	});

	if (!response.ok) {
		throw new Error('Failed to clean up resolved scan failures');
	}

	const payload = (await response.json()) as unknown;
	if (!isRelationshipScanCleanupResult(payload)) {
		throw new Error('Failed to clean up resolved scan failures');
	}
	return payload;
}

export const listIntroductionsAction = workspaceAction
	.schema(
		z.object({
			status: introStatusSchema.optional(),
			limit: z.number().int().positive().max(100).optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		return dalList(
			ctx.workspaceId,
			{
				status: parsedInput.status,
				limit: parsedInput.limit,
			},
			ctx.envelope,
		);
	});

export const getRelationshipScanStatusAction = workspaceAction
	.schema(z.object({}))
	.action(async ({ ctx }) => {
		return callRelationshipScanStatusWorker({
			workspaceId: ctx.workspaceId,
			userId: ctx.session.user.id,
		});
	});

export const cleanupRelationshipScanFailuresAction = workspaceAction
	.schema(z.object({}))
	.action(async ({ ctx }) => {
		return callRelationshipScanCleanupWorker({
			workspaceId: ctx.workspaceId,
			userId: ctx.session.user.id,
		});
	});

export const findIntroductionsForPeriodAction = workspaceAction
	.schema(
		z.object({
			periodValue: z.number().int().min(1).max(365),
			periodUnit: introductionPeriodUnitSchema.default('days'),
			batchSize: z.number().int().min(1).max(200).default(200),
			chatLimit: z.number().int().min(1).max(100).default(100),
			confirmToken: z.string().min(1).optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const maxAgeDays = periodToDays(parsedInput.periodValue, parsedInput.periodUnit);
		const isConfirm = Boolean(parsedInput.confirmToken);
		const result = await callIntroductionReprocessWorker({
			workspaceId: ctx.workspaceId,
			userId: ctx.session.user.id,
			batchSize: parsedInput.batchSize,
			chatLimit: parsedInput.chatLimit,
			maxAgeDays,
			dryRun: !isConfirm,
			confirm: isConfirm,
			confirmToken: parsedInput.confirmToken,
		});

		if (result.status === 'dry_run') {
			return {
				status: result.status,
				batchSize: result.batchSize,
				chatLimit: result.chatLimit,
				wouldProcessChats: result.wouldProcessChats,
				wouldProcessMessages: result.wouldProcessMessages,
				maxAgeDays: result.maxAgeDays ?? maxAgeDays,
				periodValue: parsedInput.periodValue,
				periodUnit: parsedInput.periodUnit,
				confirmToken: result.confirmToken,
			};
		}

		return {
			status: result.status,
			chatsProcessed: result.chatsProcessed,
			messagesQueued: result.messagesQueued,
			maxAgeDays: result.maxAgeDays ?? maxAgeDays,
			periodValue: parsedInput.periodValue,
			periodUnit: parsedInput.periodUnit,
		};
	});

export const createIntroductionAction = workspaceAction
	.schema(
		z.object({
			introducerContactId: z.string().uuid(),
			introducedContactId1: z.string().uuid(),
			introducedContactId2: z.string().uuid(),
			context: z.enum(['deal', 'hiring', 'knowledge', 'social', 'other']).optional(),
			note: z.string().max(2000).optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const { createIntroduction } = await import('@repo/db');
		const result = await createIntroduction(
			ctx.workspaceId,
			{
				...parsedInput,
				confidence: 1.0,
			},
			ctx.envelope,
		);

		// DPG Phase 2: Extract rationale from message context (fire-and-forget)
		if (result?.id && ctx.envelope) {
			const { fireRationaleExtraction } = await import('@/lib/rationale-hook');
			fireRationaleExtraction({
				action: 'intro_created',
				label: 'Introduction created', // SEC-PROV-009: structural only
				entityId: result.id,
				entityType: 'introduction',
				contactId: parsedInput.introducerContactId,
				workspaceId: ctx.workspaceId,
				envelope: ctx.envelope,
			});
		}

		// Context Graph: Record decision event (fire-and-forget)
		if (result?.id && ctx.envelope) {
			const { fireDecisionRecording } = await import('@/lib/decision-hook');
			fireDecisionRecording({
				userId: ctx.session.user.id,
				workspaceId: ctx.workspaceId,
				decisionType: 'commitment',
				label: 'introduction-created', // SEC-PROV-009: structural only
				entityId: result.id,
				envelope: ctx.envelope,
			});
		}

		return result;
	});

export const updateIntroductionAction = workspaceAction
	.schema(
		z.object({
			introductionId: z.string().uuid(),
			context: z.enum(['deal', 'hiring', 'knowledge', 'social', 'other']).optional(),
			note: z.string().max(2000).nullable().optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const { updateIntroduction } = await import('@repo/db');
		return updateIntroduction(
			ctx.workspaceId,
			parsedInput.introductionId,
			{
				context: parsedInput.context,
				note: parsedInput.note,
			},
			ctx.envelope,
		);
	});

export const updateIntroStatusAction = workspaceAction
	.schema(updateIntroStatusInputSchema)
	.action(async ({ parsedInput, ctx }) => {
		const updated = await dalUpdateStatus(
			ctx.workspaceId,
			parsedInput.introductionId,
			parsedInput.status,
			parsedInput.resolution ? { resolution: parsedInput.resolution } : undefined,
		);
		if (!updated) throw new Error('Invalid input');
		return updated;
	});
