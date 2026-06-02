'use server';

import { workspaceAction } from '@/lib/safe-action';
import {
	createGoal as dalCreate,
	listGoals as dalList,
	updateGoalProgress as dalProgress,
	updateGoalStatus as dalStatus,
} from '@repo/db';
import { z } from 'zod';

export const createGoalAction = workspaceAction
	.schema(
		z.object({
			type: z.enum(['relationship', 'business', 'habit', 'network', 'strategic']),
			title: z.string().trim().min(1).max(200),
			description: z.string().trim().max(1000).optional(),
			targetCount: z.number().int().positive(),
			contactId: z.string().uuid().optional(),
			targetDate: z.string().datetime().optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		return dalCreate(
			ctx.workspaceId,
			{
				type: parsedInput.type,
				title: parsedInput.title,
				description: parsedInput.description || undefined,
				targetCount: parsedInput.targetCount,
				contactId: parsedInput.contactId,
				targetDate: parsedInput.targetDate ? new Date(parsedInput.targetDate) : undefined,
			},
			ctx.envelope,
		);
	});

export const listGoalsAction = workspaceAction
	.schema(
		z.object({
			status: z.string().optional(),
			type: z.string().optional(),
			sort: z.string().optional(),
			limit: z.number().int().positive().optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		return dalList(
			ctx.workspaceId,
			{
				status: parsedInput.status,
				type: parsedInput.type,
				sort: parsedInput.sort,
				limit: parsedInput.limit,
			},
			ctx.envelope,
		);
	});

export const updateGoalProgressAction = workspaceAction
	.schema(
		z.object({
			goalId: z.string().uuid(),
			increment: z.number().int().positive().default(1),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		return dalProgress(ctx.workspaceId, parsedInput.goalId, parsedInput.increment, 'manual');
	});

export const updateGoalStatusAction = workspaceAction
	.schema(
		z.object({
			goalId: z.string().uuid(),
			status: z.enum(['paused', 'active', 'abandoned']),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		return dalStatus(ctx.workspaceId, parsedInput.goalId, parsedInput.status);
	});

export const updateGoalAction = workspaceAction
	.schema(
		z.object({
			goalId: z.string().uuid(),
			title: z.string().trim().min(1).max(200).optional(),
			description: z.string().trim().max(1000).nullable().optional(),
			type: z.enum(['relationship', 'business', 'habit', 'network', 'strategic']).optional(),
			targetCount: z.number().int().positive().optional(),
			targetDate: z.string().datetime().nullable().optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const { updateGoal } = await import('@repo/db');
		return updateGoal(
			ctx.workspaceId,
			parsedInput.goalId,
			{
				title: parsedInput.title,
				description:
					parsedInput.description || parsedInput.description === null
						? parsedInput.description
						: undefined,
				type: parsedInput.type,
				targetCount: parsedInput.targetCount,
				targetDate:
					parsedInput.targetDate === null
						? null
						: parsedInput.targetDate
							? new Date(parsedInput.targetDate)
							: undefined,
			},
			ctx.envelope,
		);
	});

export const listGoalProgressAction = workspaceAction
	.schema(
		z.object({
			goalId: z.string().uuid(),
			limit: z.number().int().positive().optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const { listGoalProgressEvents } = await import('@repo/db');
		return listGoalProgressEvents(ctx.workspaceId, parsedInput.goalId, {
			limit: parsedInput.limit,
		});
	});

export const deleteGoalAction = workspaceAction
	.schema(z.object({ goalId: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		const { deleteGoal } = await import('@repo/db');
		return deleteGoal(ctx.workspaceId, parsedInput.goalId);
	});

export const listGoalActionsAction = workspaceAction
	.schema(
		z.object({
			goalId: z.string().uuid(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const { listGoalActions } = await import('@repo/db');
		return listGoalActions(ctx.workspaceId, parsedInput.goalId, ctx.envelope);
	});

export const completeGoalActionAction = workspaceAction
	.schema(
		z.object({
			actionId: z.string().uuid(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const { completeGoalAction } = await import('@repo/db');
		return completeGoalAction(ctx.workspaceId, parsedInput.actionId);
	});

export const skipGoalActionAction = workspaceAction
	.schema(
		z.object({
			actionId: z.string().uuid(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const { updateGoalAction } = await import('@repo/db');
		return updateGoalAction(
			ctx.workspaceId,
			parsedInput.actionId,
			{ status: 'skipped' },
			ctx.envelope,
		);
	});

export const getGoalAnalyticsAction = workspaceAction
	.schema(z.object({}))
	.action(async ({ ctx }) => {
		const { getGoalAnalytics } = await import('@repo/db');
		return getGoalAnalytics(ctx.workspaceId, ctx.envelope);
	});
