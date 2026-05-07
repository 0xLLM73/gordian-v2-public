import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { contacts } from './contacts';
import { encryptedText } from './custom-types';
import { summaryStatusEnum } from './enums';
import { workspaces } from './workspaces';

export const contactSummaries = pgTable('contact_summaries', {
	id: uuid('id').primaryKey().defaultRandom(),
	workspaceId: uuid('workspace_id')
		.references(() => workspaces.id)
		.notNull(),
	contactId: uuid('contact_id')
		.references(() => contacts.id)
		.notNull(),
	/** Encrypted AI-generated summary text (up to ~1500 tokens) */
	summary: encryptedText('summary'),
	/** Which Claude model was used */
	model: text('model').notNull(),
	/** Number of messages used as input for generation */
	messageCount: integer('message_count').notNull(),
	/** Summary generation status */
	status: summaryStatusEnum('status').default('generating').notNull(),
	/** Bandit trace ID for style variant feedback */
	banditTraceId: uuid('bandit_trace_id'),
	/** Which style variant was used */
	styleVariant: text('style_variant'),
	generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
