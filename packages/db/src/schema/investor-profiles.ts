import {
	bigint,
	index,
	integer,
	pgEnum,
	pgTable,
	real,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core';
import { contacts } from './contacts';
import { workspaces } from './workspaces';

export const activityTrendEnum = pgEnum('activity_trend', ['heating_up', 'steady', 'cooling_down']);

/**
 * Computed investor intelligence profile per contact per workspace.
 * Values derived by the investor-patterns computation functions (no LLM).
 * Upserted on deal stage change + nightly batch.
 *
 * PII check: sector_focus, token_interests, preferred_role must contain
 * sector/category labels only — NOT contact names, handles, or identifiers.
 */
export const investorProfiles = pgTable(
	'investor_profiles',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		contactId: uuid('contact_id')
			.notNull()
			.references(() => contacts.id, { onDelete: 'cascade' }),
		dealCount: integer('deal_count').notNull().default(0),
		/** Ratio of won deals to total completed deals (0.0–1.0) */
		winRate: real('win_rate').notNull().default(0),
		/** Average days from deal creation to close */
		avgCycleDays: integer('avg_cycle_days').notNull().default(0),
		/** e.g. 'lead', 'co_investor', 'advisor' — category label, not a contact name */
		preferredRole: text('preferred_role'),
		/** e.g. ['DeFi', 'Infrastructure', 'Gaming'] — no PII */
		sectorFocus: text('sector_focus').array(),
		/** USD cents — null if no completed deals */
		ticketMin: bigint('ticket_min', { mode: 'number' }),
		ticketMax: bigint('ticket_max', { mode: 'number' }),
		/** e.g. ['ETH', 'SOL'] — token symbols only, no contact identifiers */
		tokenInterests: text('token_interests').array(),
		activityTrend: activityTrendEnum('activity_trend').notNull().default('steady'),
		computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex('investor_profiles_workspace_contact_uniq').on(table.workspaceId, table.contactId),
		index('investor_profiles_workspace_idx').on(table.workspaceId),
		index('investor_profiles_win_rate_idx').on(table.workspaceId, table.winRate),
	],
);
