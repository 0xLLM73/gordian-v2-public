import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { encryptedText } from './custom-types';
import { users } from './users';
import { workspaces } from './workspaces';

export const briefs = pgTable('briefs', {
	id: uuid('id').primaryKey().defaultRandom(),
	workspaceId: uuid('workspace_id')
		.references(() => workspaces.id)
		.notNull(),
	userId: uuid('user_id')
		.references(() => users.id)
		.notNull(),

	/** Encrypted brief text */
	content: encryptedText('content'),

	/** Bandit trace IDs for feedback loop */
	toneTraceId: uuid('tone_trace_id'),
	detailTraceId: uuid('detail_trace_id'),
	toneVariant: text('tone_variant'),
	detailVariant: text('detail_variant'),

	/** User feedback: null = no feedback, true = helpful, false = not helpful */
	feedback: boolean('feedback'),
	feedbackAt: timestamp('feedback_at', { withTimezone: true }),

	generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
