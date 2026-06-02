import { withKeys } from '@repo/crypto';
import type { SealedEnvelope } from '@repo/crypto';
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, max, sql } from 'drizzle-orm';
import { db } from '../client';
import { chats } from '../schema/chats';
import { messages } from '../schema/messages';

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface UpsertChatInput {
	telegramChatId: string;
	sourceAccountId?: string;
	type: 'private' | 'group' | 'supergroup' | 'channel';
	title?: string;
	username?: string;
	participantCount?: number;
}

export interface UpsertMessageInput {
	telegramMessageId: string;
	contactId?: string;
	text?: string;
	isOutgoing: boolean;
	sentAt: Date;
}

export interface MessageIdentity {
	id: string;
	telegramMessageId: string;
}

export interface MessageContactLink {
	telegramMessageId: string;
	contactId: string;
}

// ---------------------------------------------------------------------------
// Chat DAL — title and username are encrypted via encryptedText custom type
// ---------------------------------------------------------------------------

/** Create or update a chat. Returns the chat row. */
export async function upsertChat(
	workspaceId: string,
	input: UpsertChatInput,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const sourceAccountId = input.sourceAccountId ?? null;
		const sourceCondition = sourceAccountId
			? eq(chats.sourceAccountId, sourceAccountId)
			: isNull(chats.sourceAccountId);
		const existing = await db
			.select({ id: chats.id })
			.from(chats)
			.where(
				and(
					eq(chats.workspaceId, workspaceId),
					eq(chats.telegramChatId, input.telegramChatId),
					sourceCondition,
				),
			)
			.limit(1);

		const values = {
			type: input.type,
			title: input.title ?? null,
			username: input.username ?? null,
			participantCount: input.participantCount ?? null,
			updatedAt: sql`now()`,
		};

		if (existing[0]) {
			const updated = await db
				.update(chats)
				.set(values)
				.where(and(eq(chats.id, existing[0].id), eq(chats.workspaceId, workspaceId)))
				.returning();
			return updated[0] ?? null;
		}

		if (sourceAccountId) {
			const legacy = await db
				.select({ id: chats.id })
				.from(chats)
				.where(
					and(
						eq(chats.workspaceId, workspaceId),
						eq(chats.telegramChatId, input.telegramChatId),
						isNull(chats.sourceAccountId),
					),
				)
				.limit(1);

			if (legacy[0]) {
				const updated = await db
					.update(chats)
					.set({
						sourceAccountId,
						...values,
					})
					.where(and(eq(chats.id, legacy[0].id), eq(chats.workspaceId, workspaceId)))
					.returning();
				return updated[0] ?? null;
			}
		}

		const inserted = await db
			.insert(chats)
			.values({
				workspaceId,
				telegramChatId: input.telegramChatId,
				sourceAccountId,
				...values,
			})
			.returning();
		return inserted[0] ?? null;
	});
}

/** Update chat.lastSyncAt to now. */
export async function updateChatLastSync(workspaceId: string, chatId: string) {
	await db
		.update(chats)
		.set({ lastSyncAt: sql`now()` })
		.where(and(eq(chats.id, chatId), eq(chats.workspaceId, workspaceId)));
}

/** Get a chat by workspace + telegramChatId. */
export async function getChatByTelegramId(
	workspaceId: string,
	telegramChatId: string,
	envelope: SealedEnvelope,
	options?: { sourceAccountId?: string | null },
) {
	return withKeys(envelope, async () => {
		const sourceCondition =
			options?.sourceAccountId === undefined
				? undefined
				: options.sourceAccountId
					? eq(chats.sourceAccountId, options.sourceAccountId)
					: isNull(chats.sourceAccountId);
		const conditions = [
			eq(chats.workspaceId, workspaceId),
			eq(chats.telegramChatId, telegramChatId),
		];
		if (sourceCondition) conditions.push(sourceCondition);

		const result = await db
			.select()
			.from(chats)
			.where(and(...conditions))
			.limit(1);
		return result[0] ?? null;
	});
}

/** List all chats for a workspace, ordered by most recently updated. */
export async function listChats(workspaceId: string, envelope: SealedEnvelope) {
	return withKeys(envelope, async () => {
		return await db
			.select()
			.from(chats)
			.where(eq(chats.workspaceId, workspaceId))
			.orderBy(desc(chats.updatedAt));
	});
}

/** List selected chats for a workspace. */
export async function getChatsByIds(
	workspaceId: string,
	chatIds: string[],
	envelope: SealedEnvelope,
) {
	const ids = [...new Set(chatIds)].filter(Boolean);
	if (ids.length === 0) return [];

	return withKeys(envelope, async () => {
		return await db
			.select()
			.from(chats)
			.where(and(eq(chats.workspaceId, workspaceId), inArray(chats.id, ids)));
	});
}

// ---------------------------------------------------------------------------
// Message DAL — encrypted (text field uses encryptedText custom type)
// ---------------------------------------------------------------------------

/**
 * Bulk insert messages, skipping duplicates via ON CONFLICT DO NOTHING.
 * Dedup key: (workspaceId, chatId, telegramMessageId).
 */
export async function upsertMessages(
	workspaceId: string,
	chatId: string,
	msgs: UpsertMessageInput[],
	envelope: SealedEnvelope,
): Promise<number> {
	if (msgs.length === 0) return 0;

	return withKeys(envelope, async () => {
		const values = msgs.map((m) => ({
			workspaceId,
			chatId,
			telegramMessageId: m.telegramMessageId,
			contactId: m.contactId ?? null,
			text: m.text ?? null,
			isOutgoing: m.isOutgoing,
			sentAt: m.sentAt,
		}));

		const result = await db
			.insert(messages)
			.values(values)
			.onConflictDoNothing({
				target: [messages.workspaceId, messages.chatId, messages.telegramMessageId],
			})
			.returning({ id: messages.id });

		return result.length;
	});
}

/**
 * Attach existing messages in a private chat to the peer contact.
 * This repairs older imports where Telegram omitted fromId and duplicate
 * message rows were skipped before we could fill contactId.
 */
export async function linkMessagesToContact(
	workspaceId: string,
	chatId: string,
	contactId: string,
): Promise<number> {
	const result = await db
		.update(messages)
		.set({ contactId })
		.where(
			and(
				eq(messages.workspaceId, workspaceId),
				eq(messages.chatId, chatId),
				isNull(messages.contactId),
			),
		)
		.returning({ id: messages.id });

	return result.length;
}

/**
 * Attach existing messages to resolved sender contacts by Telegram message ID.
 * This repairs duplicate imports where a previous pass could not resolve the
 * sender but a later Telegram history page includes enough sender metadata.
 */
export async function linkMessagesToContactsByTelegramIds(
	workspaceId: string,
	chatId: string,
	links: MessageContactLink[],
): Promise<number> {
	const uniqueLinks = new Map<string, string>();
	for (const link of links) {
		if (link.telegramMessageId && link.contactId) {
			uniqueLinks.set(link.telegramMessageId, link.contactId);
		}
	}

	let linked = 0;
	for (const [telegramMessageId, contactId] of uniqueLinks) {
		const result = await db
			.update(messages)
			.set({ contactId })
			.where(
				and(
					eq(messages.workspaceId, workspaceId),
					eq(messages.chatId, chatId),
					eq(messages.telegramMessageId, telegramMessageId),
					isNull(messages.contactId),
				),
			)
			.returning({ id: messages.id });
		linked += result.length;
	}

	return linked;
}

/**
 * Resolve DB message IDs for Telegram message IDs in one chat.
 * Used after upsertMessages so downstream async jobs can attach source
 * message provenance without changing the legacy upsertMessages count API.
 */
export async function listMessageIdsByTelegramIds(
	workspaceId: string,
	chatId: string,
	telegramMessageIds: string[],
): Promise<MessageIdentity[]> {
	const ids = [...new Set(telegramMessageIds)].filter(Boolean);
	if (ids.length === 0) return [];

	return await db
		.select({
			id: messages.id,
			telegramMessageId: messages.telegramMessageId,
		})
		.from(messages)
		.where(
			and(
				eq(messages.workspaceId, workspaceId),
				eq(messages.chatId, chatId),
				inArray(messages.telegramMessageId, ids),
			),
		);
}

/** Get messages for a specific chat, paginated, newest first. */
export async function getMessagesByChat(
	workspaceId: string,
	chatId: string,
	envelope: SealedEnvelope,
	options?: { limit?: number; offset?: number },
) {
	const limit = options?.limit ?? 50;
	const offset = options?.offset ?? 0;

	return withKeys(envelope, async () => {
		return await db
			.select()
			.from(messages)
			.where(and(eq(messages.workspaceId, workspaceId), eq(messages.chatId, chatId)))
			.orderBy(desc(messages.sentAt))
			.limit(limit)
			.offset(offset);
	});
}

/** Get messages for a chat by Telegram message IDs. */
export async function getMessagesByTelegramIds(
	workspaceId: string,
	chatId: string,
	telegramMessageIds: string[],
	envelope: SealedEnvelope,
) {
	const uniqueTelegramMessageIds = [...new Set(telegramMessageIds)];
	if (uniqueTelegramMessageIds.length === 0) return [];

	return withKeys(envelope, async () => {
		return await db
			.select()
			.from(messages)
			.where(
				and(
					eq(messages.workspaceId, workspaceId),
					eq(messages.chatId, chatId),
					inArray(messages.telegramMessageId, uniqueTelegramMessageIds),
				),
			)
			.orderBy(desc(messages.sentAt));
	});
}

/** Get messages for a specific contact, paginated, newest first. */
export async function getMessagesByContact(
	workspaceId: string,
	contactId: string,
	envelope: SealedEnvelope,
	options?: { limit?: number; offset?: number },
) {
	const limit = options?.limit ?? 50;
	const offset = options?.offset ?? 0;

	return withKeys(envelope, async () => {
		return await db
			.select()
			.from(messages)
			.where(and(eq(messages.workspaceId, workspaceId), eq(messages.contactId, contactId)))
			.orderBy(desc(messages.sentAt))
			.limit(limit)
			.offset(offset);
	});
}

/** Get specific messages by ID for source evidence previews. */
export async function getMessagesByIds(
	workspaceId: string,
	messageIds: string[],
	envelope: SealedEnvelope,
) {
	if (messageIds.length === 0) return [];

	return withKeys(envelope, async () => {
		return await db
			.select({
				id: messages.id,
				contactId: messages.contactId,
				text: messages.text,
				isOutgoing: messages.isOutgoing,
				sentAt: messages.sentAt,
			})
			.from(messages)
			.where(and(eq(messages.workspaceId, workspaceId), inArray(messages.id, messageIds)))
			.orderBy(desc(messages.sentAt));
	});
}

/** Get messages for a contact since a specific timestamp. */
export async function getRecentMessages(
	workspaceId: string,
	contactId: string,
	since: Date,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		return await db
			.select()
			.from(messages)
			.where(
				and(
					eq(messages.workspaceId, workspaceId),
					eq(messages.contactId, contactId),
					gte(messages.sentAt, since),
				),
			)
			.orderBy(desc(messages.sentAt));
	});
}

/** Count messages for a contact (no envelope needed — count is not encrypted). */
export async function getMessageCount(workspaceId: string, contactId: string): Promise<number> {
	const result = await db
		.select({ value: count() })
		.from(messages)
		.where(and(eq(messages.workspaceId, workspaceId), eq(messages.contactId, contactId)));
	return result[0]?.value ?? 0;
}

/** Get the date of the most recent message for a contact. Returns null if no messages. */
export async function getLastMessageDate(
	workspaceId: string,
	contactId: string,
): Promise<Date | null> {
	const result = await db
		.select({ value: max(messages.sentAt) })
		.from(messages)
		.where(and(eq(messages.workspaceId, workspaceId), eq(messages.contactId, contactId)));
	return result[0]?.value ?? null;
}

/** Get the most recent message timestamp across the whole workspace. */
export async function getLatestMessageTimestamp(workspaceId: string): Promise<Date | null> {
	const result = await db
		.select({ value: max(messages.sentAt) })
		.from(messages)
		.where(eq(messages.workspaceId, workspaceId));
	return result[0]?.value ?? null;
}

/** Count messages and active conversations in a workspace time range. */
export async function getMessageTimeRangeStats(workspaceId: string, start: Date, end: Date) {
	const result = await db
		.select({
			messageCount: sql<number>`count(${messages.id})::int`,
			contactCount: sql<number>`count(distinct coalesce(${messages.contactId}::text, ${messages.chatId}::text))::int`,
		})
		.from(messages)
		.where(
			and(
				eq(messages.workspaceId, workspaceId),
				gte(messages.sentAt, start),
				lte(messages.sentAt, end),
			),
		);

	return {
		messageCount: Number(result[0]?.messageCount ?? 0),
		contactCount: Number(result[0]?.contactCount ?? 0),
	};
}

/** Get messages for a workspace within a time range. Defaults newest first. */
export async function getMessagesByTimeRange(
	workspaceId: string,
	start: Date,
	end: Date,
	envelope: SealedEnvelope,
	options?: { limit?: number; offset?: number; order?: 'asc' | 'desc' },
) {
	const limit = options?.limit ?? 200;
	const offset = options?.offset ?? 0;
	return withKeys(
		envelope,
		async () =>
			await db
				.select()
				.from(messages)
				.where(
					and(
						eq(messages.workspaceId, workspaceId),
						gte(messages.sentAt, start),
						lte(messages.sentAt, end),
					),
				)
				.orderBy(options?.order === 'asc' ? asc(messages.sentAt) : desc(messages.sentAt))
				.limit(limit)
				.offset(offset),
	);
}
