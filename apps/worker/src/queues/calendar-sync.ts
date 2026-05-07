import type { SealedEnvelope } from '@repo/crypto';
import {
	db,
	eq,
	getCalendarConnection,
	matchAttendeeToContact,
	updateCalendarLastSync,
	updateCalendarTokens,
	upsertCalendarEvent,
	workspaces,
} from '@repo/db';

const CALENDAR_SYNC_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

interface GoogleCalendarEvent {
	id: string;
	summary?: string;
	description?: string;
	start?: { dateTime?: string; date?: string };
	end?: { dateTime?: string; date?: string };
	location?: string;
	attendees?: Array<{ email: string; displayName?: string }>;
	htmlLink?: string;
	status?: string;
	organizer?: { email?: string };
}

async function getWorkspaceEnvelope(workspaceId: string): Promise<SealedEnvelope | null> {
	const result = await db
		.select({
			encryptedWrk: workspaces.encryptedWrk,
			kmsContext: workspaces.kmsContext,
			wrkVersion: workspaces.wrkVersion,
		})
		.from(workspaces)
		.where(eq(workspaces.id, workspaceId))
		.limit(1);

	if (result.length === 0) return null;

	const ws = result[0];
	return {
		encryptedWrk: Buffer.from(ws.encryptedWrk, 'base64'),
		kmsContext: ws.kmsContext as Record<string, string>,
		wrkVersion: ws.wrkVersion,
	};
}

/** Refresh an expired Google OAuth access token using the refresh token */
async function refreshAccessToken(
	refreshToken: string,
): Promise<{ accessToken: string; expiresAt: Date } | null> {
	const clientId = process.env.GOOGLE_CLIENT_ID;
	const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
	if (!clientId || !clientSecret) return null;

	const res = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			refresh_token: refreshToken,
			grant_type: 'refresh_token',
		}),
	});

	if (!res.ok) return null;

	const data = (await res.json()) as { access_token?: string; expires_in?: number };
	if (!data.access_token) return null;

	return {
		accessToken: data.access_token,
		expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
	};
}

/** Fetch calendar events, handling 401 with token refresh */
async function fetchCalendarEvents(
	accessToken: string,
	params: URLSearchParams,
): Promise<Response> {
	return fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events?${params}`, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
}

/**
 * Sync calendar events from Google Calendar for all connected workspaces.
 * Decrypts OAuth tokens via withKeys envelope. Refreshes on 401.
 */
export async function syncCalendarEvents(): Promise<void> {
	try {
		// Get all workspace IDs that have calendar connections
		const { calendarConnections } = await import('@repo/db');
		const connectionWorkspaces = await db
			.select({ workspaceId: calendarConnections.workspaceId })
			.from(calendarConnections);

		const uniqueWorkspaceIds = [...new Set(connectionWorkspaces.map((c) => c.workspaceId))];
		if (uniqueWorkspaceIds.length === 0) return;

		console.log(`[calendar-sync] Syncing calendars for ${uniqueWorkspaceIds.length} workspaces`);

		for (const workspaceId of uniqueWorkspaceIds) {
			try {
				const envelope = await getWorkspaceEnvelope(workspaceId);
				if (!envelope) {
					console.warn(`[calendar-sync] No envelope for workspace=${workspaceId.slice(0, 8)}`);
					continue;
				}

				// Decrypt connection via DAL (uses withKeys)
				const conn = await getCalendarConnection(workspaceId, envelope);
				if (!conn || !conn.accessToken) continue;

				const timeMin = new Date();
				timeMin.setDate(timeMin.getDate() - 7);
				const timeMax = new Date();
				timeMax.setDate(timeMax.getDate() + 30);

				const params = new URLSearchParams({
					timeMin: timeMin.toISOString(),
					timeMax: timeMax.toISOString(),
					maxResults: '100',
					singleEvents: 'true',
					orderBy: 'startTime',
				});

				let res = await fetchCalendarEvents(conn.accessToken, params);

				// Handle 401 — attempt token refresh
				if (res.status === 401 && conn.refreshToken) {
					const refreshed = await refreshAccessToken(conn.refreshToken);
					if (refreshed) {
						await updateCalendarTokens(workspaceId, conn.id, refreshed, envelope);
						res = await fetchCalendarEvents(refreshed.accessToken, params);
					} else {
						console.error(
							`[calendar-sync] Token refresh failed for workspace=${workspaceId.slice(0, 8)} — needs reauth`,
						);
						continue;
					}
				}

				if (!res.ok) {
					console.error(
						`[calendar-sync] API error for workspace=${workspaceId.slice(0, 8)}: ${res.status}`,
					);
					continue;
				}

				const data = (await res.json()) as { items?: GoogleCalendarEvent[] };
				const events = data.items ?? [];

				let upsertCount = 0;
				for (const event of events) {
					if (!event.id || !event.start) continue;

					const startTime = new Date(event.start.dateTime ?? event.start.date ?? '');
					const endTime = event.end
						? new Date(event.end.dateTime ?? event.end.date ?? '')
						: undefined;

					const attendees = (event.attendees ?? []).map((a) => ({
						email: a.email,
						name: a.displayName,
					}));

					const upserted = await upsertCalendarEvent(
						workspaceId,
						conn.id,
						{
							externalId: event.id,
							title: event.summary,
							description: event.description,
							startTime,
							endTime,
							location: event.location,
							attendees,
							metadata: {
								htmlLink: event.htmlLink,
								status: event.status,
								organizer: event.organizer?.email,
							},
						},
						envelope,
					);

					if (upserted) {
						upsertCount++;
						const emails = attendees.map((a) => a.email);
						await matchAttendeeToContact(workspaceId, upserted.id, emails, envelope).catch((err) =>
							console.error('[calendar-sync] attendee match failed:', (err as Error).message),
						);
					}
				}

				await updateCalendarLastSync(workspaceId, conn.id);
				console.log(
					`[calendar-sync] Synced ${upsertCount} events for workspace=${workspaceId.slice(0, 8)}`,
				);
			} catch (err) {
				console.error(
					`[calendar-sync] Failed for workspace=${workspaceId.slice(0, 8)}:`,
					(err as Error).message,
				);
			}
		}
	} catch (err) {
		console.error('[calendar-sync] Sync failed:', (err as Error).message);
	}
}

let calendarSyncInterval: ReturnType<typeof setInterval> | null = null;

/** Schedule periodic calendar sync — DragonflyDB-safe (no BullMQ repeat) */
export function scheduleCalendarSync(): void {
	// Initial sync after 2 minutes
	setTimeout(() => {
		syncCalendarEvents().catch((err) =>
			console.error('[calendar-sync] Initial sync failed:', err.message),
		);
	}, 120_000);

	// Then every 4 hours
	calendarSyncInterval = setInterval(() => {
		syncCalendarEvents().catch((err) =>
			console.error('[calendar-sync] Periodic sync failed:', err.message),
		);
	}, CALENDAR_SYNC_INTERVAL);

	console.log('[calendar-sync] Scheduled calendar sync every 4 hours');
}

/** Stop the calendar sync interval for graceful shutdown */
export function stopCalendarSync(): void {
	if (calendarSyncInterval) {
		clearInterval(calendarSyncInterval);
		calendarSyncInterval = null;
	}
}
