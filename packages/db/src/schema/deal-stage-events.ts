import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { encryptedText } from './custom-types';
import { deals } from './deals';
import { dealStageEnum } from './enums';
import { workspaces } from './workspaces';

export const dealStageEvents = pgTable(
	'deal_stage_events',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id, { onDelete: 'cascade' })
			.notNull(),
		dealId: uuid('deal_id')
			.references(() => deals.id, { onDelete: 'cascade' })
			.notNull(),
		previousStage: dealStageEnum('previous_stage'),
		nextStage: dealStageEnum('next_stage').notNull(),
		source: text('source').default('manual').notNull(),
		actorType: text('actor_type').default('user').notNull(),
		note: encryptedText('note'),
		idempotencyKey: text('idempotency_key'),
		occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('deal_stage_events_workspace_deal_idx').on(table.workspaceId, table.dealId),
		index('deal_stage_events_occurred_idx').on(table.workspaceId, table.occurredAt),
		uniqueIndex('deal_stage_events_idempotency_uniq').on(
			table.workspaceId,
			table.dealId,
			table.idempotencyKey,
		),
	],
);
