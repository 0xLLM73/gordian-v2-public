'use server';

import { createCommitment, dismissGhostingAlert } from '@repo/db';
import { z } from 'zod';
import { workspaceAction } from '@/lib/safe-action';

/**
 * "Remind me" — creates a soft draft commitment for the ghosted contact.
 * Signals priority intent without requiring the user to write anything.
 */
export const ghostingRemindAction = workspaceAction
	.schema(z.object({ contactId: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		await createCommitment(
			ctx.workspaceId,
			{
				contactId: parsedInput.contactId,
				title: 'Reconnect with this contact',
				commitmentType: 'task',
				assignee: 'self',
				confidence: 0.6,
			},
			ctx.envelope,
		);
	});

/**
 * "Not important" — dismisses the ghosting alert for this contact.
 * Persists a timestamp so the contact won't reappear in stale contact lists.
 */
export const ghostingDismissAction = workspaceAction
	.schema(z.object({ contactId: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		await dismissGhostingAlert(ctx.workspaceId, parsedInput.contactId);
	});
