import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { encryptedText } from './custom-types';
import { dealDecisions } from './deal-decisions';
import { deals } from './deals';
import { workspaces } from './workspaces';

export const dealEvidenceLinks = pgTable(
	'deal_evidence_links',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id, { onDelete: 'cascade' })
			.notNull(),
		dealId: uuid('deal_id')
			.references(() => deals.id, { onDelete: 'cascade' })
			.notNull(),
		decisionId: uuid('decision_id').references(() => dealDecisions.id, { onDelete: 'set null' }),
		sourceType: text('source_type').notNull(),
		sourceId: uuid('source_id'),
		label: encryptedText('label'),
		summary: encryptedText('summary'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('deal_evidence_links_workspace_deal_idx').on(table.workspaceId, table.dealId),
		index('deal_evidence_links_decision_idx').on(table.workspaceId, table.decisionId),
		index('deal_evidence_links_source_idx').on(table.workspaceId, table.sourceType, table.sourceId),
	],
);
