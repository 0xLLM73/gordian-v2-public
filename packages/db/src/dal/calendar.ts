import type { SealedEnvelope } from '@repo/crypto';
import { computeBlindIndex, getCurrentKeys, withKeys } from '@repo/crypto';
import { and, eq, sql } from '@repo/db';
import { desc, gte } from 'drizzle-orm';
import { db } from '../client';
import { calendarConnections, calendarEvents } from '../schema/calendar';
import { contacts } from '../schema/contacts';

// ─── Connection CRUD ──────────────────────────────────────────────────────────

export async function createCalendarConnection(
	workspaceId: string,
	input: {
		provider?: string;
		accessToken: string;
		refreshToken: string;
		expiresAt?: Date;
		email?: string;
	},
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const [result] = await db
			.insert(calendarConnections)
			.values({
				workspaceId,
				provider: input.provider ?? 'google',
				accessToken: input.accessToken,
				refreshToken: input.refreshToken,
				expiresAt: input.expiresAt,
				email: input.email,
				...(input.email ? { emailBlindIndex: input.email } : {}),
			})
			.returning();
		return result;
	});
}

export async function getCalendarConnection(workspaceId: string, envelope: SealedEnvelope) {
	return withKeys(envelope, async () => {
		const [result] = await db
			.select()
			.from(calendarConnections)
			.where(eq(calendarConnections.workspaceId, workspaceId))
			.limit(1);
		return result ?? null;
	});
}

export async function updateCalendarTokens(
	workspaceId: string,
	connectionId: string,
	tokens: { accessToken: string; refreshToken?: string; expiresAt?: Date },
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const [result] = await db
			.update(calendarConnections)
			.set({
				accessToken: tokens.accessToken,
				...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
				...(tokens.expiresAt ? { expiresAt: tokens.expiresAt } : {}),
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(calendarConnections.id, connectionId),
					eq(calendarConnections.workspaceId, workspaceId),
				),
			)
			.returning();
		return result ?? null;
	});
}

export async function updateCalendarLastSync(workspaceId: string, connectionId: string) {
	return db
		.update(calendarConnections)
		.set({ lastSyncAt: new Date(), updatedAt: new Date() })
		.where(
			and(
				eq(calendarConnections.id, connectionId),
				eq(calendarConnections.workspaceId, workspaceId),
			),
		);
}

export async function deleteCalendarConnection(workspaceId: string, connectionId: string) {
	return db
		.delete(calendarConnections)
		.where(
			and(
				eq(calendarConnections.id, connectionId),
				eq(calendarConnections.workspaceId, workspaceId),
			),
		);
}

// ─── Event Upsert ─────────────────────────────────────────────────────────────

export interface UpsertCalendarEventInput {
	externalId: string;
	title?: string;
	description?: string;
	startTime: Date;
	endTime?: Date;
	location?: string;
	attendees?: Array<{ email: string; name?: string }>;
	metadata?: Record<string, unknown>;
}

export async function upsertCalendarEvent(
	workspaceId: string,
	connectionId: string,
	input: UpsertCalendarEventInput,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const [result] = await db
			.insert(calendarEvents)
			.values({
				workspaceId,
				connectionId,
				externalId: input.externalId,
				title: input.title,
				description: input.description,
				startTime: input.startTime,
				endTime: input.endTime,
				location: input.location,
				attendees: JSON.stringify(input.attendees ?? []),
				metadata: input.metadata ?? {},
			})
			.onConflictDoNothing()
			.returning();
		return result;
	});
}

// ─── Attendee Matching ────────────────────────────────────────────────────────

/**
 * Match attendee emails to contacts via blind index and update the event's contactId.
 * SEC-101: Uses computeBlindIndex against emailBidx (not encrypted email column).
 */
export async function matchAttendeeToContact(
	workspaceId: string,
	eventId: string,
	attendeeEmails: string[],
	envelope: SealedEnvelope,
) {
	if (attendeeEmails.length === 0) return null;

	// Find the first contact matching any attendee email via blind index (SEC-101)
	return withKeys(envelope, async () => {
		const keys = getCurrentKeys();

		for (const email of attendeeEmails) {
			const emailHash = computeBlindIndex(email, keys.bik);

			const [match] = await db
				.select({ id: contacts.id })
				.from(contacts)
				.where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.emailBidx, emailHash)))
				.limit(1);
			if (match) {
				await db
					.update(calendarEvents)
					.set({ contactId: match.id, updatedAt: new Date() })
					.where(and(eq(calendarEvents.id, eventId), eq(calendarEvents.workspaceId, workspaceId)));
				return match.id;
			}
		}

		return null;
	});
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function listCalendarEvents(
	workspaceId: string,
	opts?: { contactId?: string; since?: Date; limit?: number },
	envelope?: SealedEnvelope,
) {
	const conditions = [eq(calendarEvents.workspaceId, workspaceId)];
	if (opts?.contactId) {
		conditions.push(eq(calendarEvents.contactId, opts.contactId));
	}
	if (opts?.since) {
		conditions.push(gte(calendarEvents.startTime, opts.since));
	}

	const doQuery = async () => {
		const rows = await db
			.select()
			.from(calendarEvents)
			.where(and(...conditions))
			.orderBy(desc(calendarEvents.startTime))
			.limit(opts?.limit ?? 50);
		return rows.map((row) => ({
			...row,
			attendees: row.attendees ? JSON.parse(row.attendees) : [],
		}));
	};

	return envelope ? withKeys(envelope, doQuery) : doQuery();
}

export async function getUpcomingEvents(
	workspaceId: string,
	limit = 10,
	envelope?: SealedEnvelope,
) {
	const doQuery = async () => {
		const rows = await db
			.select()
			.from(calendarEvents)
			.where(
				and(eq(calendarEvents.workspaceId, workspaceId), gte(calendarEvents.startTime, new Date())),
			)
			.orderBy(calendarEvents.startTime)
			.limit(limit);
		return rows.map((row) => ({
			...row,
			attendees: row.attendees ? JSON.parse(row.attendees) : [],
		}));
	};

	return envelope ? withKeys(envelope, doQuery) : doQuery();
}

export async function getEventCountByContact(workspaceId: string) {
	return db
		.select({
			contactId: calendarEvents.contactId,
			count: sql<number>`count(*)::int`,
		})
		.from(calendarEvents)
		.where(
			and(
				eq(calendarEvents.workspaceId, workspaceId),
				sql`${calendarEvents.contactId} IS NOT NULL`,
			),
		)
		.groupBy(calendarEvents.contactId);
}
