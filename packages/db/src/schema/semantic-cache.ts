import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { encryptedText, halfvec } from './custom-types';
import { workspaces } from './workspaces';

/**
 * Semantic cache — stores LLM responses keyed by masked query hash + embedding.
 *
 * Lookup order:
 * 1. Exact match on query_hash (fast path)
 * 2. Cosine similarity on query_embedding > 0.95 (semantic fallback)
 *
 * Security:
 * - query_hash is SHA-256 of ELM-masked query, never raw text
 * - masked_query stores the already-masked version (safe plaintext)
 * - response is encryptedText (AES-256-GCM via DEK)
 * - workspace_id in every query (SEC-050)
 */
export const semanticCache = pgTable(
	'semantic_cache',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		queryEmbedding: halfvec('query_embedding'),
		queryHash: text('query_hash').notNull(),
		maskedQuery: text('masked_query').notNull(),
		response: encryptedText('response').notNull(),
		toolsUsed: text('tools_used').array().notNull().default([]),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	},
	(table) => [
		index('semantic_cache_workspace_hash_idx').on(table.workspaceId, table.queryHash),
		index('semantic_cache_expires_at_idx').on(table.expiresAt),
	],
);
