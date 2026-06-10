'use server';

import { workspaceAction } from '@/lib/safe-action';
import {
	CONTACT_HEALTH_FEEDBACK_ACTIONS,
	CONTACT_HEALTH_FEEDBACK_REASONS,
	recordContactHealthFeedback,
} from '@repo/db';
import { z } from 'zod';

const actionSchema = z.enum(CONTACT_HEALTH_FEEDBACK_ACTIONS);
const reasonSchema = z.enum(CONTACT_HEALTH_FEEDBACK_REASONS);

function defaultReasonForAction(
	action: z.infer<typeof actionSchema>,
): z.infer<typeof reasonSchema> {
	switch (action) {
		case 'snooze':
			return 'snoozed';
		case 'mark_low_touch':
			return 'normal_low_touch';
		case 'handled_elsewhere':
			return 'talked_elsewhere';
		case 'not_important':
			return 'not_important';
		case 'dismiss_wrong':
			return 'wrong_alert';
	}
}

function defaultSnoozeDate(): Date {
	return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
}

export const recordContactHealthFeedbackAction = workspaceAction
	.schema(
		z.object({
			contactId: z.string().uuid(),
			action: actionSchema,
			reason: reasonSchema.optional(),
			statusReasonCode: z.string().max(80).optional(),
			snoozedUntil: z.string().datetime().optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const snoozedUntil =
			parsedInput.action === 'snooze'
				? parsedInput.snoozedUntil
					? new Date(parsedInput.snoozedUntil)
					: defaultSnoozeDate()
				: null;

		if (snoozedUntil && snoozedUntil.getTime() <= Date.now()) {
			throw new Error('Snooze must be in the future');
		}

		return recordContactHealthFeedback(ctx.workspaceId, {
			contactId: parsedInput.contactId,
			action: parsedInput.action,
			reason: parsedInput.reason ?? defaultReasonForAction(parsedInput.action),
			statusReasonCode: parsedInput.statusReasonCode ?? null,
			snoozedUntil,
			userId: ctx.session.user.id,
			metadata: { source: 'dashboard' },
		});
	});
