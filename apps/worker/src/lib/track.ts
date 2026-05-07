import { hasAnalyticsConsent, trackAnalyticsEvent } from '@repo/db';
import { getPostHogWorker } from './posthog';

/**
 * Dual-write worker event to Postgres (user_behaviors) + PostHog.
 * Postgres write is unconditional (our own data).
 * PostHog capture is consent-gated for user-attributable events.
 * System events (null userId) skip PostHog entirely — no user to attribute.
 */
export function trackWorkerEvent(
	workspaceId: string,
	userId: string | null,
	event: string,
	properties?: Record<string, unknown>,
): void {
	trackAnalyticsEvent(workspaceId, userId, event, properties);

	if (!userId) return;

	void hasAnalyticsConsent(userId, workspaceId)
		.then((consented) => {
			if (!consented) return;
			try {
				const ph = getPostHogWorker();
				ph?.capture({
					distinctId: userId,
					event,
					properties: { ...properties, workspace_id: workspaceId },
				});
			} catch {}
		})
		.catch(() => {});
}
