'use client';

import { trackEventAction } from '@/app/actions/analytics';
import { saveConsentAction } from '@/app/actions/calibration';
import { triggerSyncAction } from '@/app/actions/sync';
import { LiveSyncFeed } from '@/components/onboarding/live-sync-feed';
import { OnboardingCard } from '@/components/onboarding/onboarding-card';
import { useOnboarding } from '@/components/onboarding/onboarding-provider';
import { Button } from '@/components/ui/button';
import { useAbandonTracking } from '@/hooks/use-abandon-tracking';
import { useOnboardingSync } from '@/hooks/use-onboarding-sync';
import { useStepTracking } from '@/hooks/use-step-tracking';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const MIN_CONTACTS_TO_ADVANCE = 10;
const TELEGRAM_LINKING_ENABLED = process.env.NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED === 'true';

export default function SyncPage() {
	const router = useRouter();
	const { workspaceId, hydrated, consentAcknowledged } = useOnboarding();
	const { contacts, messages, stage, isComplete, recentContacts, feedEvents, staleContacts } =
		useOnboardingSync(workspaceId);
	const syncTriggered = useRef(false);
	const [syncError, setSyncError] = useState<string | null>(null);

	const canAdvance = contacts >= MIN_CONTACTS_TO_ADVANCE || isComplete;
	useAbandonTracking('sync', workspaceId);
	const completeStep = useStepTracking('sync', workspaceId);

	// Redirect if no workspace (user navigated directly)
	useEffect(() => {
		if (!TELEGRAM_LINKING_ENABLED) return;
		if (!hydrated) return;
		if (!workspaceId) {
			router.replace('/onboarding/connect');
		}
	}, [hydrated, workspaceId, router]);

	// Persist consent THEN trigger sync (SEC-OB-001: consent must be recorded before data processing)
	useEffect(() => {
		if (!TELEGRAM_LINKING_ENABLED) return;
		if (!workspaceId || syncTriggered.current) return;
		syncTriggered.current = true;

		const startSync = async () => {
			if (consentAcknowledged) {
				try {
					await saveConsentAction({
						consentDataProcessing: true,
						consentAiAnalysis: true,
						consentTelegramAccess: true,
					});
				} catch (err) {
					console.error('[sync] Failed to persist consent:', err);
					return;
				}
			}
			triggerSyncAction({}).catch((err) => {
				console.error('[sync] Failed to trigger sync:', err);
				setSyncError('Sync could not start. Check that the worker and Redis are running.');
			});
		};

		startSync();
	}, [workspaceId, consentAcknowledged]);

	if (!TELEGRAM_LINKING_ENABLED) {
		return (
			<OnboardingCard className="max-w-xl">
				<h1 className="text-2xl font-bold text-foreground">Telegram sync is disabled</h1>
				<p className="mt-2 text-sm text-muted-foreground">
					This deployment is configured without Telegram account access.
				</p>
			</OnboardingCard>
		);
	}

	if (!hydrated || !workspaceId) return null;

	return (
		<OnboardingCard className="max-w-xl">
			<div className="mb-6">
				<h1 className="text-2xl font-bold text-foreground">Discovering your network</h1>
				<p className="mt-2 text-sm text-muted-foreground">
					Gordian is scanning your Telegram conversations. Watch your contacts appear in real time.
				</p>
			</div>

			<LiveSyncFeed
				contacts={contacts}
				messages={messages}
				stage={stage}
				isComplete={isComplete}
				recentContacts={recentContacts}
				feedEvents={feedEvents}
				staleContacts={staleContacts}
			/>

			{syncError ? (
				<div className="mt-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
					{syncError}
				</div>
			) : null}

			<div className="mt-6 flex flex-col items-center gap-2">
				{canAdvance ? (
					<>
						<Button
							onClick={() => {
								trackEventAction({
									event: 'onboarding.sync_advance_clicked',
									properties: { contacts_at_advance: contacts, sync_complete: isComplete },
								});
								completeStep();
								router.push('/onboarding/what-matters');
							}}
							className="w-full"
						>
							Continue
						</Button>
						{!isComplete && (
							<p className="text-xs text-muted-foreground">Sync continues in the background</p>
						)}
					</>
				) : (
					<p className="text-xs text-muted-foreground">Waiting for contacts to appear...</p>
				)}
			</div>
		</OnboardingCard>
	);
}
