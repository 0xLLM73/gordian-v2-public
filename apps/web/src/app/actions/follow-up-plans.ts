'use server';

import { workspaceAction } from '@/lib/safe-action';
import {
	FOLLOW_UP_PLAN_TEMPLATES,
	activateFollowUpPlan as dalActivate,
	approveStep as dalApproveStep,
	cancelFollowUpPlan as dalCancel,
	createFollowUpPlan as dalCreate,
	editAndApproveStep as dalEditAndApproveStep,
	getFollowUpPlan as dalGet,
	getFollowUpPlanSteps as dalGetSteps,
	listFollowUpPlans as dalList,
	pauseFollowUpPlan as dalPause,
	rejectStep as dalRejectStep,
	resumeFollowUpPlan as dalResume,
} from '@repo/db';
import { z } from 'zod';

export const listFollowUpPlansAction = workspaceAction
	.schema(
		z.object({
			status: z.enum(['draft', 'active', 'paused', 'completed', 'cancelled']).optional(),
			contactId: z.string().uuid().optional(),
			limit: z.number().int().positive().optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		return dalList(ctx.workspaceId, parsedInput, ctx.envelope);
	});

export const getFollowUpPlanAction = workspaceAction
	.schema(z.object({ followUpPlanId: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		return dalGet(ctx.workspaceId, parsedInput.followUpPlanId, ctx.envelope);
	});

export const getFollowUpPlanStepsAction = workspaceAction
	.schema(z.object({ followUpPlanId: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		return dalGetSteps(ctx.workspaceId, parsedInput.followUpPlanId, ctx.envelope);
	});

export const createFollowUpPlanAction = workspaceAction
	.schema(
		z.object({
			contactId: z.string().uuid(),
			title: z.string().min(1).max(200),
			templateId: z.string().optional(),
			steps: z
				.array(
					z.object({
						prompt: z.string().min(1).max(2000),
						delayHours: z.number().int().nonnegative(),
					}),
				)
				.min(1)
				.max(20),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		return dalCreate(ctx.workspaceId, parsedInput, ctx.envelope);
	});

export const activateFollowUpPlanAction = workspaceAction
	.schema(z.object({ followUpPlanId: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		return dalActivate(ctx.workspaceId, parsedInput.followUpPlanId);
	});

export const pauseFollowUpPlanAction = workspaceAction
	.schema(z.object({ followUpPlanId: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		return dalPause(ctx.workspaceId, parsedInput.followUpPlanId);
	});

export const resumeFollowUpPlanAction = workspaceAction
	.schema(z.object({ followUpPlanId: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		return dalResume(ctx.workspaceId, parsedInput.followUpPlanId);
	});

export const cancelFollowUpPlanAction = workspaceAction
	.schema(z.object({ followUpPlanId: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		return dalCancel(ctx.workspaceId, parsedInput.followUpPlanId);
	});

export const getFollowUpPlanTemplatesAction = workspaceAction
	.schema(z.object({}))
	.action(async () => {
		return FOLLOW_UP_PLAN_TEMPLATES;
	});

export const approveFollowUpPlanStepAction = workspaceAction
	.schema(z.object({ stepId: z.string().uuid(), followUpPlanId: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		return dalApproveStep(ctx.workspaceId, parsedInput.stepId, ctx.envelope);
	});

export const editAndApproveFollowUpPlanStepAction = workspaceAction
	.schema(
		z.object({
			stepId: z.string().uuid(),
			followUpPlanId: z.string().uuid(),
			editedText: z.string().min(1).max(5000),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		return dalEditAndApproveStep(
			ctx.workspaceId,
			parsedInput.stepId,
			parsedInput.editedText,
			ctx.envelope,
		);
	});

export const rejectFollowUpPlanStepAction = workspaceAction
	.schema(z.object({ stepId: z.string().uuid(), followUpPlanId: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		return dalRejectStep(ctx.workspaceId, parsedInput.stepId, ctx.envelope);
	});
