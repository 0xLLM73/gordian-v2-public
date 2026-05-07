import { index, jsonb, pgTable, real, timestamp, uuid } from 'drizzle-orm/pg-core';
import { contacts } from './contacts';
import { encryptedText } from './custom-types';
import { connectionStatusEnum } from './enums';
import { workspaces } from './workspaces';

export const connections = pgTable(
	'connections',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id)
			.notNull(),
		contactId: uuid('contact_id')
			.references(() => contacts.id)
			.notNull(),
		event: encryptedText('event'),
		context: encryptedText('context'),
		confidence: real('confidence').notNull(),
		status: connectionStatusEnum('status').default('detected').notNull(),
		statusHistory: jsonb('status_history').default([]).notNull(),
		note: encryptedText('note'),
		reasoning: encryptedText('reasoning'),
		sourceMessageIds: uuid('source_message_ids').array(),
		detectedAt: timestamp('detected_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('connections_workspace_contact_idx').on(table.workspaceId, table.contactId),
		index('connections_workspace_status_idx').on(table.workspaceId, table.status),
		// SEC-ENC-506: B-tree index on encrypted event removed — encrypted values are
		// random (IV per write), B-tree ordering is meaningless. DAL must decrypt in-memory.
	],
);
