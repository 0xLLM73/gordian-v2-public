import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { contacts } from './contacts';
import { blindIndex, encryptedText } from './custom-types';
import { dealSourceEnum, dealStageEnum, dealTypeEnum } from './enums';
import { workspaces } from './workspaces';

export const deals = pgTable(
	'deals',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id)
			.notNull(),
		contactId: uuid('contact_id')
			.references(() => contacts.id)
			.notNull(),
		title: encryptedText('title').notNull(),
		titleBlindIndex: blindIndex('title_blind_index'),
		dealType: dealTypeEnum('deal_type').default('other').notNull(),
		stage: dealStageEnum('stage').default('discovery').notNull(),
		/** Value in cents to avoid floating-point issues */
		value: integer('value').notNull(),
		notes: encryptedText('notes'),
		source: dealSourceEnum('source').default('manual').notNull(),
		/** Flexible terms: { discount?, valuationCap?, vestingCliff?, vestingPeriod?, exercisePrice?, ... } */
		terms: jsonb('terms').default({}),
		/** Array of { stage, timestamp, note? } for pipeline timeline */
		stageHistory: jsonb('stage_history').default([]),
		closedAt: timestamp('closed_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
		/** DECISION 6: Future-proofing for team sharing */
		sharingLevel: text('sharing_level').default('private').notNull(),
		dataClassification: text('data_classification'),
	},
	(table) => [
		index('deals_workspace_idx').on(table.workspaceId),
		index('deals_stage_idx').on(table.stage),
		index('deals_type_idx').on(table.dealType),
		index('deals_title_bidx_idx').on(table.titleBlindIndex),
	],
);
