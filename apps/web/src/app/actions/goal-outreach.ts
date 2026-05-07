'use server';

import { workspaceAction } from '@/lib/safe-action';
import { getContactsByIds, getHealthScore, getLastMessageDate, listGoalActions } from '@repo/db';
import { z } from 'zod';

export const getOutreachSuggestionsAction = workspaceAction
	.schema(z.object({ goalId: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		const actions = await listGoalActions(ctx.workspaceId, parsedInput.goalId, ctx.envelope);
		const outreachActions = actions.filter(
			(a) => a.actionType === 'contact_outreach' && a.contactId,
		);

		if (outreachActions.length === 0) return [];

		// Batch fetch contact names
		const contactIds = outreachActions.map((a) => a.contactId as string);
		const contacts = await getContactsByIds(ctx.workspaceId, contactIds, ctx.envelope);
		const contactMap: Record<string, { firstName: string | null; lastName: string | null }> = {};
		for (const c of contacts) {
			contactMap[c.id] = { firstName: c.firstName, lastName: c.lastName };
		}

		// Enrich each outreach action with health + last message in parallel
		const enriched = await Promise.all(
			outreachActions.map(async (action) => {
				const contact = contactMap[action.contactId as string];
				const [health, lastMsg] = await Promise.all([
					getHealthScore(ctx.workspaceId, action.contactId as string),
					getLastMessageDate(ctx.workspaceId, action.contactId as string),
				]);
				return {
					actionId: action.id,
					contactId: action.contactId as string,
					contactName:
						[contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || 'Unknown',
					matchReason: action.description ?? action.title,
					healthLabel: health?.label ?? 'unknown',
					healthComposite: health?.composite ?? null,
					healthTrend: health?.trend ?? null,
					lastInteraction: lastMsg ? lastMsg.toISOString() : null,
					effort: action.effort,
					status: action.status,
				};
			}),
		);

		return enriched.slice(0, 5);
	});
