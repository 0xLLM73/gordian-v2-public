'use server';

import { workspaceAction } from '@/lib/safe-action';
import { getAuditTrail, queryAuditLogs } from '@repo/db';
import { z } from 'zod';

const auditLogQuerySchema = z.object({
	actorType: z.enum(['user', 'system', 'ai']).optional(),
	action: z
		.enum(['create', 'update', 'delete', 'login', 'sync', 'generate', 'evaluate'])
		.optional(),
	resourceType: z
		.enum([
			'contact',
			'commitment',
			'deal',
			'introduction',
			'goal',
			'summary',
			'digest',
			'brief',
			'cadence',
			'calendar',
			'feature_flag',
			'preference',
			'decision',
		])
		.optional(),
	resourceId: z.string().uuid().optional(),
	correlationId: z.string().uuid().optional(),
	since: z.string().datetime().optional(),
	until: z.string().datetime().optional(),
	limit: z.number().int().min(1).max(100).default(50),
	offset: z.number().int().min(0).default(0),
});

export const getAuditLogsAction = workspaceAction
	.schema(auditLogQuerySchema)
	.action(async ({ parsedInput, ctx }) => {
		return queryAuditLogs(ctx.workspaceId, parsedInput);
	});

export const getResourceAuditTrailAction = workspaceAction
	.schema(
		z.object({
			resourceType: z.enum([
				'contact',
				'commitment',
				'deal',
				'introduction',
				'goal',
				'summary',
				'digest',
				'brief',
				'cadence',
				'calendar',
				'feature_flag',
				'preference',
				'decision',
			]),
			resourceId: z.string().uuid(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const logs = await getAuditTrail(
			ctx.workspaceId,
			parsedInput.resourceType,
			parsedInput.resourceId,
		);
		return { logs };
	});
