import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { encryptedText } from './custom-types';
import { digestPeriodEnum, digestStatusEnum } from './enums';
import { users } from './users';
import { workspaces } from './workspaces';

export const digests = pgTable('digests', {
	id: uuid('id').primaryKey().defaultRandom(),
	workspaceId: uuid('workspace_id')
		.references(() => workspaces.id)
		.notNull(),
	userId: uuid('user_id')
		.references(() => users.id)
		.notNull(),

	/** Time period covered */
	period: digestPeriodEnum('period').notNull(),
	/** Start of the time window */
	periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
	/** End of the time window */
	periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),

	/** Encrypted full digest text (rendered markdown) */
	content: encryptedText('content'),

	/** Structured sections as JSON for rich UI rendering */
	sections: jsonb('sections'),

	/** Generation metadata */
	status: digestStatusEnum('status').default('generating').notNull(),
	model: text('model'),
	messageCount: integer('message_count'),
	contactCount: integer('contact_count'),

	/** Bandit trace IDs for feedback */
	styleTraceId: uuid('style_trace_id'),
	toneTraceId: uuid('tone_trace_id'),
	styleVariant: text('style_variant'),
	toneVariant: text('tone_variant'),

	generatedAt: timestamp('generated_at', { withTimezone: true }),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
