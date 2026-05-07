import { computeBlindIndex, getCurrentKeys, withKeys } from '@repo/crypto';
import type { SealedEnvelope } from '@repo/crypto';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '../client';
import { accounts } from '../schema/auth';
import { contactShares } from '../schema/contact-shares';
import { contacts } from '../schema/contacts';

export interface CreateContactInput {
	firstName?: string;
	lastName?: string;
	phone?: string;
	email?: string;
	notes?: string;
	telegramId?: string;
	sourceAccountId?: string;
}

export interface UpdateContactInput {
	firstName?: string;
	lastName?: string;
	phone?: string;
	email?: string;
	notes?: string;
}

export async function getContactsByIds(
	workspaceId: string,
	contactIds: string[],
	envelope: SealedEnvelope,
) {
	if (contactIds.length === 0) return [];
	return withKeys(
		envelope,
		async () =>
			await db
				.select()
				.from(contacts)
				.where(and(eq(contacts.workspaceId, workspaceId), inArray(contacts.id, contactIds))),
	);
}

export async function getContact(workspaceId: string, contactId: string, envelope: SealedEnvelope) {
	return withKeys(envelope, async () => {
		const result = await db
			.select()
			.from(contacts)
			.where(and(eq(contacts.id, contactId), eq(contacts.workspaceId, workspaceId)))
			.limit(1);
		return result[0] ?? null;
	});
}

export async function searchContactByName(
	workspaceId: string,
	searchName: string,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const keys = getCurrentKeys();
		const nameHash = computeBlindIndex(searchName, keys.bik);

		// Check both first_name_bidx and last_name_bidx for matches
		const blindIndexResults = await db
			.select()
			.from(contacts)
			.where(
				and(
					eq(contacts.workspaceId, workspaceId),
					or(eq(contacts.firstNameBidx, nameHash), eq(contacts.lastNameBidx, nameHash)),
				),
			);

		if (blindIndexResults.length > 0) return blindIndexResults;

		// Fallback: decrypted name scan for small contact lists.
		// Handles display names with special chars (e.g. "Nick | SharkLabs")
		// where blind index HMAC("Nick | SharkLabs") != HMAC("Nick").
		const allContacts = await db
			.select()
			.from(contacts)
			.where(eq(contacts.workspaceId, workspaceId));

		const needle = searchName.toLowerCase();
		return allContacts.filter((c) => {
			const first = ((c.firstName as string) || '').toLowerCase();
			const last = ((c.lastName as string) || '').toLowerCase();
			return first.includes(needle) || last.includes(needle);
		});
	});
}

export async function searchContactByPhone(
	workspaceId: string,
	phone: string,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const keys = getCurrentKeys();
		const phoneHash = computeBlindIndex(phone, keys.bik);

		return await db
			.select()
			.from(contacts)
			.where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.phoneBidx, phoneHash)));
	});
}

export async function searchContactByEmail(
	workspaceId: string,
	email: string,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const keys = getCurrentKeys();
		const emailHash = computeBlindIndex(email, keys.bik);

		return await db
			.select()
			.from(contacts)
			.where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.emailBidx, emailHash)));
	});
}

export async function createContact(
	workspaceId: string,
	input: CreateContactInput,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const result = await db
			.insert(contacts)
			.values({
				workspaceId,
				telegramId: input.telegramId,
				sourceAccountId: input.sourceAccountId ?? null,
				firstName: input.firstName,
				lastName: input.lastName,
				phone: input.phone,
				email: input.email,
				notes: input.notes,
				// Blind indexes — computed automatically by custom type
				firstNameBidx: input.firstName,
				lastNameBidx: input.lastName,
				phoneBidx: input.phone,
				emailBidx: input.email,
			})
			.returning();
		return result[0] ?? null;
	});
}

export async function updateContact(
	workspaceId: string,
	contactId: string,
	input: UpdateContactInput,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const updates: Record<string, unknown> = {
			updatedAt: sql`now()`,
		};

		if (input.firstName !== undefined) {
			updates.firstName = input.firstName;
			updates.firstNameBidx = input.firstName;
		}
		if (input.lastName !== undefined) {
			updates.lastName = input.lastName;
			updates.lastNameBidx = input.lastName;
		}
		if (input.phone !== undefined) {
			updates.phone = input.phone;
			updates.phoneBidx = input.phone;
		}
		if (input.email !== undefined) {
			updates.email = input.email;
			updates.emailBidx = input.email;
		}
		if (input.notes !== undefined) {
			updates.notes = input.notes;
		}

		const result = await db
			.update(contacts)
			.set(updates)
			.where(and(eq(contacts.id, contactId), eq(contacts.workspaceId, workspaceId)))
			.returning();
		return result[0] ?? null;
	});
}

export async function listContacts(
	workspaceId: string,
	envelope: SealedEnvelope,
	options?: { limit?: number; offset?: number; sourceAccountId?: string },
) {
	const limit = options?.limit ?? 50;
	const offset = options?.offset ?? 0;

	return withKeys(envelope, async () => {
		const conditions = [eq(contacts.workspaceId, workspaceId)];
		if (options?.sourceAccountId) {
			conditions.push(eq(contacts.sourceAccountId, options.sourceAccountId));
		}

		return await db
			.select()
			.from(contacts)
			.where(and(...conditions))
			.limit(limit)
			.offset(offset)
			.orderBy(contacts.createdAt);
	});
}

/**
 * Get all contacts accessible to a specific user in a workspace.
 * A contact is accessible if:
 *   1. source_account_id IS NULL (legacy contact — visible to all)
 *   2. source_account_id belongs to one of the user's Telegram accounts
 *   3. Contact is explicitly shared with the user via contact_shares
 */
export async function getAccessibleContacts(
	workspaceId: string,
	userId: string,
	envelope: SealedEnvelope,
	options?: { limit?: number; offset?: number },
) {
	const limit = options?.limit ?? 50;
	const offset = options?.offset ?? 0;

	// Get user's Telegram account IDs
	const userAccounts = await db
		.select({ accountId: accounts.accountId })
		.from(accounts)
		.where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'telegram')));
	const accountIds = userAccounts.map((a) => a.accountId);

	// Get contact IDs explicitly shared with this user
	const shared = await db
		.select({ contactId: contactShares.contactId })
		.from(contactShares)
		.where(
			and(eq(contactShares.workspaceId, workspaceId), eq(contactShares.sharedWithUserId, userId)),
		);
	const sharedContactIds = shared.map((s) => s.contactId);

	return withKeys(envelope, async () => {
		const conditions = [eq(contacts.workspaceId, workspaceId)];

		// Build access filter: legacy OR owned OR shared
		const accessConditions: ReturnType<typeof isNull>[] = [isNull(contacts.sourceAccountId)];
		if (accountIds.length > 0) {
			accessConditions.push(inArray(contacts.sourceAccountId, accountIds));
		}
		if (sharedContactIds.length > 0) {
			accessConditions.push(inArray(contacts.id, sharedContactIds));
		}
		const accessFilter = or(...accessConditions);
		if (accessFilter) conditions.push(accessFilter);

		return await db
			.select()
			.from(contacts)
			.where(and(...conditions))
			.limit(limit)
			.offset(offset)
			.orderBy(contacts.createdAt);
	});
}

/**
 * Get user's linked Telegram account IDs.
 */
export async function getUserTelegramAccountIds(userId: string): Promise<string[]> {
	const result = await db
		.select({ accountId: accounts.accountId })
		.from(accounts)
		.where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'telegram')));
	return result.map((r) => r.accountId);
}

/**
 * Share a contact with another workspace member.
 */
export async function shareContact(
	workspaceId: string,
	contactId: string,
	sharedWithUserId: string,
	sharedByUserId: string,
) {
	const result = await db
		.insert(contactShares)
		.values({ workspaceId, contactId, sharedWithUserId, sharedByUserId })
		.onConflictDoNothing()
		.returning();
	return result[0] ?? null;
}

/**
 * Remove a contact share.
 */
export async function unshareContact(
	workspaceId: string,
	contactId: string,
	sharedWithUserId: string,
) {
	await db
		.delete(contactShares)
		.where(
			and(
				eq(contactShares.workspaceId, workspaceId),
				eq(contactShares.contactId, contactId),
				eq(contactShares.sharedWithUserId, sharedWithUserId),
			),
		);
}

/**
 * List who a contact is shared with.
 */
export async function getContactShares(workspaceId: string, contactId: string) {
	return db
		.select()
		.from(contactShares)
		.where(and(eq(contactShares.workspaceId, workspaceId), eq(contactShares.contactId, contactId)));
}

/**
 * Update inline recency counters on a contact after message sync (Feature 6).
 * Uses GREATEST to only advance lastMessageAt forward, and increments messageCount.
 */
export async function updateContactRecency(
	contactId: string,
	workspaceId: string,
	newMessageCount: number,
	latestMessageAt: Date,
) {
	await db
		.update(contacts)
		.set({
			messageCount: sql`${contacts.messageCount} + ${newMessageCount}`,
			lastMessageAt: sql`GREATEST(${contacts.lastMessageAt}, ${latestMessageAt})`,
			updatedAt: new Date(),
		})
		.where(and(eq(contacts.id, contactId), eq(contacts.workspaceId, workspaceId)));
}

/**
 * Get contacts with no recent messages (stale/ghosted).
 * Returns contacts sorted by last message date ascending (most neglected first).
 * Used by Track D ghosting alert and reconnect features.
 */
export async function getStaleContacts(
	workspaceId: string,
	envelope: SealedEnvelope,
	options?: { staleDays?: number; limit?: number },
) {
	const staleDays = options?.staleDays ?? 30;
	const limit = options?.limit ?? 20;
	const cutoff = new Date(Date.now() - staleDays * 86400000).toISOString();

	return withKeys(envelope, async () =>
		db
			.select({
				id: contacts.id,
				firstName: contacts.firstName,
				lastName: contacts.lastName,
				lastMessageAt: contacts.lastMessageAt,
				messageCount: contacts.messageCount,
			})
			.from(contacts)
			.where(
				and(
					eq(contacts.workspaceId, workspaceId),
					sql`${contacts.lastMessageAt} IS NOT NULL AND ${contacts.lastMessageAt} < ${cutoff}`,
					isNull(contacts.ghostingDismissedAt),
				),
			)
			.orderBy(sql`${contacts.lastMessageAt} ASC`)
			.limit(limit),
	);
}

/**
 * Dismiss a ghosting alert for a contact.
 * Sets ghostingDismissedAt so the contact won't appear in stale contacts.
 */
export async function dismissGhostingAlert(workspaceId: string, contactId: string) {
	const result = await db
		.update(contacts)
		.set({ ghostingDismissedAt: sql`now()` })
		.where(and(eq(contacts.id, contactId), eq(contacts.workspaceId, workspaceId)))
		.returning({ id: contacts.id });
	return result[0] ?? null;
}
