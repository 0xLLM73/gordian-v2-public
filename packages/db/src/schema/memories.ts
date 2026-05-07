import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { contacts } from './contacts';
import { encryptedText, halfvec } from './custom-types';
import { memoryCategoryEnum } from './enums';
import { workspaces } from './workspaces';

/**
 * Memories table — Drizzle schema for TYPE GENERATION only.
 *
 * CRITICAL: Do NOT use drizzle-kit push for this table.
 * The actual table is created via raw SQL migration (0004_memories.sql)
 * because it uses LIST PARTITIONING by category (23 partitions),
 * which Drizzle cannot express.
 *
 * This schema exists so Drizzle can generate TypeScript types
 * and we can use the query builder for SELECT/INSERT.
 */
export const memories = pgTable('memories', {
	id: uuid('id').defaultRandom(),
	workspaceId: uuid('workspace_id')
		.references(() => workspaces.id)
		.notNull(),
	contactId: uuid('contact_id').references(() => contacts.id),
	category: memoryCategoryEnum('category').notNull(),
	content: encryptedText('content').notNull(),
	/** Entity-Linked Masked version for embedding — NEVER raw PII */
	contentSanitized: text('content_sanitized'),
	/** halfvec(512) — P3 reduced from 1536 for cost optimization */
	embedding: halfvec('embedding'),
	metadata: jsonb('metadata').default({}),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
