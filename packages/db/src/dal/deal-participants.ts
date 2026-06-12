import type { SealedEnvelope } from '@repo/crypto';
import { withKeys } from '@repo/crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../client';
import { contacts } from '../schema/contacts';
import { dealParticipants } from '../schema/deal-participants';
import { deals } from '../schema/deals';

export interface CreateDealParticipantInput {
	dealId: string;
	contactId: string;
	role?: 'lead' | 'co_investor' | 'advisor' | 'counterparty' | 'introducer' | 'other';
	notes?: string;
}

export async function addDealParticipant(
	workspaceId: string,
	input: CreateDealParticipantInput,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		// SEC-107: Verify dealId and contactId belong to this workspace
		const [deal] = await db
			.select({ id: deals.id })
			.from(deals)
			.where(and(eq(deals.id, input.dealId), eq(deals.workspaceId, workspaceId)))
			.limit(1);

		if (!deal) throw new Error('Not found');

		const [contact] = await db
			.select({ id: contacts.id })
			.from(contacts)
			.where(and(eq(contacts.id, input.contactId), eq(contacts.workspaceId, workspaceId)))
			.limit(1);

		if (!contact) throw new Error('Not found');

		const [result] = await db
			.insert(dealParticipants)
			.values({
				workspaceId,
				dealId: input.dealId,
				contactId: input.contactId,
				role: input.role ?? 'other',
				notes: input.notes,
			})
			.onConflictDoNothing()
			.returning();
		return result;
	});
}

export async function listDealParticipants(
	workspaceId: string,
	dealId: string,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		return db
			.select()
			.from(dealParticipants)
			.where(
				and(eq(dealParticipants.workspaceId, workspaceId), eq(dealParticipants.dealId, dealId)),
			);
	});
}

export async function removeDealParticipant(workspaceId: string, participantId: string) {
	return db
		.delete(dealParticipants)
		.where(
			and(eq(dealParticipants.id, participantId), eq(dealParticipants.workspaceId, workspaceId)),
		);
}

export async function updateDealParticipant(
	workspaceId: string,
	participantId: string,
	input: {
		role?: 'lead' | 'co_investor' | 'advisor' | 'counterparty' | 'introducer' | 'other';
		notes?: string | null;
	},
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const [result] = await db
			.update(dealParticipants)
			.set({
				role: input.role,
				notes: input.notes === undefined ? undefined : input.notes,
			})
			.where(
				and(eq(dealParticipants.id, participantId), eq(dealParticipants.workspaceId, workspaceId)),
			)
			.returning();

		if (!result) throw new Error('Not found');
		return result;
	});
}
