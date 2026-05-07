import {
	boolean,
	integer,
	jsonb,
	pgTable,
	real,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { workspaces } from './workspaces';

export const voiceProfiles = pgTable(
	'voice_profiles',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.references(() => users.id)
			.notNull(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id)
			.notNull(),

		// Structure
		avgMessageLength: real('avg_message_length').default(0).notNull(),
		medianMessageLength: real('median_message_length').default(0).notNull(),
		avgWordCount: real('avg_word_count').default(0).notNull(),
		avgSentenceCount: real('avg_sentence_count').default(0).notNull(),

		// Punctuation
		exclamationRate: real('exclamation_rate').default(0).notNull(),
		questionRate: real('question_rate').default(0).notNull(),
		ellipsisRate: real('ellipsis_rate').default(0).notNull(),
		allCapsRate: real('all_caps_rate').default(0).notNull(),

		// Expression
		emojiRate: real('emoji_rate').default(0).notNull(),
		emojiTopN: jsonb('emoji_top_n').default([]),

		// Formality
		contractionRate: real('contraction_rate').default(0).notNull(),
		slangRate: real('slang_rate').default(0).notNull(),
		greetingRate: real('greeting_rate').default(0).notNull(),
		signoffRate: real('signoff_rate').default(0).notNull(),

		// Conversational
		questionAskRate: real('question_ask_rate').default(0).notNull(),
		initiationRate: real('initiation_rate').default(0).notNull(),

		// Vocabulary
		avgUniqueWordRatio: real('avg_unique_word_ratio').default(0).notNull(),
		fillerWordRate: real('filler_word_rate').default(0).notNull(),

		// Rich AI analysis (nullable — only populated when voice_profile_ai flag is on)
		richSummary: text('rich_summary'),
		richTone: text('rich_tone'),
		richStructure: text('rich_structure'),
		codeSwitchingSummary: text('code_switching_summary'),
		configRecommendations: jsonb('config_recommendations'),

		// Meta
		sampleSize: integer('sample_size').default(0).notNull(),
		profileVersion: integer('profile_version').default(1).notNull(),
		calibrationComplete: boolean('calibration_complete').default(false).notNull(),
		lastAnalyzedAt: timestamp('last_analyzed_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex('voice_profiles_user_workspace_uniq').on(table.userId, table.workspaceId),
	],
);
