import { randomUUID } from 'node:crypto';
import { redactSensitive, redactText } from '@repo/shared';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '../client';
import { type AuditLog, auditLogs } from '../schema/audit-log';

const REDACTED = '[redacted]';
const MAX_AUDIT_METADATA_STRING_LENGTH = 160;
const MAX_AUDIT_METADATA_ARRAY_LENGTH = 25;

export const AUDIT_METADATA_ALLOWED_KEYS = [
	'action',
	'actions',
	'aiMode',
	'armType',
	'armTypes',
	'batchFull',
	'batchSize',
	'calibration',
	'channel',
	'chatIdsFiltered',
	'chatLimit',
	'chatsProcessed',
	'contactIdsFiltered',
	'contactLimit',
	'contactNameProvided',
	'contactsProcessed',
	'edited',
	'firstStepId',
	'idempotencyKey',
	'importedFromStepDraft',
	'maxAgeDays',
	'messagesQueued',
	'operation',
	'reactionAction',
	'reactionCount',
	'readySteps',
	'reason',
	'runId',
	'sourceAccountFiltered',
	'status',
	'telegramRecipient',
	'touchedChatCount',
	'touchedContactCount',
	'trigger',
] as const;

const AUDIT_METADATA_ALLOWED_KEY_SET = new Set<string>(AUDIT_METADATA_ALLOWED_KEYS);

const SENSITIVE_AUDIT_METADATA_KEYS = new Set([
	'accessToken',
	'apiHash',
	'apiKey',
	'authorization',
	'bearerToken',
	'botToken',
	'contactTelegramId',
	'databaseUrl',
	'email',
	'encryptedWrk',
	'error',
	'errorMessage',
	'message',
	'messageBody',
	'messageContent',
	'messageText',
	'output',
	'password',
	'phone',
	'prompt',
	'rawMessage',
	'rawMessages',
	'redisUrl',
	'refreshToken',
	'response',
	'secret',
	'session',
	'sessionString',
	'sourceAccountId',
	'sourceManifest',
	'telegramId',
	'token',
	'url',
	'workspaceKey',
	'wrk',
]);

function normalizeMetadataKey(key: string): string {
	return key.replace(/[_-]/g, '').toLowerCase();
}

function isAllowedAuditMetadataKey(key: string): boolean {
	const normalized = normalizeMetadataKey(key);
	for (const allowedKey of AUDIT_METADATA_ALLOWED_KEY_SET) {
		if (normalized === normalizeMetadataKey(allowedKey)) return true;
	}
	return false;
}

function isSensitiveAuditMetadataKey(key: string): boolean {
	const normalized = normalizeMetadataKey(key);
	for (const sensitiveKey of SENSITIVE_AUDIT_METADATA_KEYS) {
		if (normalized === normalizeMetadataKey(sensitiveKey)) return true;
	}
	return /(token|secret|password|session|string|credential|authorization|bearer|prompt|output|response|encrypted|embedding)/i.test(
		normalized,
	);
}

function sanitizeAuditMetadataPrimitive(
	value: unknown,
): string | number | boolean | null | undefined {
	if (value === null) return null;
	if (typeof value === 'boolean') return value;
	if (typeof value === 'number') return Number.isFinite(value) ? value : REDACTED;
	if (typeof value !== 'string') return undefined;

	const trimmed = value.trim();
	if (!trimmed) return '';
	if (trimmed.length > MAX_AUDIT_METADATA_STRING_LENGTH) return REDACTED;

	const redacted = redactText(trimmed);
	return redacted;
}

function sanitizeAuditMetadataValue(key: string, value: unknown): unknown {
	if (isSensitiveAuditMetadataKey(key)) return REDACTED;
	if (Array.isArray(value)) {
		return value
			.slice(0, MAX_AUDIT_METADATA_ARRAY_LENGTH)
			.map((item) =>
				typeof item === 'object' && item !== null ? REDACTED : sanitizeAuditMetadataPrimitive(item),
			)
			.filter((item) => item !== undefined);
	}
	if (typeof value === 'object' && value !== null) return REDACTED;
	return sanitizeAuditMetadataPrimitive(value);
}

function asAuditMetadataRecord(metadata: unknown): Record<string, unknown> {
	if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
	return metadata as Record<string, unknown>;
}

export function sanitizeAuditMetadata(
	metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
	const sanitized: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(metadata ?? {})) {
		if (!isAllowedAuditMetadataKey(key) && !isSensitiveAuditMetadataKey(key)) continue;
		const sanitizedValue = sanitizeAuditMetadataValue(key, value);
		if (sanitizedValue !== undefined) sanitized[key] = sanitizedValue;
	}

	return sanitized;
}

function sanitizeAuditLogRow(log: AuditLog): AuditLog {
	return {
		...log,
		metadata: sanitizeAuditMetadata(asAuditMetadataRecord(log.metadata)),
	};
}

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
			metadata: sanitizeAuditMetadata(entry.metadata),
		})
		.then(() => {
			// Success — no-op
		})
		.catch((err) => {
			console.error('[audit-log] Failed to append audit log:', redactSensitive(err));
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
		logs: logs.map(sanitizeAuditLogRow),
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
	const logs = await db
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
	return logs.map(sanitizeAuditLogRow);
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
