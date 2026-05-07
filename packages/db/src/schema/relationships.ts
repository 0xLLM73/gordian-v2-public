import { index, jsonb, pgTable, real, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { contacts } from './contacts';
import { encryptedText } from './custom-types';
import { relationshipSourceEnum, relationshipTypeEnum } from './enums';
import { workspaces } from './workspaces';

export const contactRelationships = pgTable(
	'contact_relationships',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id)
			.notNull(),
		sourceContactId: uuid('source_contact_id')
			.references(() => contacts.id)
			.notNull(),
		targetContactId: uuid('target_contact_id')
			.references(() => contacts.id)
			.notNull(),
		relationshipType: relationshipTypeEnum('relationship_type').notNull(),
		/** Strength score 0.0-1.0 (default 0.5) */
		strength: real('strength').default(0.5).notNull(),
		source: relationshipSourceEnum('source').default('ai_extracted').notNull(),
		/** Evidence snippets and reasoning from extraction */
		evidence: jsonb('evidence').default({}),
		notes: encryptedText('notes'),
		sharingLevel: text('sharing_level').default('private').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('cr_workspace_idx').on(table.workspaceId),
		index('cr_source_contact_idx').on(table.sourceContactId),
		index('cr_target_contact_idx').on(table.targetContactId),
		unique('unique_relationship_edge').on(
			table.workspaceId,
			table.sourceContactId,
			table.targetContactId,
			table.relationshipType,
		),
	],
);
