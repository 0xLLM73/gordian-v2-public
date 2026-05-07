import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { blindIndex, encryptedText } from './custom-types';
import { workspaces } from './workspaces';

export const contacts = pgTable(
	'contacts',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id)
			.notNull(),
		telegramId: text('telegram_id'),
		/** Telegram account ID that discovered this contact (NULL = legacy, visible to all) */
		sourceAccountId: text('source_account_id'),
		// Encrypted fields
		firstName: encryptedText('first_name'),
		lastName: encryptedText('last_name'),
		phone: encryptedText('phone'),
		email: encryptedText('email'),
		notes: encryptedText('notes'),
		// Blind indexes for search (HMAC-SHA256, 64-bit truncated, Base64)
		firstNameBidx: blindIndex('first_name_bidx'),
		lastNameBidx: blindIndex('last_name_bidx'),
		phoneBidx: blindIndex('phone_bidx'),
		emailBidx: blindIndex('email_bidx'),
		// Inline recency (Feature 6) — maintained during sync, not via 24h cron
		lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
		messageCount: integer('message_count').notNull().default(0),
		/** Timestamp when user dismissed the ghosting alert for this contact */
		ghostingDismissedAt: timestamp('ghosting_dismissed_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('contacts_workspace_idx').on(table.workspaceId),
		index('contacts_source_account_idx').on(table.workspaceId, table.sourceAccountId),
		index('contacts_first_name_bidx_idx').on(table.firstNameBidx),
		index('contacts_last_name_bidx_idx').on(table.lastNameBidx),
		index('contacts_phone_bidx_idx').on(table.phoneBidx),
		index('contacts_email_bidx_idx').on(table.emailBidx),
	],
);
