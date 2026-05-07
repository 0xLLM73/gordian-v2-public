import { integer, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { contacts } from './contacts';
import { encryptedText, halfvec } from './custom-types';
import { commitmentStatusEnum, commitmentTypeEnum } from './enums';
import { workspaces } from './workspaces';

export const commitments = pgTable('commitments', {
	id: uuid('id').primaryKey().defaultRandom(),
	workspaceId: uuid('workspace_id')
		.references(() => workspaces.id)
		.notNull(),
	contactId: uuid('contact_id')
		.references(() => contacts.id)
		.notNull(),
	title: encryptedText('title').notNull(),
	commitmentType: commitmentTypeEnum('commitment_type').notNull(),
	status: commitmentStatusEnum('status').default('draft').notNull(),
	/** 'user' (CRM owner) or 'contact' (chat partner) */
	assignee: text('assignee').notNull(),
	/** Confidence score 0.0-1.0. <0.7 flagged for review */
	confidence: real('confidence').notNull(),
	/** ISO8601 date-time or null if vague */
	dueDate: timestamp('due_date', { withTimezone: true }),
	/** Exact substring that triggered extraction */
	quote: encryptedText('quote'),
	/** Broader conversation context the model saw at extraction time (for golden dataset training) */
	extractionContext: encryptedText('extraction_context'),
	/** halfvec for dedup cosine similarity */
	embedding: halfvec('embedding'),
	/** Age of the source message in days at extraction time (for recency-weighted first batch) */
	sourceMessageAgeDays: integer('source_message_age_days'),
	/** Trace ID linking to bandit_ledger for reward feedback */
	banditTraceId: uuid('bandit_trace_id'),
	/** Encrypted evidence text from messages showing fulfillment */
	fulfillmentEvidence: encryptedText('fulfillment_evidence'),
	/** When this commitment was last checked for fulfillment */
	lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
	/** When fulfillment was detected */
	fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
	/** Snooze active commitment until this time (visibility filter, not a status) */
	snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
