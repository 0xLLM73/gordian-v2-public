import {
	index,
	integer,
	jsonb,
	numeric,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
} from 'drizzle-orm/pg-core';
import { contacts } from './contacts';
import { workspaces } from './workspaces';

export const watchlistStatusEnum = pgEnum('watchlist_status', ['watching', 'archived']);

export const tokenMentions = pgTable(
	'token_mentions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id)
			.notNull(),
		contactId: uuid('contact_id').references(() => contacts.id),
		symbol: text('symbol').notNull(),
		name: text('name'),
		context: text('context'),
		confidence: numeric('confidence', { precision: 3, scale: 2 }),
		mentionedAt: timestamp('mentioned_at', { withTimezone: true }).defaultNow().notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('token_mentions_workspace_idx').on(table.workspaceId),
		index('token_mentions_symbol_idx').on(table.workspaceId, table.symbol),
		index('token_mentions_contact_idx').on(table.workspaceId, table.contactId),
	],
);

export const tokenWatchlist = pgTable(
	'token_watchlist',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id)
			.notNull(),
		symbol: text('symbol').notNull(),
		name: text('name'),
		coingeckoId: text('coingecko_id'),
		lastPrice: numeric('last_price', { precision: 18, scale: 8 }),
		priceChange24h: numeric('price_change_24h', { precision: 10, scale: 4 }),
		marketCap: numeric('market_cap', { precision: 24, scale: 2 }),
		mentionCount: integer('mention_count').default(0).notNull(),
		status: watchlistStatusEnum('status').default('watching').notNull(),
		priceData: jsonb('price_data'),
		lastPriceUpdate: timestamp('last_price_update', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('token_watchlist_workspace_idx').on(table.workspaceId),
		index('token_watchlist_symbol_idx').on(table.workspaceId, table.symbol),
	],
);
