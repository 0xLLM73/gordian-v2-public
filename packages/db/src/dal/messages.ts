import type { SealedEnvelope } from '@repo/crypto';
import { withKeys } from '@repo/crypto';
import {
	and,
	asc,
	count,
	desc,
	eq,
	gte,
	inArray,
	isNull,
	lt,
	lte,
	max,
	or,
	sql,
} from 'drizzle-orm';
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
	telegramSenderId?: string;
	telegramSenderType?: TelegramSenderType;
	text?: string;
	isOutgoing: boolean;
	sentAt: Date;
}

export type TelegramSenderType = 'user' | 'chat' | 'channel';

export interface MessageIdentity {
	id: string;
	telegramMessageId: string;
}

export interface MessageContactLink {
	telegramMessageId: string;
	contactId: string;
}

export interface MessageSenderMetadataLink {
	telegramMessageId: string;
	telegramSenderId: string;
	telegramSenderType: TelegramSenderType;
}

export interface MessageContactCoverageByChatType {
	chatType: string;
	totalMessages: number;
	messagesWithSenderMetadata: number;
	messagesWithUserSenderMetadata: number;
	nullContactMessages: number;
	nullContactMessagesWithSenderMetadata: number;
	nullContactMessagesWithUserSenderMetadata: number;
	linkedContactMessages: number;
	chatsWithNullContactMessages: number;
}

export interface MessageContactCoverageReport {
	workspaceId: string;
	totalMessages: number;
	messagesWithSenderMetadata: number;
	messagesWithUserSenderMetadata: number;
	nullContactMessages: number;
	nullContactMessagesWithSenderMetadata: number;
	nullContactMessagesWithUserSenderMetadata: number;
	linkedContactMessages: number;
	chatsWithNullContactMessages: number;
	byChatType: MessageContactCoverageByChatType[];
}

export interface MessageNullContactReasonRow {
	reason:
		| 'ambiguous_user_sender_contact'
		| 'channel_not_person_addressable'
		| 'group_sender_metadata_missing'
		| 'non_user_sender'
		| 'partial_sender_metadata'
		| 'private_peer_contact_missing'
		| 'repairable_user_sender_contact'
		| 'sender_metadata_missing'
		| 'unmatched_user_sender_contact';
	chatType: string;
	nullMessages: number;
	chatsAffected: number;
}

export interface MessageNullContactReasonReport {
	workspaceId: string;
	totalNullMessages: number;
	reasons: MessageNullContactReasonRow[];
}

export interface PrivatePeerContactRepairResult {
	workspaceId: string;
	writeMode: boolean;
	privateNullMessages: number;
	repairableMessages: number;
	ambiguousMessages: number;
	unmatchedMessages: number;
	repairedMessages: number;
}

export interface SenderMetadataContactRepairResult {
	workspaceId: string;
	writeMode: boolean;
	nullUserSenderMessages: number;
	repairableMessages: number;
	ambiguousMessages: number;
	unmatchedMessages: number;
	repairedMessages: number;
}

function asNumber(value: unknown): number {
	if (typeof value === 'number') return value;
	if (typeof value === 'bigint') return Number(value);
	if (typeof value === 'string') return Number.parseInt(value, 10) || 0;
	return 0;
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
			telegramSenderId: m.telegramSenderId ?? null,
			telegramSenderType: m.telegramSenderType ?? null,
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

export async function updateMessageSenderMetadataByTelegramIds(
	workspaceId: string,
	chatId: string,
	links: MessageSenderMetadataLink[],
): Promise<number> {
	const uniqueLinks = new Map<string, MessageSenderMetadataLink>();
	for (const link of links) {
		if (link.telegramMessageId && link.telegramSenderId && link.telegramSenderType) {
			uniqueLinks.set(link.telegramMessageId, link);
		}
	}

	let updated = 0;
	for (const link of uniqueLinks.values()) {
		const result = await db
			.update(messages)
			.set({
				telegramSenderId: sql`coalesce(${messages.telegramSenderId}, ${link.telegramSenderId})`,
				telegramSenderType: sql`coalesce(${messages.telegramSenderType}, ${link.telegramSenderType})`,
			})
			.where(
				and(
					eq(messages.workspaceId, workspaceId),
					eq(messages.chatId, chatId),
					eq(messages.telegramMessageId, link.telegramMessageId),
					or(isNull(messages.telegramSenderId), isNull(messages.telegramSenderType)),
				),
			)
			.returning({ id: messages.id });
		updated += result.length;
	}

	return updated;
}

export async function getMessageContactCoverageReport(
	workspaceId: string,
): Promise<MessageContactCoverageReport> {
	const summaryRows = (await db.execute(sql`
			SELECT
				count(*)::int AS "totalMessages",
				count(*) FILTER (
					WHERE m.telegram_sender_id IS NOT NULL
						AND m.telegram_sender_type IS NOT NULL
				)::int AS "messagesWithSenderMetadata",
				count(*) FILTER (
					WHERE m.telegram_sender_id IS NOT NULL
						AND m.telegram_sender_type = 'user'
				)::int AS "messagesWithUserSenderMetadata",
				count(*) FILTER (WHERE m.contact_id IS NULL)::int AS "nullContactMessages",
			count(*) FILTER (
				WHERE m.contact_id IS NULL
					AND m.telegram_sender_id IS NOT NULL
					AND m.telegram_sender_type IS NOT NULL
			)::int AS "nullContactMessagesWithSenderMetadata",
			count(*) FILTER (
				WHERE m.contact_id IS NULL
					AND m.telegram_sender_id IS NOT NULL
					AND m.telegram_sender_type = 'user'
			)::int AS "nullContactMessagesWithUserSenderMetadata",
			count(*) FILTER (WHERE m.contact_id IS NOT NULL)::int AS "linkedContactMessages",
			count(DISTINCT m.chat_id) FILTER (WHERE m.contact_id IS NULL)::int AS "chatsWithNullContactMessages"
		FROM messages m
		WHERE m.workspace_id = ${workspaceId}
	`)) as Array<{
		totalMessages: unknown;
		messagesWithSenderMetadata: unknown;
		messagesWithUserSenderMetadata: unknown;
		nullContactMessages: unknown;
		nullContactMessagesWithSenderMetadata: unknown;
		nullContactMessagesWithUserSenderMetadata: unknown;
		linkedContactMessages: unknown;
		chatsWithNullContactMessages: unknown;
	}>;

	const byChatTypeRows = (await db.execute(sql`
		SELECT
			ch.type::text AS "chatType",
			count(*)::int AS "totalMessages",
			count(*) FILTER (
				WHERE m.telegram_sender_id IS NOT NULL
					AND m.telegram_sender_type IS NOT NULL
			)::int AS "messagesWithSenderMetadata",
			count(*) FILTER (
				WHERE m.telegram_sender_id IS NOT NULL
					AND m.telegram_sender_type = 'user'
			)::int AS "messagesWithUserSenderMetadata",
			count(*) FILTER (WHERE m.contact_id IS NULL)::int AS "nullContactMessages",
			count(*) FILTER (
				WHERE m.contact_id IS NULL
					AND m.telegram_sender_id IS NOT NULL
					AND m.telegram_sender_type IS NOT NULL
			)::int AS "nullContactMessagesWithSenderMetadata",
			count(*) FILTER (
				WHERE m.contact_id IS NULL
					AND m.telegram_sender_id IS NOT NULL
					AND m.telegram_sender_type = 'user'
			)::int AS "nullContactMessagesWithUserSenderMetadata",
			count(*) FILTER (WHERE m.contact_id IS NOT NULL)::int AS "linkedContactMessages",
			count(DISTINCT m.chat_id) FILTER (WHERE m.contact_id IS NULL)::int AS "chatsWithNullContactMessages"
		FROM messages m
		INNER JOIN chats ch
			ON ch.id = m.chat_id
			AND ch.workspace_id = m.workspace_id
		WHERE m.workspace_id = ${workspaceId}
		GROUP BY ch.type
		ORDER BY count(*) FILTER (WHERE m.contact_id IS NULL) DESC, ch.type ASC
	`)) as Array<{
		chatType: string | null;
		totalMessages: unknown;
		messagesWithSenderMetadata: unknown;
		messagesWithUserSenderMetadata: unknown;
		nullContactMessages: unknown;
		nullContactMessagesWithSenderMetadata: unknown;
		nullContactMessagesWithUserSenderMetadata: unknown;
		linkedContactMessages: unknown;
		chatsWithNullContactMessages: unknown;
	}>;

	const summary = summaryRows[0];
	return {
		workspaceId,
		totalMessages: asNumber(summary?.totalMessages),
		messagesWithSenderMetadata: asNumber(summary?.messagesWithSenderMetadata),
		messagesWithUserSenderMetadata: asNumber(summary?.messagesWithUserSenderMetadata),
		nullContactMessages: asNumber(summary?.nullContactMessages),
		nullContactMessagesWithSenderMetadata: asNumber(summary?.nullContactMessagesWithSenderMetadata),
		nullContactMessagesWithUserSenderMetadata: asNumber(
			summary?.nullContactMessagesWithUserSenderMetadata,
		),
		linkedContactMessages: asNumber(summary?.linkedContactMessages),
		chatsWithNullContactMessages: asNumber(summary?.chatsWithNullContactMessages),
		byChatType: byChatTypeRows.map((row) => ({
			chatType: row.chatType ?? 'unknown',
			totalMessages: asNumber(row.totalMessages),
			messagesWithSenderMetadata: asNumber(row.messagesWithSenderMetadata),
			messagesWithUserSenderMetadata: asNumber(row.messagesWithUserSenderMetadata),
			nullContactMessages: asNumber(row.nullContactMessages),
			nullContactMessagesWithSenderMetadata: asNumber(row.nullContactMessagesWithSenderMetadata),
			nullContactMessagesWithUserSenderMetadata: asNumber(
				row.nullContactMessagesWithUserSenderMetadata,
			),
			linkedContactMessages: asNumber(row.linkedContactMessages),
			chatsWithNullContactMessages: asNumber(row.chatsWithNullContactMessages),
		})),
	};
}

export async function getMessageNullContactReasonReport(
	workspaceId: string,
): Promise<MessageNullContactReasonReport> {
	const rows = (await db.execute(sql`
		WITH null_messages AS (
			SELECT
				m.id AS message_id,
				m.chat_id,
				m.telegram_sender_id,
				m.telegram_sender_type,
				ch.type::text AS chat_type,
				ch.source_account_id
			FROM messages m
			INNER JOIN chats ch
				ON ch.id = m.chat_id
				AND ch.workspace_id = m.workspace_id
			WHERE m.workspace_id = ${workspaceId}
				AND m.contact_id IS NULL
		),
		sender_contact_candidates AS (
			SELECT
				n.message_id,
				count(c.id)::int AS candidate_count
			FROM null_messages n
			LEFT JOIN contacts c
				ON c.workspace_id = ${workspaceId}
				AND c.telegram_id = n.telegram_sender_id
				AND (
					c.source_account_id IS NOT DISTINCT FROM n.source_account_id
					OR c.source_account_id IS NULL
				)
			WHERE n.telegram_sender_type = 'user'
				AND n.telegram_sender_id IS NOT NULL
			GROUP BY n.message_id
		),
		classified AS (
			SELECT
				n.message_id,
				n.chat_id,
				n.chat_type,
				CASE
					WHEN n.telegram_sender_type = 'user'
						AND coalesce(c.candidate_count, 0) = 1
						THEN 'repairable_user_sender_contact'
					WHEN n.telegram_sender_type = 'user'
						AND coalesce(c.candidate_count, 0) > 1
						THEN 'ambiguous_user_sender_contact'
					WHEN n.telegram_sender_type = 'user'
						THEN 'unmatched_user_sender_contact'
					WHEN n.telegram_sender_type IN ('chat', 'channel')
						THEN 'non_user_sender'
					WHEN n.telegram_sender_id IS NOT NULL
						OR n.telegram_sender_type IS NOT NULL
						THEN 'partial_sender_metadata'
					WHEN n.chat_type = 'private'
						THEN 'private_peer_contact_missing'
					WHEN n.chat_type IN ('group', 'supergroup')
						THEN 'group_sender_metadata_missing'
					WHEN n.chat_type = 'channel'
						THEN 'channel_not_person_addressable'
					ELSE 'sender_metadata_missing'
				END AS reason
			FROM null_messages n
			LEFT JOIN sender_contact_candidates c
				ON c.message_id = n.message_id
		)
		SELECT
			reason,
			chat_type AS "chatType",
			count(*)::int AS "nullMessages",
			count(DISTINCT chat_id)::int AS "chatsAffected"
		FROM classified
		GROUP BY reason, chat_type
		ORDER BY count(*) DESC, reason ASC, chat_type ASC
	`)) as Array<{
		reason: MessageNullContactReasonRow['reason'];
		chatType: string | null;
		nullMessages: unknown;
		chatsAffected: unknown;
	}>;

	const reasons = rows.map((row) => ({
		reason: row.reason,
		chatType: row.chatType ?? 'unknown',
		nullMessages: asNumber(row.nullMessages),
		chatsAffected: asNumber(row.chatsAffected),
	}));

	return {
		workspaceId,
		totalNullMessages: reasons.reduce((sum, row) => sum + row.nullMessages, 0),
		reasons,
	};
}

export async function repairPrivateMessagesToPeerContacts(
	workspaceId: string,
	options: { write?: boolean } = {},
): Promise<PrivatePeerContactRepairResult> {
	const baseSql = sql`
		WITH private_null_messages AS (
			SELECT
				m.id AS message_id,
				ch.telegram_chat_id,
				ch.source_account_id
			FROM messages m
			INNER JOIN chats ch
				ON ch.id = m.chat_id
				AND ch.workspace_id = m.workspace_id
			WHERE m.workspace_id = ${workspaceId}
				AND m.contact_id IS NULL
				AND ch.type = 'private'
		),
		candidates AS (
			SELECT
				p.message_id,
				c.id AS contact_id,
				CASE
					WHEN c.source_account_id IS NOT DISTINCT FROM p.source_account_id THEN 0
					WHEN c.source_account_id IS NULL THEN 1
					ELSE 2
				END AS match_priority
			FROM private_null_messages p
			INNER JOIN contacts c
				ON c.workspace_id = ${workspaceId}
				AND c.telegram_id = p.telegram_chat_id
				AND (
					c.source_account_id IS NOT DISTINCT FROM p.source_account_id
					OR c.source_account_id IS NULL
				)
		),
		best_priority AS (
			SELECT message_id, min(match_priority) AS match_priority
			FROM candidates
			GROUP BY message_id
		),
		best_candidates AS (
			SELECT c.message_id, c.contact_id
			FROM candidates c
			INNER JOIN best_priority p
				ON p.message_id = c.message_id
				AND p.match_priority = c.match_priority
		),
		repairable AS (
			SELECT message_id, (array_agg(contact_id))[1] AS contact_id
			FROM best_candidates
			GROUP BY message_id
			HAVING count(*) = 1
		),
		ambiguous AS (
			SELECT message_id
			FROM best_candidates
			GROUP BY message_id
			HAVING count(*) > 1
		),
		unmatched AS (
			SELECT p.message_id
			FROM private_null_messages p
			LEFT JOIN best_candidates b ON b.message_id = p.message_id
			WHERE b.message_id IS NULL
		)
	`;

	const countSql = sql`
		${baseSql}
		SELECT
			(SELECT count(*) FROM private_null_messages)::int AS "privateNullMessages",
			(SELECT count(*) FROM repairable)::int AS "repairableMessages",
			(SELECT count(*) FROM ambiguous)::int AS "ambiguousMessages",
			(SELECT count(*) FROM unmatched)::int AS "unmatchedMessages",
			0::int AS "repairedMessages"
	`;

	const writeSql = sql`
		${baseSql},
		updated AS (
			UPDATE messages m
			SET contact_id = repairable.contact_id
			FROM repairable
			WHERE m.id = repairable.message_id
				AND m.workspace_id = ${workspaceId}
				AND m.contact_id IS NULL
			RETURNING m.id
		)
		SELECT
			(SELECT count(*) FROM private_null_messages)::int AS "privateNullMessages",
			(SELECT count(*) FROM repairable)::int AS "repairableMessages",
			(SELECT count(*) FROM ambiguous)::int AS "ambiguousMessages",
			(SELECT count(*) FROM unmatched)::int AS "unmatchedMessages",
			(SELECT count(*) FROM updated)::int AS "repairedMessages"
	`;

	const rows = (await db.execute(options.write ? writeSql : countSql)) as Array<{
		privateNullMessages: unknown;
		repairableMessages: unknown;
		ambiguousMessages: unknown;
		unmatchedMessages: unknown;
		repairedMessages: unknown;
	}>;
	const row = rows[0];
	return {
		workspaceId,
		writeMode: Boolean(options.write),
		privateNullMessages: asNumber(row?.privateNullMessages),
		repairableMessages: asNumber(row?.repairableMessages),
		ambiguousMessages: asNumber(row?.ambiguousMessages),
		unmatchedMessages: asNumber(row?.unmatchedMessages),
		repairedMessages: asNumber(row?.repairedMessages),
	};
}

export async function repairMessagesToSenderContacts(
	workspaceId: string,
	options: { write?: boolean } = {},
): Promise<SenderMetadataContactRepairResult> {
	const baseSql = sql`
		WITH null_user_sender_messages AS (
			SELECT
				m.id AS message_id,
				m.telegram_sender_id,
				ch.source_account_id
			FROM messages m
			INNER JOIN chats ch
				ON ch.id = m.chat_id
				AND ch.workspace_id = m.workspace_id
			WHERE m.workspace_id = ${workspaceId}
				AND m.contact_id IS NULL
				AND m.telegram_sender_type = 'user'
				AND m.telegram_sender_id IS NOT NULL
		),
		candidates AS (
			SELECT
				m.message_id,
				c.id AS contact_id,
				CASE
					WHEN c.source_account_id IS NOT DISTINCT FROM m.source_account_id THEN 0
					WHEN c.source_account_id IS NULL THEN 1
					ELSE 2
				END AS match_priority
			FROM null_user_sender_messages m
			INNER JOIN contacts c
				ON c.workspace_id = ${workspaceId}
				AND c.telegram_id = m.telegram_sender_id
				AND (
					c.source_account_id IS NOT DISTINCT FROM m.source_account_id
					OR c.source_account_id IS NULL
				)
		),
		best_priority AS (
			SELECT message_id, min(match_priority) AS match_priority
			FROM candidates
			GROUP BY message_id
		),
		best_candidates AS (
			SELECT c.message_id, c.contact_id
			FROM candidates c
			INNER JOIN best_priority p
				ON p.message_id = c.message_id
				AND p.match_priority = c.match_priority
		),
		repairable AS (
			SELECT message_id, (array_agg(contact_id))[1] AS contact_id
			FROM best_candidates
			GROUP BY message_id
			HAVING count(*) = 1
		),
		ambiguous AS (
			SELECT message_id
			FROM best_candidates
			GROUP BY message_id
			HAVING count(*) > 1
		),
		unmatched AS (
			SELECT m.message_id
			FROM null_user_sender_messages m
			LEFT JOIN best_candidates b ON b.message_id = m.message_id
			WHERE b.message_id IS NULL
		)
	`;

	const countSql = sql`
		${baseSql}
		SELECT
			(SELECT count(*) FROM null_user_sender_messages)::int AS "nullUserSenderMessages",
			(SELECT count(*) FROM repairable)::int AS "repairableMessages",
			(SELECT count(*) FROM ambiguous)::int AS "ambiguousMessages",
			(SELECT count(*) FROM unmatched)::int AS "unmatchedMessages",
			0::int AS "repairedMessages"
	`;

	const writeSql = sql`
		${baseSql},
		updated AS (
			UPDATE messages m
			SET contact_id = repairable.contact_id
			FROM repairable
			WHERE m.id = repairable.message_id
				AND m.workspace_id = ${workspaceId}
				AND m.contact_id IS NULL
			RETURNING m.id
		)
		SELECT
			(SELECT count(*) FROM null_user_sender_messages)::int AS "nullUserSenderMessages",
			(SELECT count(*) FROM repairable)::int AS "repairableMessages",
			(SELECT count(*) FROM ambiguous)::int AS "ambiguousMessages",
			(SELECT count(*) FROM unmatched)::int AS "unmatchedMessages",
			(SELECT count(*) FROM updated)::int AS "repairedMessages"
	`;

	const rows = (await db.execute(options.write ? writeSql : countSql)) as Array<{
		nullUserSenderMessages: unknown;
		repairableMessages: unknown;
		ambiguousMessages: unknown;
		unmatchedMessages: unknown;
		repairedMessages: unknown;
	}>;
	const row = rows[0];
	return {
		workspaceId,
		writeMode: Boolean(options.write),
		nullUserSenderMessages: asNumber(row?.nullUserSenderMessages),
		repairableMessages: asNumber(row?.repairableMessages),
		ambiguousMessages: asNumber(row?.ambiguousMessages),
		unmatchedMessages: asNumber(row?.unmatchedMessages),
		repairedMessages: asNumber(row?.repairedMessages),
	};
}

export async function getNullContactSenderMetadataGap(
	workspaceId: string,
	chatId: string,
): Promise<number> {
	const rows = await db
		.select({
			count: sql<number>`count(*)::int`,
		})
		.from(messages)
		.where(
			and(
				eq(messages.workspaceId, workspaceId),
				eq(messages.chatId, chatId),
				isNull(messages.contactId),
				or(isNull(messages.telegramSenderId), isNull(messages.telegramSenderType)),
			),
		)
		.limit(1);

	return asNumber(rows[0]?.count);
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
	options?: {
		limit?: number;
		offset?: number;
		beforeSentAt?: Date;
		beforeMessageId?: string;
		order?: 'asc' | 'desc';
	},
) {
	const limit = options?.limit ?? 50;
	const offset = options?.offset ?? 0;
	const conditions = [eq(messages.workspaceId, workspaceId), eq(messages.contactId, contactId)];
	if (options?.beforeSentAt) {
		const cursorCondition = options.beforeMessageId
			? or(
					lt(messages.sentAt, options.beforeSentAt),
					and(eq(messages.sentAt, options.beforeSentAt), lt(messages.id, options.beforeMessageId)),
				)
			: lt(messages.sentAt, options.beforeSentAt);
		if (cursorCondition) conditions.push(cursorCondition);
	}

	return withKeys(envelope, async () => {
		return await db
			.select()
			.from(messages)
			.where(and(...conditions))
			.orderBy(
				options?.order === 'asc' ? asc(messages.sentAt) : desc(messages.sentAt),
				options?.order === 'asc' ? asc(messages.id) : desc(messages.id),
			)
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
