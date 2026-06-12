import type { SealedEnvelope } from '@repo/crypto';
import { withKeys } from '@repo/crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { contactTags } from '../schema/contact-tags';
import { contacts } from '../schema/contacts';

export interface UpsertContactTagInput {
	contactId: string;
	relationship?:
		| 'friend'
		| 'colleague'
		| 'prospect'
		| 'client'
		| 'investor'
		| 'family'
		| 'mentor'
		| 'mentee'
		| 'partner'
		| 'vendor'
		| 'other';
	priority?: 'high' | 'medium' | 'low';
	status?: 'active' | 'nurturing' | 'dormant' | 'new';
	customTags?: string[];
	goal?: string;
	notes?: string;
}

export interface ListContactsByTagFilters {
	relationship?: UpsertContactTagInput['relationship'];
	priority?: UpsertContactTagInput['priority'];
	status?: UpsertContactTagInput['status'];
	limit?: number;
	offset?: number;
}

export async function getContactTag(
	workspaceId: string,
	contactId: string,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const result = await db
			.select()
			.from(contactTags)
			.where(and(eq(contactTags.contactId, contactId), eq(contactTags.workspaceId, workspaceId)))
			.limit(1);
		return result[0] ?? null;
	});
}

export async function upsertContactTag(
	workspaceId: string,
	input: UpsertContactTagInput,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const result = await db
			.insert(contactTags)
			.values({
				workspaceId,
				contactId: input.contactId,
				relationship: input.relationship,
				priority: input.priority,
				status: input.status,
				customTags: input.customTags,
				goal: input.goal,
				notes: input.notes,
			})
			.onConflictDoUpdate({
				target: contactTags.contactId,
				set: {
					...(input.relationship !== undefined && { relationship: input.relationship }),
					...(input.priority !== undefined && { priority: input.priority }),
					...(input.status !== undefined && { status: input.status }),
					...(input.customTags !== undefined && { customTags: input.customTags }),
					...(input.goal !== undefined && { goal: input.goal }),
					...(input.notes !== undefined && { notes: input.notes }),
					updatedAt: sql`now()`,
				},
			})
			.returning();
		return result[0] ?? null;
	});
}

export async function listContactsByTag(
	workspaceId: string,
	filters: ListContactsByTagFilters,
	envelope: SealedEnvelope,
) {
	const limit = filters.limit ?? 50;
	const offset = filters.offset ?? 0;

	return withKeys(envelope, async () => {
		const conditions = [eq(contactTags.workspaceId, workspaceId)];

		if (filters.relationship) {
			conditions.push(eq(contactTags.relationship, filters.relationship));
		}
		if (filters.priority) {
			conditions.push(eq(contactTags.priority, filters.priority));
		}
		if (filters.status) {
			conditions.push(eq(contactTags.status, filters.status));
		}

		return await db
			.select({
				contact: contacts,
				tags: contactTags,
			})
			.from(contactTags)
			.leftJoin(contacts, eq(contactTags.contactId, contacts.id))
			.where(and(...conditions))
			.limit(limit)
			.offset(offset)
			.orderBy(contactTags.updatedAt);
	});
}

export async function deleteContactTag(workspaceId: string, contactId: string) {
	const result = await db
		.delete(contactTags)
		.where(and(eq(contactTags.contactId, contactId), eq(contactTags.workspaceId, workspaceId)))
		.returning();
	return result[0] ?? null;
}
