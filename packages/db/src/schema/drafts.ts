import { boolean, integer, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { contacts } from './contacts';
import { encryptedText } from './custom-types';
import { draftArmEnum } from './enums';
import { workspaces } from './workspaces';

export const draftLogs = pgTable('draft_logs', {
	id: uuid('id').primaryKey().defaultRandom(),
	workspaceId: uuid('workspace_id')
		.references(() => workspaces.id)
		.notNull(),
	contactId: uuid('contact_id')
		.references(() => contacts.id)
		.notNull(),
	armType: draftArmEnum('arm_type').notNull(),
	generatedText: encryptedText('generated_text').notNull(),
	editedText: encryptedText('edited_text'),
	editDistance: integer('edit_distance'),
	wasSent: boolean('was_sent').default(false).notNull(),
	wasDiscarded: boolean('was_discarded').default(false).notNull(),
	styleProfileVersion: integer('style_profile_version'),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	sentAt: timestamp('sent_at', { withTimezone: true }),
});
