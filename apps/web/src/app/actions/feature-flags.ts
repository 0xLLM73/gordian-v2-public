'use server';

import {
	deleteFeatureFlag as dalDelete,
	listFeatureFlags as dalList,
	setFeatureFlag as dalSet,
} from '@repo/db';
import { z } from 'zod';
import { workspaceAction } from '@/lib/safe-action';
import { assertWorkspaceOwner } from '@/lib/workspace-authz';

export const listFeatureFlagsAction = workspaceAction
	.schema(z.object({}))
	.action(async ({ ctx }) => {
		await assertWorkspaceOwner(ctx.workspaceId, ctx.session.user.id);
		return dalList(ctx.workspaceId);
	});

export const toggleFeatureFlagAction = workspaceAction
	.schema(
		z.object({
			key: z.string().min(1).max(200),
			enabled: z.boolean(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		await assertWorkspaceOwner(ctx.workspaceId, ctx.session.user.id);
		await dalSet(parsedInput.key, parsedInput.enabled, ctx.workspaceId, ctx.session.user.id);
		return { success: true };
	});

export const deleteFeatureFlagAction = workspaceAction
	.schema(
		z.object({
			key: z.string().min(1).max(200),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		await assertWorkspaceOwner(ctx.workspaceId, ctx.session.user.id);
		await dalDelete(parsedInput.key, ctx.workspaceId);
		return { success: true };
	});
