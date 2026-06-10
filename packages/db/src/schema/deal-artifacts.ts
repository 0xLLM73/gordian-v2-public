import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { encryptedText } from './custom-types';
import { deals } from './deals';
import { dealArtifactTypeEnum } from './enums';
import { workspaces } from './workspaces';

export const dealArtifacts = pgTable(
	'deal_artifacts',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id)
			.notNull(),
		dealId: uuid('deal_id')
			.references(() => deals.id, { onDelete: 'cascade' })
			.notNull(),
		artifactType: dealArtifactTypeEnum('artifact_type').default('other').notNull(),
		title: encryptedText('title').notNull(),
		/** Encrypted URL or file reference (external storage, not inline content) */
		url: encryptedText('url'),
		/** Flexible metadata: { fileSize?, mimeType?, uploadedBy?, version? } */
		metadata: jsonb('metadata').default({}),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
		/** DECISION 6: Future-proofing for team sharing */
		sharingLevel: text('sharing_level').default('private').notNull(),
		dataClassification: text('data_classification').default('deal_artifact_sensitive'),
	},
	(table) => [
		index('deal_artifacts_deal_idx').on(table.dealId),
		index('deal_artifacts_type_idx').on(table.artifactType),
	],
);
