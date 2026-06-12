'use server';

import {
	listConnections as dalList,
	updateConnection as dalUpdate,
	updateConnectionStatus as dalUpdateStatus,
} from '@repo/db';
import { z } from 'zod';
import { getInternalSecret, workspaceAction } from '@/lib/safe-action';

const connectionPeriodUnitSchema = z.enum(['days', 'weeks', 'months']);

type ConnectionReprocessWorkerResponse =
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

function periodToDays(value: number, unit: z.infer<typeof connectionPeriodUnitSchema>) {
	const multiplier = unit === 'months' ? 30 : unit === 'weeks' ? 7 : 1;
	return Math.min(value * multiplier, 3650);
}

function isConnectionReprocessWorkerResponse(
	value: unknown,
): value is ConnectionReprocessWorkerResponse {
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

async function callConnectionReprocessWorker(
	body: Record<string, unknown>,
): Promise<ConnectionReprocessWorkerResponse> {
	const workerUrl = process.env.WORKER_URL;
	if (!workerUrl) throw new Error('WORKER_URL is not configured');

	const response = await fetch(`${workerUrl}/admin/reprocess-connections`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Internal-Secret': getInternalSecret(),
		},
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		throw new Error('Failed to find connections');
	}

	const payload = (await response.json()) as unknown;
	if (!isConnectionReprocessWorkerResponse(payload)) {
		throw new Error('Failed to find connections');
	}
	return payload;
}

export const listConnectionsAction = workspaceAction
	.schema(
		z.object({
			status: z.string().optional(),
			event: z.string().optional(),
			limit: z.number().int().positive().optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		return dalList(
			ctx.workspaceId,
			{
				status: parsedInput.status,
				event: parsedInput.event,
				limit: parsedInput.limit,
			},
			ctx.envelope,
		);
	});

export const findConnectionsForPeriodAction = workspaceAction
	.schema(
		z.object({
			periodValue: z.number().int().min(1).max(365),
			periodUnit: connectionPeriodUnitSchema.default('days'),
			batchSize: z.number().int().min(1).max(200).default(200),
			contactLimit: z.number().int().min(1).max(100).default(100),
			confirmToken: z.string().min(1).optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const maxAgeDays = periodToDays(parsedInput.periodValue, parsedInput.periodUnit);
		const isConfirm = Boolean(parsedInput.confirmToken);
		const result = await callConnectionReprocessWorker({
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

export const updateConnectionStatusAction = workspaceAction
	.schema(
		z.object({
			connectionId: z.string().uuid(),
			status: z.enum(['confirmed', 'dismissed']),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		return dalUpdateStatus(ctx.workspaceId, parsedInput.connectionId, parsedInput.status);
	});

export const updateConnectionAction = workspaceAction
	.schema(
		z.object({
			connectionId: z.string().uuid(),
			event: z.string().max(200).nullable().optional(),
			context: z.string().max(2000).nullable().optional(),
			note: z.string().max(2000).nullable().optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		return dalUpdate(
			ctx.workspaceId,
			parsedInput.connectionId,
			{
				event: parsedInput.event,
				context: parsedInput.context,
				note: parsedInput.note,
			},
			ctx.envelope,
		);
	});
