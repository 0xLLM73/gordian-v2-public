import { integer, jsonb, pgTable, real, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { contacts } from './contacts';
import { dominantToneEnum } from './enums';
import { workspaces } from './workspaces';

export const contactStyleOverrides = pgTable(
	'contact_style_overrides',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id)
			.notNull(),
		contactId: uuid('contact_id')
			.references(() => contacts.id)
			.notNull(),

		// Absolute features (same shape as voice_profiles — enables weighted averaging)
		avgMessageLength: real('avg_message_length').default(0).notNull(),
		emojiRate: real('emoji_rate').default(0).notNull(),
		contractionRate: real('contraction_rate').default(0).notNull(),
		exclamationRate: real('exclamation_rate').default(0).notNull(),
		questionAskRate: real('question_ask_rate').default(0).notNull(),
		greetingRate: real('greeting_rate').default(0).notNull(),
		signoffRate: real('signoff_rate').default(0).notNull(),
		slangRate: real('slang_rate').default(0).notNull(),
		avgWordCount: real('avg_word_count').default(0).notNull(),
		fillerWordRate: real('filler_word_rate').default(0).notNull(),
		avgUniqueWordRatio: real('avg_unique_word_ratio').default(0).notNull(),
		emojiTopN: jsonb('emoji_top_n').default([]),

		// Deviation signals (computed by nightly aggregation relative to base profile)
		lengthMultiplier: real('length_multiplier').default(1).notNull(),
		formalityShift: real('formality_shift').default(0).notNull(),
		emojiMultiplier: real('emoji_multiplier').default(1).notNull(),
		dominantTone: dominantToneEnum('dominant_tone').default('casual').notNull(),

		// Meta
		sampleSize: integer('sample_size').default(0).notNull(),
		lastAnalyzedAt: timestamp('last_analyzed_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [uniqueIndex('contact_style_overrides_uniq').on(table.workspaceId, table.contactId)],
);
