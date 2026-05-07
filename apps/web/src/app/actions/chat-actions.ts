'use server';

import { isRuntimeEnvEnabled } from '@/lib/runtime-env';
import { getInternalSecret, workspaceAction } from '@/lib/safe-action';
import { createCommitment, createDeal, createGoal, getContact, updateDeal } from '@repo/db';
import { z } from 'zod';

export const executeCommitmentAction = workspaceAction
	.schema(
		z.object({
			contactId: z.string().uuid(),
			title: z.string().min(1).max(500),
			commitmentType: z.enum(['promise', 'task', 'meeting', 'financial', 'follow_up']),
			assignee: z.enum(['user', 'contact']),
			dueDate: z
				.string()
				.regex(/^\d{4}-\d{2}-\d{2}$/)
				.nullable()
				.optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		if (!ctx.envelope) throw new Error('Workspace encryption key not found');
		const result = await createCommitment(
			ctx.workspaceId,
			{
				contactId: parsedInput.contactId,
				title: parsedInput.title,
				commitmentType:
					parsedInput.commitmentType === 'follow_up' ? 'task' : parsedInput.commitmentType,
				assignee: parsedInput.assignee,
				confidence: 1.0, // User-confirmed via chat
				dueDate: parsedInput.dueDate ? new Date(parsedInput.dueDate) : undefined,
			},
			ctx.envelope,
		);
		return { id: result?.id ?? '', title: result?.title ?? parsedInput.title };
	});

export const executeDealCreateAction = workspaceAction
	.schema(
		z.object({
			contactId: z.string().uuid(),
			title: z.string().min(1).max(500),
			dealType: z.enum(['investment', 'advisory', 'partnership', 'token', 'other']),
			value: z.number().optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		if (!ctx.envelope) throw new Error('Workspace encryption key not found');
		await createDeal(
			ctx.workspaceId,
			{
				contactId: parsedInput.contactId,
				title: parsedInput.title,
				dealType: parsedInput.dealType,
				value: parsedInput.value ? Math.round(parsedInput.value * 100) : 0,
				source: 'manual',
			},
			ctx.envelope,
		);
		return { success: true };
	});

export const executeGoalCreateAction = workspaceAction
	.schema(
		z.object({
			type: z.enum(['relationship', 'business', 'habit', 'network']),
			title: z.string().min(1).max(500),
			targetCount: z.number().int().positive(),
			targetDate: z.string().optional(),
			contactId: z.string().uuid().optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		await createGoal(
			ctx.workspaceId,
			{
				type: parsedInput.type,
				title: parsedInput.title,
				targetCount: parsedInput.targetCount,
				targetDate: parsedInput.targetDate ? new Date(parsedInput.targetDate) : undefined,
				contactId: parsedInput.contactId,
			},
			ctx.envelope,
		);
		return { success: true };
	});

export const executeDealStageAction = workspaceAction
	.schema(
		z.object({
			dealId: z.string().uuid(),
			newStage: z.enum(['discovery', 'diligence', 'negotiation', 'committed', 'won', 'lost']),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		if (!ctx.envelope) throw new Error('Workspace encryption key not found');
		await updateDeal(
			ctx.workspaceId,
			parsedInput.dealId,
			{ stage: parsedInput.newStage },
			ctx.envelope,
		);
		return { success: true };
	});

export const executeTelegramSendAction = workspaceAction
	.schema(
		z.object({
			contactId: z.string().uuid(),
			draftText: z.string().min(1).max(4096),
			contactName: z.string().min(1),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		if (!isRuntimeEnvEnabled('TELEGRAM_SEND_ENABLED')) {
			throw new Error('Telegram sending is disabled on this deployment');
		}

		if (!ctx.envelope) throw new Error('Workspace encryption key not found');

		const contact = await getContact(ctx.workspaceId, parsedInput.contactId, ctx.envelope);
		if (!contact) throw new Error('Not found');
		if (!contact.telegramId) throw new Error('Contact has no Telegram ID');

		const workerUrl = process.env.WORKER_URL;
		if (!workerUrl) throw new Error('WORKER_URL not configured');

		const res = await fetch(`${workerUrl}/telegram/send-message`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': getInternalSecret(),
			},
			body: JSON.stringify({
				userId: ctx.session.user.id,
				workspaceId: ctx.workspaceId,
				contactId: parsedInput.contactId,
				contactTelegramId: contact.telegramId,
				text: parsedInput.draftText,
				idempotencyKey: crypto.randomUUID(),
			}),
		});

		if (!res.ok) {
			const err = await res.json().catch(() => ({ error: 'Send failed' }));
			throw new Error(err.error ?? 'Send failed');
		}

		// SEC-SEND-300: Audit trail for Telegram sends (fire-and-forget, no PII in metadata)
		const { appendAuditLog } = await import('@repo/db');
		appendAuditLog({
			workspaceId: ctx.workspaceId,
			actorType: 'user',
			actorId: ctx.session.user.id,
			action: 'send',
			resourceType: 'message',
			resourceId: parsedInput.contactId,
			metadata: { channel: 'telegram', contactName: parsedInput.contactName },
		});

		return { success: true, contactName: parsedInput.contactName };
	});
