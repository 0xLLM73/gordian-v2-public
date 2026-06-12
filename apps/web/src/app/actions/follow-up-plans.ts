'use server';

import {
	activateFollowUpPlan as dalActivate,
	approveStep as dalApproveStep,
	cancelFollowUpPlan as dalCancel,
	createFollowUpPlan as dalCreate,
	createFollowUpPlanTemplate as dalCreateTemplate,
	createFollowUpPlanTemplateFromPlan as dalCreateTemplateFromPlan,
	createFollowUpPlanTemplateVersion as dalCreateTemplateVersion,
	editAndApproveStep as dalEditAndApproveStep,
	getFollowUpPlan as dalGet,
	getFollowUpPlanSteps as dalGetSteps,
	listFollowUpPlans as dalList,
	listFollowUpPlanTemplates as dalListTemplates,
	pauseFollowUpPlan as dalPause,
	recordFollowUpPlanStepCopied as dalRecordStepCopied,
	recordFollowUpPlanTelegramOpened as dalRecordTelegramOpened,
	requestFollowUpPlanStepRegeneration as dalRegenerateStep,
	rejectStep as dalRejectStep,
	rescheduleFollowUpPlanStep as dalRescheduleStep,
	resumeFollowUpPlan as dalResume,
} from '@repo/db';
import { z } from 'zod';
import { workspaceAction } from '@/lib/safe-action';

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
			templateVersion: z.number().int().positive().optional(),
			templateSource: z.string().max(100).optional(),
			config: z
				.object({
					objective: z.string().max(1000).optional(),
					tone: z.string().max(100).optional(),
					channel: z.string().max(100).optional(),
					aiMode: z.enum(['local_ai', 'template_only', 'reminder_only']).optional(),
					sendingMode: z.enum(['manual', 'assisted', 'reminder_only']).optional(),
					sourceGoalId: z.string().uuid().optional(),
				})
				.optional(),
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
		const { config, ...planInput } = parsedInput;
		const { objective, ...safeConfig } = config ?? {};
		return dalCreate(
			ctx.workspaceId,
			{
				...planInput,
				objective,
				config: safeConfig,
			},
			ctx.envelope,
		);
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
	.action(async ({ ctx }) => {
		return dalListTemplates(ctx.workspaceId, ctx.envelope);
	});

export const createFollowUpPlanTemplateAction = workspaceAction
	.schema(
		z.object({
			title: z.string().min(1).max(200),
			description: z.string().max(1000).optional(),
			category: z.string().max(100).optional(),
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
		return dalCreateTemplate(ctx.workspaceId, parsedInput, ctx.envelope);
	});

export const createFollowUpPlanTemplateVersionAction = workspaceAction
	.schema(
		z.object({
			templateId: z.string().min(1).max(200),
			title: z.string().min(1).max(200),
			description: z.string().max(1000).optional(),
			category: z.string().max(100).optional(),
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
		const { templateId, ...templateInput } = parsedInput;
		return dalCreateTemplateVersion(ctx.workspaceId, templateId, templateInput, ctx.envelope);
	});

export const createFollowUpPlanTemplateFromPlanAction = workspaceAction
	.schema(
		z.object({
			followUpPlanId: z.string().uuid(),
			title: z.string().min(1).max(200).optional(),
			description: z.string().max(1000).optional(),
			category: z.string().max(100).optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const { followUpPlanId, ...templateInput } = parsedInput;
		return dalCreateTemplateFromPlan(ctx.workspaceId, followUpPlanId, templateInput, ctx.envelope);
	});

export const approveFollowUpPlanStepAction = workspaceAction
	.schema(z.object({ stepId: z.string().uuid(), followUpPlanId: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		return dalApproveStep(
			ctx.workspaceId,
			parsedInput.followUpPlanId,
			parsedInput.stepId,
			ctx.envelope,
		);
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
			parsedInput.followUpPlanId,
			parsedInput.stepId,
			parsedInput.editedText,
			ctx.envelope,
		);
	});

export const rejectFollowUpPlanStepAction = workspaceAction
	.schema(
		z.object({
			stepId: z.string().uuid(),
			followUpPlanId: z.string().uuid(),
			skipReason: z.string().max(500).optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		if (parsedInput.skipReason?.trim()) {
			return dalRejectStep(
				ctx.workspaceId,
				parsedInput.followUpPlanId,
				parsedInput.stepId,
				ctx.envelope,
				parsedInput.skipReason,
			);
		}
		return dalRejectStep(
			ctx.workspaceId,
			parsedInput.followUpPlanId,
			parsedInput.stepId,
			ctx.envelope,
		);
	});

export const rescheduleFollowUpPlanStepAction = workspaceAction
	.schema(
		z.object({
			stepId: z.string().uuid(),
			followUpPlanId: z.string().uuid(),
			scheduledAt: z.string().datetime(),
			reason: z.string().max(500).optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		return dalRescheduleStep(ctx.workspaceId, parsedInput.followUpPlanId, parsedInput.stepId, {
			scheduledAt: new Date(parsedInput.scheduledAt),
			reason: parsedInput.reason,
		});
	});

export const regenerateFollowUpPlanStepAction = workspaceAction
	.schema(z.object({ stepId: z.string().uuid(), followUpPlanId: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		return dalRegenerateStep(ctx.workspaceId, parsedInput.followUpPlanId, parsedInput.stepId);
	});

export const recordFollowUpPlanStepCopyAction = workspaceAction
	.schema(z.object({ stepId: z.string().uuid(), followUpPlanId: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		return dalRecordStepCopied(ctx.workspaceId, parsedInput.followUpPlanId, parsedInput.stepId);
	});

export const recordFollowUpPlanTelegramOpenAction = workspaceAction
	.schema(z.object({ stepId: z.string().uuid(), followUpPlanId: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		return dalRecordTelegramOpened(ctx.workspaceId, parsedInput.followUpPlanId, parsedInput.stepId);
	});
