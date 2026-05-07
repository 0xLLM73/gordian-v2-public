import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { contacts } from './contacts';
import { encryptedText } from './custom-types';
import { deals } from './deals';
import { dealParticipantRoleEnum } from './enums';
import { workspaces } from './workspaces';

export const dealParticipants = pgTable(
	'deal_participants',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id)
			.notNull(),
		dealId: uuid('deal_id')
			.references(() => deals.id, { onDelete: 'cascade' })
			.notNull(),
		contactId: uuid('contact_id')
			.references(() => contacts.id)
			.notNull(),
		role: dealParticipantRoleEnum('role').default('other').notNull(),
		notes: encryptedText('notes'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		/** DECISION 6: Future-proofing for team sharing */
		sharingLevel: text('sharing_level').default('private').notNull(),
		dataClassification: text('data_classification'),
	},
	(table) => [
		index('deal_participants_deal_idx').on(table.dealId),
		index('deal_participants_contact_idx').on(table.contactId),
	],
);
