import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { contacts } from './contacts';
import { blindIndex, encryptedText } from './custom-types';
import { workspaces } from './workspaces';

export const calendarConnections = pgTable(
	'calendar_connections',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id)
			.notNull(),
		provider: text('provider').default('google').notNull(),
		/** Encrypted OAuth access token */
		accessToken: encryptedText('access_token'),
		/** Encrypted OAuth refresh token */
		refreshToken: encryptedText('refresh_token'),
		/** Token expiration timestamp */
		expiresAt: timestamp('expires_at', { withTimezone: true }),
		/** Calendar email address */
		email: encryptedText('email'),
		emailBlindIndex: blindIndex('email_blind_index'),
		/** Last successful sync timestamp */
		lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('calendar_connections_workspace_idx').on(table.workspaceId),
		index('calendar_connections_email_bidx_idx').on(table.emailBlindIndex),
	],
);

export const calendarEvents = pgTable(
	'calendar_events',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id)
			.notNull(),
		connectionId: uuid('connection_id')
			.references(() => calendarConnections.id, { onDelete: 'cascade' })
			.notNull(),
		/** External event ID from provider (e.g., Google Calendar event ID) */
		externalId: text('external_id').notNull(),
		title: encryptedText('title'),
		description: encryptedText('description'),
		startTime: timestamp('start_time', { withTimezone: true }).notNull(),
		endTime: timestamp('end_time', { withTimezone: true }),
		location: encryptedText('location'),
		/** Matched contact from attendee list */
		contactId: uuid('contact_id').references(() => contacts.id),
		/** Attendees — JSON.stringify on write, JSON.parse on read (encrypted) */
		attendees: encryptedText('attendees'),
		/** Event metadata: { htmlLink?, status?, organizer? } */
		metadata: jsonb('metadata').default({}),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('calendar_events_workspace_idx').on(table.workspaceId),
		index('calendar_events_external_idx').on(table.connectionId, table.externalId),
		index('calendar_events_contact_idx').on(table.workspaceId, table.contactId),
		index('calendar_events_time_idx').on(table.workspaceId, table.startTime),
	],
);
