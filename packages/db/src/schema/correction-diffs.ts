import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { halfvec } from './custom-types';
import { diffTypeEnum } from './enums';
import { goldenDataset } from './golden-dataset';
import { workspaces } from './workspaces';

/**
 * Correction Diffs — structured error analysis for clustering.
 * Each diff records a specific type of mistake in a golden dataset prediction,
 * with an embedding of the mistake for DBSCAN clustering into semantic patterns.
 */
export const correctionDiffs = pgTable('correction_diffs', {
	id: uuid('id').defaultRandom().primaryKey(),
	workspaceId: uuid('workspace_id').references(() => workspaces.id),
	goldenId: uuid('golden_id')
		.notNull()
		.references(() => goldenDataset.id, { onDelete: 'cascade' }),
	diffType: diffTypeEnum('diff_type').notNull(),
	severityScore: integer('severity_score').notNull(),
	description: text('description'),
	mistakeEmbedding: halfvec('mistake_embedding'),
	patternId: uuid('pattern_id'),
	analyzedAt: timestamp('analyzed_at', { withTimezone: true }),
});
