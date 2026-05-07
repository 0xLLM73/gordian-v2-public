import { index, jsonb, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { contacts } from './contacts';
import { encryptedText } from './custom-types';
import { deals } from './deals';
import { workspaces } from './workspaces';

export const dealCandidates = pgTable(
	'deal_candidates',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id)
			.notNull(),
		sourceMessageId: uuid('source_message_id').notNull(),
		chatId: uuid('chat_id').notNull(),
		confidence: real('confidence').notNull(),
		contactId: uuid('contact_id').references(() => contacts.id),
		dealTitleGuess: encryptedText('deal_title_guess').notNull(),
		dealTypeGuess: text('deal_type_guess').notNull(),
		/** ELM-masked signal snippets — no raw PII */
		signals: jsonb('signals').notNull(),
		status: text('status').default('pending').notNull(),
		dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
		confirmedDealId: uuid('confirmed_deal_id').references(() => deals.id),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('dc_workspace_idx').on(table.workspaceId),
		index('dc_workspace_status_idx').on(table.workspaceId, table.status),
		index('dc_contact_idx').on(table.contactId),
	],
);
