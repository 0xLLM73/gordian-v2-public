import { hasAnalyticsConsent, trackBehavior } from '@repo/db';
import type { AnalyticsEventName, AnalyticsEventProperties } from '@repo/shared';
import { getPostHogServer } from './posthog-server';

/**
 * Consent gate — checks user_calibrations.consent_data_processing.
 * Returns true if user hasn't reached consent step yet (no calibration row).
 */
async function checkConsent(workspaceId: string, userId: string): Promise<boolean> {
	return hasAnalyticsConsent(userId, workspaceId);
}

function captureToPostHog(
	userId: string,
	workspaceId: string,
	event: string,
	properties?: Record<string, unknown>,
) {
	try {
		const ph = getPostHogServer();
		ph?.capture({
			distinctId: userId,
			event,
			properties: { ...properties, workspace_id: workspaceId },
		});
	} catch {}
}

/**
 * Fire-and-forget behavior tracking with consent gate.
 * Never throws — silently catches all errors.
 * Dual-writes to Postgres + PostHog.
 */
export function track(
	workspaceId: string,
	userId: string,
	event: string,
	metadata?: Record<string, unknown>,
) {
	void checkConsent(workspaceId, userId)
		.then((consented) => {
			if (!consented) return;
			void trackBehavior(workspaceId, userId, event, metadata).catch(() => {});
			captureToPostHog(userId, workspaceId, event, metadata);
		})
		.catch(() => {});
}

/**
 * Typed analytics event tracking with consent gate.
 * Enforces event schema at compile time.
 * Dual-writes to Postgres + PostHog.
 */
export function trackEvent<E extends AnalyticsEventName>(
	workspaceId: string,
	userId: string,
	event: E,
	properties: AnalyticsEventProperties<E>,
) {
	void checkConsent(workspaceId, userId)
		.then((consented) => {
			if (!consented) return;
			const props = (Object.keys(properties).length > 0 ? properties : undefined) as
				| Record<string, unknown>
				| undefined;
			void trackBehavior(workspaceId, userId, event, props).catch(() => {});
			captureToPostHog(userId, workspaceId, event, props);
		})
		.catch(() => {});
}
