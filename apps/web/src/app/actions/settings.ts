'use server';

import { deleteSessionKek } from '@repo/crypto';
import {
	accounts,
	and,
	db,
	deleteAccountData,
	deleteUserAccountOnly,
	eq,
	upsertPreferences,
} from '@repo/db';
import { z } from 'zod';
import { getInternalSecret, workspaceAction } from '@/lib/safe-action';
import { isWorkspaceOwner } from '@/lib/workspace-authz';

const BRIEF_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

async function deleteTelegramSessionKeks(userId: string): Promise<void> {
	const telegramAccounts = await db
		.select({ sessionKekEncrypted: accounts.sessionKekEncrypted })
		.from(accounts)
		.where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'telegram')));

	for (const account of telegramAccounts) {
		await deleteSessionKek(userId, account.sessionKekEncrypted);
	}
}

async function cleanupRuntimeStateForDeletion(
	workerUrl: string | undefined,
	userId: string,
	workspaceId: string,
): Promise<void> {
	if (!workerUrl) return;

	try {
		await fetch(`${workerUrl}/runtime/cleanup-deletion`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': getInternalSecret(),
			},
			body: JSON.stringify({ userId, workspaceId }),
		});
	} catch {
		// Non-blocking — DB deletion remains authoritative.
	}
}

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

		await deleteTelegramSessionKeks(ctx.session.user.id);

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
 * Permanently delete only the authenticated user's account.
 * 1. Disconnect Telegram session (external, best-effort)
 * 2. Delete local Telegram session key material
 * 3. Remove user memberships and user auth rows
 * Workspace owners must use deleteWorkspaceAction so account deletion cannot
 * accidentally wipe a shared workspace.
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

		if (await isWorkspaceOwner(workspaceId, userId)) {
			throw new Error(
				'Workspace owners must delete the workspace explicitly before deleting their user account',
			);
		}

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

		await cleanupRuntimeStateForDeletion(workerUrl, userId, workspaceId);
		await deleteTelegramSessionKeks(userId);

		await deleteUserAccountOnly(userId);

		return { deleted: true };
	});

/**
 * Permanently delete the current workspace and the owner's user account.
 * This action is intentionally separate from "delete my account" and requires
 * owner authorization inside the server action.
 */
export const deleteWorkspaceAction = workspaceAction
	.schema(
		z.object({
			confirmation: z.literal('DELETE WORKSPACE'),
		}),
	)
	.action(async ({ ctx }) => {
		const { workspaceId } = ctx;
		const userId = ctx.session.user.id;

		if (!(await isWorkspaceOwner(workspaceId, userId))) {
			throw new Error('Unauthorized');
		}

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

		await cleanupRuntimeStateForDeletion(workerUrl, userId, workspaceId);
		await deleteTelegramSessionKeks(userId);
		await deleteAccountData(workspaceId, userId);

		return { deleted: true };
	});
