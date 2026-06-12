import type { SealedEnvelope } from '@repo/crypto';
import { withKeys } from '@repo/crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { connections } from '../schema/connections';

// Valid status transitions map
const VALID_TRANSITIONS: Record<string, string[]> = {
	detected: ['confirmed', 'dismissed'],
};

export async function createConnection(
	workspaceId: string,
	input: {
		contactId: string;
		event?: string | null;
		context?: string | null;
		confidence: number;
		note?: string | null;
		reasoning?: string | null;
		sourceMessageIds?: string[] | null;
	},
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		// Reject low confidence
		if (input.confidence < 0.3) return null;

		// Dedup: same workspace + contact within 7 days
		const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
		const existing = await db
			.select({ id: connections.id })
			.from(connections)
			.where(
				and(
					eq(connections.workspaceId, workspaceId),
					eq(connections.contactId, input.contactId),
					sql`${connections.detectedAt} > ${sevenDaysAgo.toISOString()}`,
				),
			)
			.limit(1);

		if (existing.length > 0) return null;

		const now = new Date().toISOString();
		const result = await db
			.insert(connections)
			.values({
				workspaceId,
				contactId: input.contactId,
				event: input.event ?? null,
				context: input.context ?? null,
				confidence: input.confidence,
				note: input.note ?? null,
				reasoning: input.reasoning ?? null,
				sourceMessageIds: input.sourceMessageIds ?? null,
				statusHistory: [{ status: 'detected', timestamp: now }],
			})
			.returning();

		return result[0] ?? null;
	});
}

export async function updateConnectionStatus(
	workspaceId: string,
	connectionId: string,
	newStatus: string,
) {
	const current = await db
		.select()
		.from(connections)
		.where(and(eq(connections.id, connectionId), eq(connections.workspaceId, workspaceId)))
		.limit(1);

	if (!current[0]) return null;

	const allowed = VALID_TRANSITIONS[current[0].status];
	if (!allowed || !allowed.includes(newStatus)) return null;

	const history = (current[0].statusHistory as Array<Record<string, unknown>>) || [];
	history.push({ status: newStatus, timestamp: new Date().toISOString() });

	// SEC-ENC-505: Only return non-encrypted fields — event/context/note are encrypted
	const result = await db
		.update(connections)
		.set({
			status: newStatus as (typeof connections.status.enumValues)[number],
			statusHistory: history,
			updatedAt: sql`now()`,
		})
		.where(and(eq(connections.id, connectionId), eq(connections.workspaceId, workspaceId)))
		.returning({
			id: connections.id,
			status: connections.status,
			statusHistory: connections.statusHistory,
			updatedAt: connections.updatedAt,
		});

	return result[0] ?? null;
}

export async function listConnections(
	workspaceId: string,
	options: { status?: string; event?: string; limit?: number; offset?: number } | undefined,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const limit = options?.limit ?? 50;
		const offset = options?.offset ?? 0;
		const conditions = [eq(connections.workspaceId, workspaceId)];

		if (options?.status) {
			conditions.push(
				eq(connections.status, options.status as (typeof connections.status.enumValues)[number]),
			);
		}

		if (options?.event) {
			conditions.push(eq(connections.event, options.event));
		}

		return db
			.select()
			.from(connections)
			.where(and(...conditions))
			.limit(limit)
			.offset(offset)
			.orderBy(sql`${connections.detectedAt} desc`);
	});
}

export async function getConnectionsByContact(
	workspaceId: string,
	contactId: string,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		return db
			.select()
			.from(connections)
			.where(and(eq(connections.workspaceId, workspaceId), eq(connections.contactId, contactId)))
			.orderBy(sql`${connections.detectedAt} desc`);
	});
}

export async function updateConnection(
	workspaceId: string,
	connectionId: string,
	input: { event?: string | null; context?: string | null; note?: string | null },
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const set: Record<string, unknown> = { updatedAt: sql`now()` };
		if (input.event !== undefined) set.event = input.event;
		if (input.context !== undefined) set.context = input.context;
		if (input.note !== undefined) set.note = input.note;

		const result = await db
			.update(connections)
			.set(set)
			.where(and(eq(connections.id, connectionId), eq(connections.workspaceId, workspaceId)))
			.returning();
		return result[0] ?? null;
	});
}

/** SEC-ENC-202: In-memory dedup — can't SQL DISTINCT on encrypted data */
export async function getDistinctEvents(workspaceId: string, envelope: SealedEnvelope) {
	return withKeys(envelope, async () => {
		const all = await db
			.select({ event: connections.event })
			.from(connections)
			.where(eq(connections.workspaceId, workspaceId));
		const unique = [...new Set(all.map((r) => r.event).filter(Boolean))];
		return unique as string[];
	});
}
