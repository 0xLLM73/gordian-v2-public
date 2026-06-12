'use client';

import type { OnboardingStep } from '@repo/shared';
import { useCallback, useEffect, useRef } from 'react';
import { trackEventAction } from '@/app/actions/analytics';

/**
 * Tracks onboarding step timing: fires `step_started` on mount,
 * returns `completeStep()` to fire `step_completed` with duration.
 * Call completeStep() right before navigating to the next step.
 */
export function useStepTracking(step: OnboardingStep, workspaceId: string | null) {
	const startTime = useRef(Date.now());
	const firedStart = useRef(false);
	const firedComplete = useRef(false);

	useEffect(() => {
		if (!workspaceId || firedStart.current) return;
		firedStart.current = true;
		void trackEventAction({ event: 'onboarding.step_started', properties: { step } }).catch(
			() => {},
		);
	}, [workspaceId, step]);

	const completeStep = useCallback(() => {
		if (!workspaceId || firedComplete.current) return;
		firedComplete.current = true;
		void trackEventAction({
			event: 'onboarding.step_completed',
			properties: { step, duration_ms: Date.now() - startTime.current },
		}).catch(() => {});
	}, [workspaceId, step]);

	return completeStep;
}
