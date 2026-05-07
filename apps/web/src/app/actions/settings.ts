'use server';

import { getInternalSecret, workspaceAction } from '@/lib/safe-action';
import { accounts, and, db, deleteAccountData, eq, upsertPreferences } from '@repo/db';
import { z } from 'zod';

const BRIEF_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/**
 * Update morning brief schedule (time, timezone, days).
 * CRITICAL: Uses workspaceAction — workspaceId is never accepted from client.
 */
export const updateBriefScheduleAction = workspaceAction
	.schema(
		z.object({
			briefTime: z.number().int().min(0).max(23),
			timezone: z.string().min(1),
			briefDays: z.array(z.enum(BRIEF_DAYS)).min(1),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const { workspaceId } = ctx;
		const userId = ctx.session.user.id;
		await upsertPreferences(workspaceId, userId, {
			briefTime: parsedInput.briefTime,
			timezone: parsedInput.timezone,
			briefDays: parsedInput.briefDays,
		});

		// Reschedule morning brief with new preferences
		const workerUrl = process.env.WORKER_URL;
		if (!workerUrl) throw new Error('WORKER_URL is not configured');

		const response = await fetch(`${workerUrl}/brief/reschedule`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': getInternalSecret(),
			},
			body: JSON.stringify({ userId, workspaceId }),
		});

		if (!response.ok) {
			throw new Error('Failed to reschedule morning brief');
		}

		return { success: true };
	});

/**
 * Disconnect Telegram: kills the GramJS session via the worker, then removes
 * the account link from the database.
 * CRITICAL: Uses workspaceAction — workspaceId is never accepted from client.
 */
export const disconnectTelegramAction = workspaceAction
	.schema(z.object({}))
	.action(async ({ ctx }) => {
		const workerUrl = process.env.WORKER_URL;
		if (!workerUrl) throw new Error('WORKER_URL is not configured');

		const response = await fetch(`${workerUrl}/telegram/disconnect-session`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': getInternalSecret(),
			},
			body: JSON.stringify({ userId: ctx.session.user.id }),
		});

		if (!response.ok) {
			throw new Error('Failed to disconnect Telegram session');
		}

		await db
			.delete(accounts)
			.where(and(eq(accounts.userId, ctx.session.user.id), eq(accounts.providerId, 'telegram')));

		return { disconnected: true };
	});

/**
 * Update notification preferences (enabled toggle).
 * CRITICAL: Uses workspaceAction — workspaceId is never accepted from client.
 */
export const updateNotificationsAction = workspaceAction
	.schema(
		z.object({
			briefEnabled: z.boolean(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const { workspaceId } = ctx;
		const userId = ctx.session.user.id;
		await upsertPreferences(workspaceId, userId, {
			briefEnabled: parsedInput.briefEnabled,
		});
		return { success: true };
	});

/**
 * Permanently delete a user's account and all workspace data.
 * 1. Disconnect Telegram session (external, best-effort)
 * 2. Cascade-delete all workspace data + user in a single transaction
 * CRITICAL: Uses workspaceAction — ownership verified via session, never client input.
 */
export const deleteAccountAction = workspaceAction
	.schema(
		z.object({
			confirmation: z.literal('DELETE'),
		}),
	)
	.action(async ({ ctx }) => {
		const { workspaceId } = ctx;
		const userId = ctx.session.user.id;

		// Step 1: Disconnect Telegram session (best-effort, don't block deletion)
		const workerUrl = process.env.WORKER_URL;
		if (workerUrl) {
			try {
				await fetch(`${workerUrl}/telegram/disconnect-session`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'X-Internal-Secret': getInternalSecret(),
					},
					body: JSON.stringify({ userId }),
				});
			} catch {
				// Non-blocking — Telegram session cleanup is best-effort
			}
		}

		// Step 2: Cascade delete all data in a single transaction
		await deleteAccountData(workspaceId, userId);

		return { deleted: true };
	});
