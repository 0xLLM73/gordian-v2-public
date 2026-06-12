'use server';

import { hasAnalyticsConsent, trackBehavior } from '@repo/db';
import { z } from 'zod';
import { getPostHogServer } from '@/lib/posthog-server';
import { workspaceAction } from '@/lib/safe-action';

/**
 * Generic fire-and-forget tracking action for client components.
 * Requires an authenticated session + workspace (post-verification only).
 * Consent gate checks user's analytics consent before emitting.
 * Dual-writes to Postgres (user_behaviors) + PostHog.
 */
export const trackEventAction = workspaceAction
	.schema(
		z.object({
			event: z.string(),
			properties: z.record(z.string(), z.unknown()).optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const consented = await hasAnalyticsConsent(ctx.session.user.id, ctx.workspaceId);
		if (!consented) return;
		void trackBehavior(
			ctx.workspaceId,
			ctx.session.user.id,
			parsedInput.event,
			parsedInput.properties,
		).catch(() => {});
		try {
			const ph = getPostHogServer();
			ph?.capture({
				distinctId: ctx.session.user.id,
				event: parsedInput.event,
				properties: {
					...parsedInput.properties,
					workspace_id: ctx.workspaceId,
				},
			});
		} catch {}
	});
