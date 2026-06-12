'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { trackEventAction } from '@/app/actions/analytics';
import { CommitmentsCard } from '@/components/onboarding/commitments-card';
import { DashboardPreviewCard } from '@/components/onboarding/dashboard-preview-card';
import { OnboardingCard } from '@/components/onboarding/onboarding-card';
import { useOnboarding } from '@/components/onboarding/onboarding-provider';
import { ReconnectCard } from '@/components/onboarding/reconnect-card';
import { SummaryCard } from '@/components/onboarding/summary-card';
import { Button } from '@/components/ui/button';
import { useAbandonTracking } from '@/hooks/use-abandon-tracking';
import { useStepTracking } from '@/hooks/use-step-tracking';

export default function FirstLookPage() {
	const router = useRouter();
	const { workspaceId, clearOnboarding, hydrated } = useOnboarding();
	const [completing, setCompleting] = useState(false);
	const trackedRef = useRef(false);
	useAbandonTracking('first_look', workspaceId);
	const completeStep = useStepTracking('first_look', workspaceId);

	// Redirect if no workspace (unless we're already completing)
	useEffect(() => {
		if (!hydrated || completing) return;
		if (!workspaceId) {
			router.replace('/onboarding/connect');
		}
	}, [hydrated, workspaceId, completing, router]);

	// Track first-look viewed (once)
	useEffect(() => {
		if (!hydrated || !workspaceId || trackedRef.current) return;
		trackedRef.current = true;
		trackEventAction({ event: 'onboarding.first_look_viewed' });
	}, [hydrated, workspaceId]);

	async function handleComplete() {
		setCompleting(true);
		try {
			const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
			await fetch('/api/onboarding/complete', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ timezone }),
			});
		} catch {
			// Preferences can be set later
		}
		completeStep();
		// Navigate with full page load to exit the onboarding SPA shell.
		// clearOnboarding wipes sessionStorage; using window.location avoids
		// the React re-render that would trigger the redirect guard above.
		clearOnboarding();
		window.location.href = '/?welcome=1';
	}

	if (!hydrated || !workspaceId) return null;

	return (
		<OnboardingCard className="max-w-xl">
			<div className="mb-6">
				<h1 className="text-2xl font-bold text-foreground">Here's what we found</h1>
				<p className="mt-2 text-sm text-muted-foreground">
					Explore your network insights. Everything is skippable — you can always come back later.
				</p>
			</div>

			<div className="space-y-3">
				<ReconnectCard />
				<CommitmentsCard />
				<DashboardPreviewCard />
				<SummaryCard />
			</div>

			<div className="mt-6">
				<Button onClick={handleComplete} disabled={completing} className="w-full">
					{completing ? 'Setting up...' : 'Go to Dashboard'}
				</Button>
			</div>
		</OnboardingCard>
	);
}
