'use server';

import { workspaceAction } from '@/lib/safe-action';
import { getMessagesByContact } from '@repo/db';
import { z } from 'zod';

export const getMessagesByContactAction = workspaceAction
	.schema(
		z.object({
			contactId: z.string().uuid(),
			limit: z.number().int().positive().max(100).default(50),
			offset: z.number().int().nonnegative().default(0),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		if (!ctx.envelope) throw new Error('Workspace encryption key not found');
		return getMessagesByContact(ctx.workspaceId, parsedInput.contactId, ctx.envelope, {
			limit: parsedInput.limit,
			offset: parsedInput.offset,
		});
	});
