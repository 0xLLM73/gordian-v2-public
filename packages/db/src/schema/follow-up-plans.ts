import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { contacts } from './contacts';
import { encryptedText } from './custom-types';
import { followUpPlanStatusEnum, followUpPlanStepStatusEnum } from './enums';
import { workspaces } from './workspaces';

export const followUpPlans = pgTable(
	'cadences',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id)
			.notNull(),
		contactId: uuid('contact_id')
			.references(() => contacts.id)
			.notNull(),
		title: encryptedText('title').notNull(),
		templateId: text('template_id'),
		status: followUpPlanStatusEnum('status').default('draft').notNull(),
		totalSteps: integer('total_steps').default(0).notNull(),
		completedSteps: integer('completed_steps').default(0).notNull(),
		/** Custom config: { tone?, frequency?, context? } */
		config: jsonb('config').default({}),
		activatedAt: timestamp('activated_at', { withTimezone: true }),
		pausedAt: timestamp('paused_at', { withTimezone: true }),
		completedAt: timestamp('completed_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('cadences_workspace_idx').on(table.workspaceId),
		index('cadences_contact_idx').on(table.workspaceId, table.contactId),
		index('cadences_status_idx').on(table.workspaceId, table.status),
	],
);

export const followUpPlanSteps = pgTable(
	'cadence_steps',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		cadenceId: uuid('cadence_id')
			.references(() => followUpPlans.id, { onDelete: 'cascade' })
			.notNull(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id)
			.notNull(),
		stepNumber: integer('step_number').notNull(),
		/** Template instructions for draft generation */
		prompt: encryptedText('prompt').notNull(),
		/** Delay in hours from previous step (or from activation for step 1) */
		delayHours: integer('delay_hours').default(24).notNull(),
		status: followUpPlanStepStatusEnum('status').default('pending').notNull(),
		/** Generated draft text */
		draftText: encryptedText('draft_text'),
		/** Bandit arm used for draft generation */
		armType: text('arm_type'),
		sentAt: timestamp('sent_at', { withTimezone: true }),
		scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('cadence_steps_cadence_idx').on(table.cadenceId),
		index('cadence_steps_status_idx').on(table.workspaceId, table.status),
		index('cadence_steps_scheduled_idx').on(table.scheduledAt),
	],
);
