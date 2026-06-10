import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core';
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
		objective: encryptedText('objective'),
		templateId: text('template_id'),
		templateVersion: integer('template_version'),
		templateSource: text('template_source'),
		status: followUpPlanStatusEnum('status').default('draft').notNull(),
		totalSteps: integer('total_steps').default(0).notNull(),
		completedSteps: integer('completed_steps').default(0).notNull(),
		/** Non-sensitive config: { tone?, channel?, aiMode?, sendingMode?, sourceGoalId? } */
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

export const followUpPlanTemplateVersions = pgTable(
	'follow_up_plan_template_versions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		templateId: text('template_id').notNull(),
		version: integer('version').notNull(),
		source: text('source').default('built_in').notNull(),
		title: text('title').notNull(),
		description: text('description').notNull(),
		category: text('category'),
		steps: jsonb('steps').notNull(),
		isActive: boolean('is_active').default(true).notNull(),
		metadata: jsonb('metadata').default({}).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex('follow_up_plan_template_versions_source_id_version_uniq').on(
			table.source,
			table.templateId,
			table.version,
		),
		index('follow_up_plan_template_versions_active_idx').on(table.source, table.isActive),
		index('follow_up_plan_template_versions_template_idx').on(table.templateId, table.version),
	],
);

export const followUpPlanUserTemplateVersions = pgTable(
	'follow_up_plan_user_template_versions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id)
			.notNull(),
		templateId: text('template_id').notNull(),
		version: integer('version').notNull(),
		title: encryptedText('title').notNull(),
		description: encryptedText('description').notNull(),
		category: text('category'),
		steps: encryptedText('steps').notNull(),
		isActive: boolean('is_active').default(true).notNull(),
		metadata: jsonb('metadata').default({}).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex('follow_up_plan_user_template_versions_workspace_id_version_uniq').on(
			table.workspaceId,
			table.templateId,
			table.version,
		),
		index('follow_up_plan_user_template_versions_workspace_idx').on(table.workspaceId),
		index('follow_up_plan_user_template_versions_active_idx').on(table.workspaceId, table.isActive),
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
		processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),
		processingLeaseExpiresAt: timestamp('processing_lease_expires_at', { withTimezone: true }),
		processingAttempts: integer('processing_attempts').default(0).notNull(),
		lastProcessingError: text('last_processing_error'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('cadence_steps_cadence_idx').on(table.cadenceId),
		index('cadence_steps_status_idx').on(table.workspaceId, table.status),
		index('cadence_steps_scheduled_idx').on(table.scheduledAt),
		index('cadence_steps_processing_lease_idx').on(
			table.workspaceId,
			table.status,
			table.processingLeaseExpiresAt,
		),
	],
);

export const followUpPlanDraftRevisions = pgTable(
	'follow_up_plan_draft_revisions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id)
			.notNull(),
		followUpPlanId: uuid('follow_up_plan_id')
			.references(() => followUpPlans.id, { onDelete: 'cascade' })
			.notNull(),
		stepId: uuid('step_id')
			.references(() => followUpPlanSteps.id, { onDelete: 'cascade' })
			.notNull(),
		version: integer('version').notNull(),
		status: text('status').notNull(),
		source: text('source').default('local_ai').notNull(),
		draftText: encryptedText('draft_text').notNull(),
		armType: text('arm_type'),
		metadata: jsonb('metadata').default({}).notNull(),
		approvedAt: timestamp('approved_at', { withTimezone: true }),
		rejectedAt: timestamp('rejected_at', { withTimezone: true }),
		supersededAt: timestamp('superseded_at', { withTimezone: true }),
		sentAt: timestamp('sent_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex('follow_up_plan_draft_revisions_step_version_uniq').on(
			table.workspaceId,
			table.stepId,
			table.version,
		),
		index('follow_up_plan_draft_revisions_workspace_idx').on(table.workspaceId),
		index('follow_up_plan_draft_revisions_plan_idx').on(table.workspaceId, table.followUpPlanId),
		index('follow_up_plan_draft_revisions_step_idx').on(table.workspaceId, table.stepId),
		index('follow_up_plan_draft_revisions_status_idx').on(table.workspaceId, table.status),
	],
);

export const followUpPlanSendRecords = pgTable(
	'follow_up_plan_send_records',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id)
			.notNull(),
		followUpPlanId: uuid('follow_up_plan_id')
			.references(() => followUpPlans.id, { onDelete: 'cascade' })
			.notNull(),
		stepId: uuid('step_id')
			.references(() => followUpPlanSteps.id, { onDelete: 'cascade' })
			.notNull(),
		status: text('status').notNull(),
		channel: text('channel').default('manual').notNull(),
		metadata: jsonb('metadata').default({}).notNull(),
		copiedAt: timestamp('copied_at', { withTimezone: true }),
		telegramOpenedAt: timestamp('telegram_opened_at', { withTimezone: true }),
		manualConfirmedAt: timestamp('manual_confirmed_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('follow_up_plan_send_records_workspace_idx').on(table.workspaceId),
		index('follow_up_plan_send_records_plan_idx').on(table.workspaceId, table.followUpPlanId),
		index('follow_up_plan_send_records_step_idx').on(table.workspaceId, table.stepId),
		index('follow_up_plan_send_records_status_idx').on(table.workspaceId, table.status),
	],
);

export const followUpPlanActivityEvents = pgTable(
	'follow_up_plan_activity_events',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id)
			.notNull(),
		followUpPlanId: uuid('follow_up_plan_id')
			.references(() => followUpPlans.id, { onDelete: 'cascade' })
			.notNull(),
		stepId: uuid('step_id').references(() => followUpPlanSteps.id, { onDelete: 'set null' }),
		eventType: text('event_type').notNull(),
		summary: text('summary').notNull(),
		metadata: jsonb('metadata').default({}).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('follow_up_plan_activity_workspace_idx').on(table.workspaceId),
		index('follow_up_plan_activity_plan_created_idx').on(
			table.workspaceId,
			table.followUpPlanId,
			table.createdAt,
		),
		index('follow_up_plan_activity_step_idx').on(table.workspaceId, table.stepId),
	],
);

export const followUpPlanWorkerHeartbeats = pgTable(
	'follow_up_plan_worker_heartbeats',
	{
		workerId: text('worker_id').primaryKey(),
		status: text('status').notNull(),
		lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
		lastStartedAt: timestamp('last_started_at', { withTimezone: true }),
		lastCompletedAt: timestamp('last_completed_at', { withTimezone: true }),
		lastFailedAt: timestamp('last_failed_at', { withTimezone: true }),
		lastErrorSummary: text('last_error_summary'),
		processedSteps: integer('processed_steps').default(0).notNull(),
		failedSteps: integer('failed_steps').default(0).notNull(),
		metadata: jsonb('metadata').default({}).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('follow_up_plan_worker_heartbeats_status_idx').on(table.status),
		index('follow_up_plan_worker_heartbeats_last_seen_idx').on(table.lastSeenAt),
	],
);
