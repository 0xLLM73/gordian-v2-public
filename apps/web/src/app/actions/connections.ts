'use server';

import { workspaceAction } from '@/lib/safe-action';
import {
	listConnections as dalList,
	updateConnection as dalUpdate,
	updateConnectionStatus as dalUpdateStatus,
} from '@repo/db';
import { z } from 'zod';

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
