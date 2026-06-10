import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { encryptedText } from './custom-types';
import { deals } from './deals';
import { workspaces } from './workspaces';

export const dealDecisions = pgTable(
	'deal_decisions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id, { onDelete: 'cascade' })
			.notNull(),
		dealId: uuid('deal_id')
			.references(() => deals.id, { onDelete: 'cascade' })
			.notNull(),
		decisionType: text('decision_type').default('manual').notNull(),
		sourceType: text('source_type').default('manual').notNull(),
		status: text('status').default('accepted').notNull(),
		label: encryptedText('label').notNull(),
		rationale: encryptedText('rationale'),
		decidedAt: timestamp('decided_at', { withTimezone: true }).defaultNow().notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('deal_decisions_workspace_deal_idx').on(table.workspaceId, table.dealId),
		index('deal_decisions_status_idx').on(table.workspaceId, table.status),
	],
);
