import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { encryptedJson, encryptedText } from './custom-types';
import { deals } from './deals';
import { workspaces } from './workspaces';

export const dealAiRuns = pgTable(
	'deal_ai_runs',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id, { onDelete: 'cascade' })
			.notNull(),
		dealId: uuid('deal_id')
			.references(() => deals.id, { onDelete: 'cascade' })
			.notNull(),
		runType: text('run_type').notNull(),
		status: text('status').default('draft').notNull(),
		modelRole: text('model_role').notNull(),
		modelName: text('model_name').notNull(),
		localVendorMode: text('local_vendor_mode').default('local').notNull(),
		output: encryptedText('output').notNull(),
		uncertainty: encryptedText('uncertainty'),
		sourceManifest: encryptedJson('source_manifest')
			.$type<Array<Record<string, unknown>>>()
			.notNull(),
		acceptedAt: timestamp('accepted_at', { withTimezone: true }),
		dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('deal_ai_runs_workspace_deal_idx').on(table.workspaceId, table.dealId),
		index('deal_ai_runs_status_idx').on(table.workspaceId, table.status),
		index('deal_ai_runs_type_idx').on(table.workspaceId, table.runType),
	],
);
