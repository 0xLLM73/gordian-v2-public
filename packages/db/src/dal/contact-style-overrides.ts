import { and, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { contactStyleOverrides } from '../schema/contact-style-overrides';
import { contacts } from '../schema/contacts';

export interface UpsertContactStyleOverrideInput {
	avgMessageLength: number;
	emojiRate: number;
	contractionRate: number;
	exclamationRate: number;
	questionAskRate: number;
	greetingRate: number;
	signoffRate: number;
	slangRate: number;
	avgWordCount: number;
	fillerWordRate: number;
	avgUniqueWordRatio: number;
	emojiTopN: Array<{ emoji: string; count: number }>;
	sampleSize: number;
}

export async function upsertContactStyleOverride(
	workspaceId: string,
	contactId: string,
	input: UpsertContactStyleOverrideInput,
) {
	// [SEC-FIX CRIT-1] Verify contact belongs to this workspace
	const contact = await db
		.select({ id: contacts.id })
		.from(contacts)
		.where(and(eq(contacts.id, contactId), eq(contacts.workspaceId, workspaceId)))
		.limit(1);
	if (contact.length === 0) {
		console.error(
			`[contact-style] contactId=${contactId.slice(0, 8)} not in workspace=${workspaceId.slice(0, 8)}`,
		);
		return null;
	}

	const result = await db
		.insert(contactStyleOverrides)
		.values({
			workspaceId,
			contactId,
			...input,
			lastAnalyzedAt: new Date(),
		})
		.onConflictDoUpdate({
			target: [contactStyleOverrides.workspaceId, contactStyleOverrides.contactId],
			set: {
				...input,
				lastAnalyzedAt: new Date(),
				updatedAt: sql`now()`,
			},
		})
		.returning();
	return result[0] ?? null;
}

export async function getContactStyleOverride(workspaceId: string, contactId: string) {
	const result = await db
		.select()
		.from(contactStyleOverrides)
		.where(
			and(
				eq(contactStyleOverrides.workspaceId, workspaceId),
				eq(contactStyleOverrides.contactId, contactId),
			),
		)
		.limit(1);
	return result[0] ?? null;
}

// [SEC-FIX CRIT-3] Paginated batch query instead of unbounded dump
export async function getContactStyleOverridesBatch(
	workspaceId: string,
	options?: { limit?: number; offset?: number },
) {
	const limit = options?.limit ?? 500;
	const offset = options?.offset ?? 0;
	return db
		.select()
		.from(contactStyleOverrides)
		.where(eq(contactStyleOverrides.workspaceId, workspaceId))
		.limit(limit)
		.offset(offset);
}

export async function updateDeviationSignals(
	workspaceId: string,
	contactId: string,
	signals: {
		lengthMultiplier: number;
		formalityShift: number;
		emojiMultiplier: number;
		dominantTone: 'casual' | 'professional' | 'warm' | 'terse';
	},
) {
	const result = await db
		.update(contactStyleOverrides)
		.set({ ...signals, updatedAt: sql`now()` })
		.where(
			and(
				eq(contactStyleOverrides.workspaceId, workspaceId),
				eq(contactStyleOverrides.contactId, contactId),
			),
		)
		.returning();
	return result[0] ?? null;
}
