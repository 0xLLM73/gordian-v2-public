import { integer, pgTable, real, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { halfvec } from './custom-types';

/**
 * Semantic Patterns — clustered error patterns from correction diffs.
 * Global table (no workspace_id) matching golden_dataset scope.
 * Populated by nightly DBSCAN clustering job.
 */
export const semanticPatterns = pgTable('semantic_patterns', {
	id: uuid('id').defaultRandom().primaryKey(),
	featureDomain: varchar('feature_domain', { length: 100 }).notNull(),
	patternText: text('pattern_text').notNull(),
	embedding: halfvec('embedding'),
	confidenceScore: real('confidence_score').default(0.5),
	lastReinforced: timestamp('last_reinforced', { withTimezone: true }),
	occurrenceCount: integer('occurrence_count').default(1),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
