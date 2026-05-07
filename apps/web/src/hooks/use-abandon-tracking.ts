'use client';

import type { OnboardingStep } from '@repo/shared';
import { useEffect, useRef } from 'react';

/**
 * Tracks onboarding step abandonment via sendBeacon.
 * Fires `onboarding.step_abandoned` when the user closes/navigates away from a step.
 * Must be called from a client component within the onboarding flow.
 */
export function useAbandonTracking(step: OnboardingStep, workspaceId: string | null) {
	const startTime = useRef(Date.now());

	useEffect(() => {
		if (!workspaceId) return;

		const handleVisibilityChange = () => {
			if (document.visibilityState === 'hidden') {
				const payload = JSON.stringify({
					workspaceId,
					event: 'onboarding.step_abandoned',
					properties: {
						step,
						time_on_step_ms: Date.now() - startTime.current,
					},
				});
				navigator.sendBeacon('/api/analytics/beacon', payload);
			}
		};

		document.addEventListener('visibilitychange', handleVisibilityChange);
		return () => {
			document.removeEventListener('visibilitychange', handleVisibilityChange);
		};
	}, [step, workspaceId]);
}
