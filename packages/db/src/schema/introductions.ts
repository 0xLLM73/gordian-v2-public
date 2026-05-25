import { boolean, index, jsonb, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { contacts } from './contacts';
import { encryptedText } from './custom-types';
import { introContextEnum, introResolutionEnum, introStatusEnum } from './enums';
import { workspaces } from './workspaces';

export const introductions = pgTable(
	'introductions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id)
			.notNull(),
		introducerContactId: uuid('introducer_contact_id')
			.references(() => contacts.id)
			.notNull(),
		introducedContactId1: uuid('introduced_contact_id_1')
			.references(() => contacts.id)
			.notNull(),
		introducedContactId2: uuid('introduced_contact_id_2')
			.references(() => contacts.id)
			.notNull(),
		context: introContextEnum('context').default('other').notNull(),
		confidence: real('confidence').notNull(),
		status: introStatusEnum('status').default('triage').notNull(),
		resolution: introResolutionEnum('resolution'),
		statusHistory: jsonb('status_history').default([]).notNull(),
		note: encryptedText('note'),
		reasoning: encryptedText('reasoning'),
		sourceMessageIds: uuid('source_message_ids').array(),
		autoConfirmed: boolean('auto_confirmed').default(false).notNull(),
		detectedAt: timestamp('detected_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
		sharingLevel: text('sharing_level').default('private').notNull(),
	},
	(table) => [
		index('introductions_workspace_introducer_idx').on(
			table.workspaceId,
			table.introducerContactId,
		),
		index('introductions_workspace_status_idx').on(table.workspaceId, table.status),
		index('introductions_workspace_resolution_idx').on(
			table.workspaceId,
			table.resolution,
			table.updatedAt,
		),
	],
);
