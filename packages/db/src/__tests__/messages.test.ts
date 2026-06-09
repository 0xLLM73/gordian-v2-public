import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecute = vi.hoisted(() => vi.fn());

vi.mock('../client', () => ({
	db: {
		execute: mockExecute,
	},
}));

vi.mock('@repo/crypto', () => ({
	withKeys: vi.fn((_envelope: unknown, fn: () => unknown) => fn()),
}));

import {
	getMessageContactCoverageReport,
	getMessageNullContactReasonReport,
	repairMessagesToSenderContacts,
	repairPrivateMessagesToPeerContacts,
	updateMessageSenderMetadataByTelegramIds,
} from '../dal/messages';

const WS = '11111111-1111-4111-8111-111111111111';

function sqlText(arg: unknown): string {
	const queryChunks = (arg as { queryChunks?: unknown[] } | undefined)?.queryChunks;
	if (!queryChunks) return '';
	return queryChunks
		.map((chunk) => {
			if (typeof chunk === 'string') return chunk;
			if (chunk && typeof chunk === 'object' && 'value' in chunk) {
				const value = (chunk as { value?: unknown }).value;
				return Array.isArray(value) ? value.join('') : String(value ?? '');
			}
			if (chunk && typeof chunk === 'object' && 'queryChunks' in chunk) {
				return sqlText(chunk);
			}
			return '';
		})
		.join(' ');
}

describe('message contact linkage reports', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('maps contact coverage counts by workspace and chat type', async () => {
		mockExecute
			.mockResolvedValueOnce([
				{
					totalMessages: '10',
					messagesWithSenderMetadata: '3',
					messagesWithUserSenderMetadata: '2',
					nullContactMessages: '4',
					nullContactMessagesWithSenderMetadata: '2',
					nullContactMessagesWithUserSenderMetadata: '1',
					linkedContactMessages: '6',
					chatsWithNullContactMessages: '2',
				},
			])
			.mockResolvedValueOnce([
				{
					chatType: 'supergroup',
					totalMessages: '7',
					messagesWithSenderMetadata: '3',
					messagesWithUserSenderMetadata: '2',
					nullContactMessages: '4',
					nullContactMessagesWithSenderMetadata: '2',
					nullContactMessagesWithUserSenderMetadata: '1',
					linkedContactMessages: '3',
					chatsWithNullContactMessages: '1',
				},
				{
					chatType: 'private',
					totalMessages: 3,
					messagesWithSenderMetadata: 0,
					messagesWithUserSenderMetadata: 0,
					nullContactMessages: 0,
					nullContactMessagesWithSenderMetadata: 0,
					nullContactMessagesWithUserSenderMetadata: 0,
					linkedContactMessages: 3,
					chatsWithNullContactMessages: 0,
				},
			]);

		const result = await getMessageContactCoverageReport(WS);

		expect(result).toEqual({
			workspaceId: WS,
			totalMessages: 10,
			messagesWithSenderMetadata: 3,
			messagesWithUserSenderMetadata: 2,
			nullContactMessages: 4,
			nullContactMessagesWithSenderMetadata: 2,
			nullContactMessagesWithUserSenderMetadata: 1,
			linkedContactMessages: 6,
			chatsWithNullContactMessages: 2,
			byChatType: [
				{
					chatType: 'supergroup',
					totalMessages: 7,
					messagesWithSenderMetadata: 3,
					messagesWithUserSenderMetadata: 2,
					nullContactMessages: 4,
					nullContactMessagesWithSenderMetadata: 2,
					nullContactMessagesWithUserSenderMetadata: 1,
					linkedContactMessages: 3,
					chatsWithNullContactMessages: 1,
				},
				{
					chatType: 'private',
					totalMessages: 3,
					messagesWithSenderMetadata: 0,
					messagesWithUserSenderMetadata: 0,
					nullContactMessages: 0,
					nullContactMessagesWithSenderMetadata: 0,
					nullContactMessagesWithUserSenderMetadata: 0,
					linkedContactMessages: 3,
					chatsWithNullContactMessages: 0,
				},
			],
		});
		expect(mockExecute).toHaveBeenCalledTimes(2);
		expect(sqlText(mockExecute.mock.calls[0]?.[0])).toContain('FROM messages m');
		expect(sqlText(mockExecute.mock.calls[0]?.[0])).toContain('telegram_sender_type =');
		expect(sqlText(mockExecute.mock.calls[1]?.[0])).toContain('GROUP BY ch.type');
	});

	it('fills sender metadata for duplicate message rows without overwriting existing values', async () => {
		const mockReturning = vi.fn().mockResolvedValue([{ id: 'message-1' }]);
		const mockWhere = vi.fn(() => ({ returning: mockReturning }));
		const mockSet = vi.fn(() => ({ where: mockWhere }));
		const mockUpdate = vi.fn(() => ({ set: mockSet }));
		const { db } = await import('../client');
		(db as unknown as { update: typeof mockUpdate }).update = mockUpdate;

		const updated = await updateMessageSenderMetadataByTelegramIds(WS, 'chat-1', [
			{ telegramMessageId: '10', telegramSenderId: 'sender-1', telegramSenderType: 'user' },
			{ telegramMessageId: '10', telegramSenderId: 'sender-1', telegramSenderType: 'user' },
			{ telegramMessageId: '', telegramSenderId: 'sender-2', telegramSenderType: 'user' },
		]);

		expect(updated).toBe(1);
		expect(mockUpdate).toHaveBeenCalledTimes(1);
		expect(mockSet).toHaveBeenCalledWith(
			expect.objectContaining({
				telegramSenderId: expect.any(Object),
				telegramSenderType: expect.any(Object),
			}),
		);
		const whereCalls = mockWhere.mock.calls as unknown[][];
		const query = sqlText(whereCalls[0]?.[0]);
		expect(query).toContain('is null');
	});

	it('maps null-contact messages into reason buckets', async () => {
		mockExecute.mockResolvedValueOnce([
			{
				reason: 'group_sender_metadata_missing',
				chatType: 'supergroup',
				nullMessages: '11',
				chatsAffected: '2',
			},
			{
				reason: 'private_peer_contact_missing',
				chatType: 'private',
				nullMessages: 3,
				chatsAffected: 1,
			},
		]);

		const result = await getMessageNullContactReasonReport(WS);

		expect(result).toEqual({
			workspaceId: WS,
			totalNullMessages: 14,
			reasons: [
				{
					reason: 'group_sender_metadata_missing',
					chatType: 'supergroup',
					nullMessages: 11,
					chatsAffected: 2,
				},
				{
					reason: 'private_peer_contact_missing',
					chatType: 'private',
					nullMessages: 3,
					chatsAffected: 1,
				},
			],
		});
		const query = sqlText(mockExecute.mock.calls[0]?.[0]);
		expect(query).toContain('WITH null_messages AS');
		expect(query).toContain('sender_contact_candidates');
		expect(query).toContain('group_sender_metadata_missing');
	});

	it('keeps private peer repair dry-run read-only', async () => {
		mockExecute.mockResolvedValueOnce([
			{
				privateNullMessages: '5',
				repairableMessages: '3',
				ambiguousMessages: '1',
				unmatchedMessages: '1',
				repairedMessages: '0',
			},
		]);

		const result = await repairPrivateMessagesToPeerContacts(WS);

		expect(result).toEqual({
			workspaceId: WS,
			writeMode: false,
			privateNullMessages: 5,
			repairableMessages: 3,
			ambiguousMessages: 1,
			unmatchedMessages: 1,
			repairedMessages: 0,
		});
		const query = sqlText(mockExecute.mock.calls[0]?.[0]);
		expect(query).toContain("ch.type = 'private'");
		expect(query).toContain('c.telegram_id = p.telegram_chat_id');
		expect(query).not.toContain('UPDATE messages');
	});

	it('updates only repairable private peer messages in write mode', async () => {
		mockExecute.mockResolvedValueOnce([
			{
				privateNullMessages: 5,
				repairableMessages: 3,
				ambiguousMessages: 1,
				unmatchedMessages: 1,
				repairedMessages: 3,
			},
		]);

		const result = await repairPrivateMessagesToPeerContacts(WS, { write: true });

		expect(result.repairedMessages).toBe(3);
		expect(result.writeMode).toBe(true);
		const query = sqlText(mockExecute.mock.calls[0]?.[0]);
		expect(query).toContain('UPDATE messages m');
		expect(query).toContain('SET contact_id = repairable.contact_id');
		expect(query).toContain('m.contact_id IS NULL');
	});

	it('repairs null contact rows using persisted user sender metadata only', async () => {
		mockExecute.mockResolvedValueOnce([
			{
				nullUserSenderMessages: '8',
				repairableMessages: '5',
				ambiguousMessages: '1',
				unmatchedMessages: '2',
				repairedMessages: '0',
			},
		]);

		const result = await repairMessagesToSenderContacts(WS);

		expect(result).toEqual({
			workspaceId: WS,
			writeMode: false,
			nullUserSenderMessages: 8,
			repairableMessages: 5,
			ambiguousMessages: 1,
			unmatchedMessages: 2,
			repairedMessages: 0,
		});
		const query = sqlText(mockExecute.mock.calls[0]?.[0]);
		expect(query).toContain("m.telegram_sender_type = 'user'");
		expect(query).toContain('c.telegram_id = m.telegram_sender_id');
		expect(query).not.toContain('UPDATE messages');
	});
});
