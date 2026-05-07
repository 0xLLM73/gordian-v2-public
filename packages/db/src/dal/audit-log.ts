import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '../client';
import { type AuditLog, auditLogs } from '../schema/audit-log';

/** Input type for appending an audit log entry */
export interface AppendAuditLogInput {
	workspaceId: string;
	actorType: 'user' | 'system' | 'ai';
	actorId: string;
	action: 'create' | 'update' | 'delete' | 'login' | 'sync' | 'generate' | 'evaluate' | 'send';
	resourceType:
		| 'contact'
		| 'commitment'
		| 'deal'
		| 'introduction'
		| 'goal'
		| 'summary'
		| 'digest'
		| 'brief'
		| 'cadence'
		| 'calendar'
		| 'feature_flag'
		| 'preference'
		| 'decision'
		| 'message';
	resourceId?: string;
	correlationId?: string;
	metadata?: Record<string, unknown>;
}

/** Filter options for querying audit logs */
export interface AuditLogFilters {
	actorType?: AppendAuditLogInput['actorType'];
	action?: AppendAuditLogInput['action'];
	resourceType?: AppendAuditLogInput['resourceType'];
	resourceId?: string;
	since?: string;
	until?: string;
	correlationId?: string;
	limit?: number;
	offset?: number;
}

/**
 * Append an audit log entry. Fire-and-forget — failures are logged
 * but never propagated to the caller.
 *
 * Follows the same pattern as trackBehavior() in behaviors.ts.
 */
export function appendAuditLog(entry: AppendAuditLogInput): void {
	db.insert(auditLogs)
		.values({
			workspaceId: entry.workspaceId,
			actorType: entry.actorType,
			actorId: entry.actorId,
			action: entry.action,
			resourceType: entry.resourceType,
			resourceId: entry.resourceId ?? null,
			correlationId: entry.correlationId ?? null,
			metadata: entry.metadata ?? {},
		})
		.then(() => {
			// Success — no-op
		})
		.catch((err) => {
			console.error('[audit-log] Failed to append audit log:', err);
		});
}

/**
 * Query audit logs with filters. Paginated, ordered by created_at DESC.
 */
export async function queryAuditLogs(
	workspaceId: string,
	filters?: AuditLogFilters,
): Promise<{ logs: AuditLog[]; total: number }> {
	const limit = filters?.limit ?? 50;
	const offset = filters?.offset ?? 0;

	const conditions = [eq(auditLogs.workspaceId, workspaceId)];

	if (filters?.actorType) {
		conditions.push(eq(auditLogs.actorType, filters.actorType));
	}
	if (filters?.action) {
		conditions.push(eq(auditLogs.action, filters.action));
	}
	if (filters?.resourceType) {
		conditions.push(eq(auditLogs.resourceType, filters.resourceType));
	}
	if (filters?.resourceId) {
		conditions.push(eq(auditLogs.resourceId, filters.resourceId));
	}
	if (filters?.correlationId) {
		conditions.push(eq(auditLogs.correlationId, filters.correlationId));
	}
	if (filters?.since) {
		conditions.push(gte(auditLogs.createdAt, new Date(filters.since)));
	}
	if (filters?.until) {
		conditions.push(lte(auditLogs.createdAt, new Date(filters.until)));
	}

	const where = and(...conditions);

	const [logs, countResult] = await Promise.all([
		db
			.select()
			.from(auditLogs)
			.where(where)
			.orderBy(desc(auditLogs.createdAt))
			.limit(limit)
			.offset(offset),
		db.select({ count: sql<number>`count(*)::int` }).from(auditLogs).where(where),
	]);

	return {
		logs,
		total: countResult[0]?.count ?? 0,
	};
}

/**
 * Get full audit trail for a single resource.
 * Ordered chronologically (oldest first) for timeline display.
 */
export async function getAuditTrail(
	workspaceId: string,
	resourceType: AuditLog['resourceType'],
	resourceId: string,
): Promise<AuditLog[]> {
	return db
		.select()
		.from(auditLogs)
		.where(
			and(
				eq(auditLogs.workspaceId, workspaceId),
				eq(auditLogs.resourceType, resourceType),
				eq(auditLogs.resourceId, resourceId),
			),
		)
		.orderBy(auditLogs.createdAt);
}

/**
 * Create a correlation-scoped audit logger.
 * All logs emitted from the returned helper share the same correlationId.
 */
export function createAuditLogger(workspaceId: string, correlationId?: string) {
	const corrId = correlationId ?? randomUUID();

	return {
		correlationId: corrId,

		log(
			actorType: AppendAuditLogInput['actorType'],
			actorId: string,
			action: AppendAuditLogInput['action'],
			resourceType: AppendAuditLogInput['resourceType'],
			resourceId?: string,
			metadata?: Record<string, unknown>,
		): void {
			appendAuditLog({
				workspaceId,
				actorType,
				actorId,
				action,
				resourceType,
				resourceId,
				correlationId: corrId,
				metadata,
			});
		},
	};
}
