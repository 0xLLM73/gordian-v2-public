import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { contacts } from './contacts';
import { encryptedText, halfvec } from './custom-types';
import { workspaces } from './workspaces';

export const outcomeTypeEnum = pgEnum('outcome_type', [
	'deal_closed',
	'commitment_fulfilled',
	'commitment_missed',
	'goal_completed',
	'intro_connected',
	'relationship_health',
]);

export const outcomeResultEnum = pgEnum('outcome_result', ['positive', 'negative', 'neutral']);

/**
 * Outcome records — deterministic events that mark terminal states for deals,
 * commitments, goals, and introductions. Used for precedent search via cosine
 * similarity over context_label embeddings.
 *
 * PII guard: context_labels stores category labels only (e.g. ['defi', '45d_cycle']).
 * Contact names, handles, or Telegram IDs must NOT appear in this column.
 * notes uses encryptedText — plaintext never stored.
 * Embeddings are derived from context_labels, never from raw notes.
 *
 * NOTE: The HNSW index on embedding is created in migration 0027_outcomes.sql,
 * not via Drizzle (halfvec is a customType without .op() support).
 */
export const outcomes = pgTable(
	'outcomes',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		/** Nullable — some outcomes are workspace-level (e.g. goal_completed without a contact) */
		contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
		type: outcomeTypeEnum('type').notNull(),
		result: outcomeResultEnum('result').notNull(),
		/** Category labels only — no PII (e.g. ['defi', 'token_sale', '45d_cycle']) */
		contextLabels: text('context_labels').array().notNull().default([]),
		/** Optional user-facing notes — always encrypted */
		notes: encryptedText('notes'),
		/** Derived from context_labels — never from raw notes. halfvec(512) P3. */
		embedding: halfvec('embedding'),
		occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index('outcomes_workspace_type_idx').on(table.workspaceId, table.type),
		index('outcomes_workspace_contact_idx').on(table.workspaceId, table.contactId),
		index('outcomes_occurred_at_idx').on(table.occurredAt),
	],
);
