import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';

export const actorTypeEnum = pgEnum('actor_type', ['user', 'system', 'ai']);

export const auditActionEnum = pgEnum('audit_action', [
	'create',
	'update',
	'delete',
	'login',
	'sync',
	'generate',
	'evaluate',
	'send',
]);

export const auditResourceTypeEnum = pgEnum('audit_resource_type', [
	'contact',
	'commitment',
	'deal',
	'introduction',
	'goal',
	'summary',
	'digest',
	'brief',
	'cadence',
	'calendar',
	'feature_flag',
	'preference',
	'decision',
	'message',
]);

export const auditLogs = pgTable(
	'audit_logs',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id, { onDelete: 'cascade' })
			.notNull(),
		actorType: actorTypeEnum('actor_type').notNull(),
		actorId: text('actor_id').notNull(),
		action: auditActionEnum('action').notNull(),
		resourceType: auditResourceTypeEnum('resource_type').notNull(),
		resourceId: uuid('resource_id'),
		correlationId: uuid('correlation_id'),
		metadata: jsonb('metadata').default({}).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		// NO updatedAt — append-only, immutable
	},
	(table) => [
		index('audit_logs_workspace_created_idx').on(table.workspaceId, table.createdAt),
		index('audit_logs_resource_idx').on(table.resourceType, table.resourceId),
		index('audit_logs_correlation_idx').on(table.correlationId),
	],
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
