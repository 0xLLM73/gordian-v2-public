import {
	boolean,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from 'drizzle-orm/pg-core';
import { encryptedText } from './custom-types';
import { users } from './users';
import { workspaces } from './workspaces';

export const communicationStyleEnum = pgEnum('communication_style', [
	'formal',
	'casual',
	'direct',
	'diplomatic',
]);

export const riskToleranceEnum = pgEnum('risk_tolerance', [
	'conservative',
	'moderate',
	'aggressive',
]);

export const detailPreferenceEnum = pgEnum('detail_preference', [
	'high_level',
	'balanced',
	'granular',
]);

export const relationshipFocusEnum = pgEnum('relationship_focus', ['breadth', 'balanced', 'depth']);

export const decisionSpeedEnum = pgEnum('decision_speed', ['deliberate', 'moderate', 'fast']);

export const commitmentSensitivityEnum = pgEnum('commitment_sensitivity', [
	'everything',
	'specific',
	'tasks_only',
]);

export const userRoleEnum = pgEnum('user_role', [
	'vc_investor',
	'founder',
	'bd',
	'community',
	'developer',
	'other',
]);

export const primaryGoalEnum = pgEnum('primary_goal', [
	'commitments',
	'reconnect',
	'network',
	'deal_flow',
]);

export const userCalibrations = pgTable(
	'user_calibrations',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),

		// Dimension: Communication
		communicationStyle: communicationStyleEnum('communication_style').notNull().default('direct'),
		detailPreference: detailPreferenceEnum('detail_preference').notNull().default('balanced'),

		// Dimension: Decision Making
		riskTolerance: riskToleranceEnum('risk_tolerance').notNull().default('moderate'),
		decisionSpeed: decisionSpeedEnum('decision_speed').notNull().default('moderate'),

		// Dimension: Relationships
		relationshipFocus: relationshipFocusEnum('relationship_focus').notNull().default('balanced'),
		priorities: text('priorities').array().notNull().default([]),

		// Dimension: Commitment Sensitivity (Coffee Test)
		commitmentSensitivity: commitmentSensitivityEnum('commitment_sensitivity')
			.notNull()
			.default('specific'),
		priorityContactIds: text('priority_contact_ids').array().notNull().default([]),

		// Dimension: Role & Goal (onboarding — What Matters page)
		userRole: userRoleEnum('user_role'),
		primaryGoal: primaryGoalEnum('primary_goal'),

		// Dimension: Professional Focus
		industryFocus: text('industry_focus').array().notNull().default([]),
		/** Encrypted free-text: user's role/title */
		roleDescription: encryptedText('role_description'),

		// Dimension: Investment Profile (optional)
		/** Encrypted free-text: user's investment thesis or working style */
		investmentThesis: encryptedText('investment_thesis'),
		ticketSizeMin: integer('ticket_size_min'), // USD cents
		ticketSizeMax: integer('ticket_size_max'), // USD cents

		// Consent (GDPR compliance — persisted to DB, not sessionStorage)
		consentDataProcessing: boolean('consent_data_processing').notNull().default(false),
		consentAiAnalysis: boolean('consent_ai_analysis').notNull().default(false),
		consentTelegramAccess: boolean('consent_telegram_access').notNull().default(false),
		consentTimestamp: timestamp('consent_timestamp', { withTimezone: true }),
		consentVersion: integer('consent_version').notNull().default(1),

		// Versioning
		calibrationVersion: integer('calibration_version').notNull().default(1),
		completedAt: timestamp('completed_at', { withTimezone: true }),

		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		unique('uq_calibration_user_workspace').on(table.userId, table.workspaceId),
		index('user_calibrations_workspace_idx').on(table.workspaceId),
		index('user_calibrations_user_idx').on(table.userId),
	],
);

export type UserCalibration = typeof userCalibrations.$inferSelect;
export type NewUserCalibration = typeof userCalibrations.$inferInsert;
