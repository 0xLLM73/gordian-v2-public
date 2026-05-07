import { withKeys } from '@repo/crypto';
import type { SealedEnvelope } from '@repo/crypto';
import { and, count, desc, eq, gte, lte, max, sql } from 'drizzle-orm';
import { db } from '../client';
import { chats } from '../schema/chats';
import { messages } from '../schema/messages';

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface UpsertChatInput {
	telegramChatId: string;
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
		const result = await db
			.insert(chats)
			.values({
				workspaceId,
				telegramChatId: input.telegramChatId,
				type: input.type,
				title: input.title ?? null,
				username: input.username ?? null,
				participantCount: input.participantCount ?? null,
			})
			.onConflictDoUpdate({
				target: [chats.workspaceId, chats.telegramChatId],
				set: {
					type: input.type,
					title: input.title ?? null,
					username: input.username ?? null,
					participantCount: input.participantCount ?? null,
					updatedAt: sql`now()`,
				},
			})
			.returning();
		return result[0] ?? null;
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
) {
	return withKeys(envelope, async () => {
		const result = await db
			.select()
			.from(chats)
			.where(and(eq(chats.workspaceId, workspaceId), eq(chats.telegramChatId, telegramChatId)))
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

/** Get all messages for a workspace within a time range, newest first. */
export async function getMessagesByTimeRange(
	workspaceId: string,
	start: Date,
	end: Date,
	envelope: SealedEnvelope,
	options?: { limit?: number },
) {
	const limit = options?.limit ?? 200;
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
				.orderBy(desc(messages.sentAt))
				.limit(limit),
	);
}
