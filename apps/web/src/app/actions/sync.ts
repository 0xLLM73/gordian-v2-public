'use server';

import { isRuntimeEnvEnabled } from '@/lib/runtime-env';
import { getInternalSecret, workspaceAction } from '@/lib/safe-action';
import { track } from '@/lib/track';
import { z } from 'zod';

export const triggerSyncAction = workspaceAction.schema(z.object({})).action(async ({ ctx }) => {
	if (!isRuntimeEnvEnabled('TELEGRAM_MTPROTO_ENABLED')) {
		throw new Error('Telegram sync is disabled on this deployment');
	}

	const workerUrl = process.env.WORKER_URL;
	if (!workerUrl) throw new Error('WORKER_URL is not configured');

	const response = await fetch(`${workerUrl}/telegram/sync-contacts`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Internal-Secret': getInternalSecret(),
		},
		body: JSON.stringify({
			userId: ctx.session.user.id,
			workspaceId: ctx.workspaceId,
		}),
	});

	if (!response.ok) throw new Error('Failed to trigger sync');

	track(ctx.workspaceId, ctx.session.user.id, 'onboarding.sync_started');

	return { queued: true };
});
