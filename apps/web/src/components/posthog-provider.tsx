'use client';

import { initPostHog, posthog } from '@/lib/posthog';
import { useEffect } from 'react';

/**
 * Initializes PostHog client-side. Starts with opt_out_capturing_by_default.
 * Call posthog.opt_in_capturing() when user consents to analytics.
 * Call posthog.identify(userId) after authentication.
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
	useEffect(() => {
		initPostHog();
	}, []);

	return <>{children}</>;
}

export function usePostHogIdentify(userId: string | null, workspaceId: string | null) {
	useEffect(() => {
		if (!userId) return;
		posthog.identify(userId, { workspace_id: workspaceId });
	}, [userId, workspaceId]);
}

export function usePostHogConsent(consented: boolean) {
	useEffect(() => {
		if (consented) {
			posthog.opt_in_capturing();
		}
	}, [consented]);
}
