import { boolean, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { digestFocusEnum } from './enums';
import { users } from './users';
import { workspaces } from './workspaces';

export const userPreferences = pgTable(
	'user_preferences',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.references(() => users.id)
			.notNull(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id)
			.notNull(),

		/** IANA timezone string, e.g., 'America/New_York' */
		timezone: text('timezone').default('UTC').notNull(),

		/** Whether morning briefs are enabled */
		briefEnabled: boolean('brief_enabled').default(true).notNull(),

		/** Hour (0-23) to send morning brief in user's timezone */
		briefTime: integer('brief_time').default(7).notNull(),

		/** Days of week to send briefs: ['mon','tue','wed','thu','fri'] */
		briefDays: text('brief_days').array().default(['mon', 'tue', 'wed', 'thu', 'fri']).notNull(),

		/** What the digest/brief emphasizes */
		digestFocus: digestFocusEnum('digest_focus').default('balanced').notNull(),

		/** Custom intro-detection keywords (additive to built-in defaults) */
		introKeywords: text('intro_keywords').array(),

		/** Which health labels trigger ghosting alerts: 'cooling', 'dormant', etc. */
		ghostingAlertStatuses: text('ghosting_alert_statuses')
			.array()
			.default(['cooling', 'dormant'])
			.notNull(),

		/** Days without contact before a relationship is considered stale */
		ghostingStaleDays: integer('ghosting_stale_days').default(30).notNull(),

		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [uniqueIndex('user_prefs_user_workspace_idx').on(table.userId, table.workspaceId)],
);
