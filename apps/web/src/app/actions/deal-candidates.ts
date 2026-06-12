'use server';

import { withKeys } from '@repo/crypto';
import {
	and,
	confirmCandidate as dalConfirm,
	createDeal as dalCreateDeal,
	dismissCandidate as dalDismiss,
	listPendingCandidates as dalListPending,
	db,
	dealCandidates,
	eq,
} from '@repo/db';
import { z } from 'zod';
import { workspaceAction } from '@/lib/safe-action';

export const listPendingCandidatesAction = workspaceAction
	.schema(
		z.object({
			limit: z.number().int().positive().optional(),
			offset: z.number().int().nonnegative().optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		return dalListPending(ctx.workspaceId, ctx.envelope, {
			limit: parsedInput.limit,
			offset: parsedInput.offset,
		});
	});

export const confirmCandidateAction = workspaceAction
	.schema(
		z.object({
			candidateId: z.string().uuid(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		// Step 1: Fetch candidate with decryption (dealTitleGuess is encrypted)
		const [candidate] = await withKeys(ctx.envelope, () =>
			db
				.select()
				.from(dealCandidates)
				.where(
					and(
						eq(dealCandidates.id, parsedInput.candidateId),
						eq(dealCandidates.workspaceId, ctx.workspaceId),
					),
				)
				.limit(1),
		);
		if (!candidate) throw new Error('Candidate not found');
		if (!candidate.contactId) throw new Error('Candidate has no linked contact');

		// Step 2: Create a real deal from candidate data
		const deal = await dalCreateDeal(
			ctx.workspaceId,
			{
				contactId: candidate.contactId,
				title: candidate.dealTitleGuess,
				dealType: candidate.dealTypeGuess,
				value: 0,
				source: 'detected',
			},
			ctx.envelope,
		);
		if (!deal) throw new Error('Failed to create deal');

		// Step 3: Mark candidate as confirmed with the new deal's ID
		return dalConfirm(ctx.workspaceId, parsedInput.candidateId, deal.id);
	});

export const dismissCandidateAction = workspaceAction
	.schema(
		z.object({
			candidateId: z.string().uuid(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		return dalDismiss(ctx.workspaceId, parsedInput.candidateId);
	});
