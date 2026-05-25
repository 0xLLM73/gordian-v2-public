'use client';

import { trackEventAction } from '@/app/actions/analytics';
import { saveConsentAction } from '@/app/actions/calibration';
import { disconnectTelegramAction } from '@/app/actions/settings';
import { triggerSyncAction } from '@/app/actions/sync';
import { LiveSyncFeed } from '@/components/onboarding/live-sync-feed';
import { OnboardingCard } from '@/components/onboarding/onboarding-card';
import { useOnboarding } from '@/components/onboarding/onboarding-provider';
import { Button } from '@/components/ui/button';
import { useAbandonTracking } from '@/hooks/use-abandon-tracking';
import { useOnboardingSync } from '@/hooks/use-onboarding-sync';
import { useStepTracking } from '@/hooks/use-step-tracking';
import { TELEGRAM_CONSENT_VERSION, type TelegramSyncScope } from '@repo/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import {
	AI_SYNC_ENABLED,
	SYNC_OPTIONS,
	TELEGRAM_LINKING_ENABLED,
	getAiProcessingImportDescription,
	getSyncScopeSafetyDetails,
	getSyncStartedDescription,
	resolveAiProcessingForSync,
} from './sync-settings';

const MIN_CONTACTS_TO_ADVANCE = 10;
type TelegramAccountOption = { key: string; label: string };

export default function SyncPage() {
	const router = useRouter();
	const { workspaceId, hydrated, consentAcknowledged, setWorkspaceId, setConsentAcknowledged } =
		useOnboarding();
	const consentRedirected = useRef(false);
	const [recoveryChecked, setRecoveryChecked] = useState(false);
	const [syncStarted, setSyncStarted] = useState(false);
	const [syncScope, setSyncScope] = useState<TelegramSyncScope>('contacts_only');
	const [enableAiProcessing, setEnableAiProcessing] = useState(false);
	const [telegramAccounts, setTelegramAccounts] = useState<TelegramAccountOption[]>([]);
	const [telegramAccountKey, setTelegramAccountKey] = useState('0');
	const [starting, setStarting] = useState(false);
	const [syncError, setSyncError] = useState<string | null>(null);
	const [sessionDisconnected, setSessionDisconnected] = useState(false);
	const [disconnectError, setDisconnectError] = useState<string | null>(null);
	const [isDisconnectPending, startDisconnectTransition] = useTransition();
	const { contacts, messages, stage, isComplete, recentContacts, feedEvents, staleContacts } =
		useOnboardingSync(syncStarted ? workspaceId : null);

	const canAdvance =
		syncStarted &&
		(syncScope === 'contacts_only' || contacts >= MIN_CONTACTS_TO_ADVANCE || isComplete);
	useAbandonTracking('sync', workspaceId);
	const completeStep = useStepTracking('sync', workspaceId);

	useEffect(() => {
		if (!TELEGRAM_LINKING_ENABLED || !hydrated) return;

		let cancelled = false;
		async function recoverOnboardingState() {
			try {
				const res = await fetch('/api/onboarding/status', { cache: 'no-store' });
				if (!res.ok) return;
				const data = (await res.json()) as {
					workspaceId?: string | null;
					hasCurrentTelegramConsent?: boolean;
					telegramAccounts?: TelegramAccountOption[];
				};
				if (cancelled) return;

				if (!workspaceId && data.workspaceId) {
					setWorkspaceId(data.workspaceId);
				}
				if (!consentAcknowledged && data.hasCurrentTelegramConsent) {
					setConsentAcknowledged(true);
				}
				if (Array.isArray(data.telegramAccounts)) {
					setTelegramAccounts(data.telegramAccounts);
					if (
						data.telegramAccounts.length > 0 &&
						!data.telegramAccounts.some((account) => account.key === telegramAccountKey)
					) {
						setTelegramAccountKey(data.telegramAccounts[0]?.key ?? '0');
					}
				}
			} finally {
				if (!cancelled) setRecoveryChecked(true);
			}
		}

		void recoverOnboardingState();
		return () => {
			cancelled = true;
		};
	}, [
		hydrated,
		workspaceId,
		consentAcknowledged,
		setWorkspaceId,
		setConsentAcknowledged,
		telegramAccountKey,
	]);

	// Redirect if no workspace (user navigated directly)
	useEffect(() => {
		if (!TELEGRAM_LINKING_ENABLED) return;
		if (!hydrated) return;
		if (!recoveryChecked) return;
		if (!workspaceId) {
			router.replace('/onboarding/connect');
		}
	}, [hydrated, recoveryChecked, workspaceId, router]);

	useEffect(() => {
		if (!TELEGRAM_LINKING_ENABLED) return;
		if (!hydrated || !recoveryChecked || consentAcknowledged || consentRedirected.current) return;
		consentRedirected.current = true;
		router.replace('/onboarding/connect');
	}, [hydrated, recoveryChecked, consentAcknowledged, router]);

	useEffect(() => {
		if (!AI_SYNC_ENABLED || syncScope === 'contacts_only') {
			setEnableAiProcessing(false);
		}
	}, [syncScope]);

	async function startSync() {
		if (!consentAcknowledged) {
			router.replace('/onboarding/connect');
			return;
		}

		setSyncError(null);
		setStarting(true);

		try {
			const aiProcessing = resolveAiProcessingForSync({
				requested: enableAiProcessing,
				syncScope,
			});
			const consentResult = await saveConsentAction({
				consentDataProcessing: true,
				consentAiAnalysis: aiProcessing,
				consentTelegramAccess: true,
				consentVersion: TELEGRAM_CONSENT_VERSION,
			});
			if (!consentResult?.data?.saved) {
				throw new Error(consentResult?.serverError ?? 'Consent could not be saved');
			}

			const result = await triggerSyncAction({
				syncScope,
				enableAiProcessing: aiProcessing,
				telegramAccountKey,
			});
			if (!result?.data?.queued) {
				throw new Error(result?.data?.error ?? result?.serverError ?? 'Sync could not start');
			}
			setSyncStarted(true);
		} catch (err) {
			console.error('[sync] Failed to trigger sync:', err);
			const detail = err instanceof Error && err.message ? err.message : 'Sync could not start';
			setSyncError(`${detail}. Make sure the local worker and Redis are running, then try again.`);
		} finally {
			setStarting(false);
		}
	}

	function disconnectLocalTelegramSession() {
		setDisconnectError(null);
		startDisconnectTransition(async () => {
			const result = await disconnectTelegramAction({});
			if (result?.data?.disconnected) {
				setSessionDisconnected(true);
				return;
			}

			setDisconnectError(result?.serverError ?? 'Could not disconnect the local Telegram session.');
		});
	}

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

	if (!hydrated || !recoveryChecked || !workspaceId) return null;

	const showAiControl = AI_SYNC_ENABLED && syncScope !== 'contacts_only';
	const safetyDetails = getSyncScopeSafetyDetails(syncScope);
	const aiProcessingImportDescription = getAiProcessingImportDescription();

	return (
		<OnboardingCard className="max-w-xl">
			<div className="mb-6">
				<h1 className="text-2xl font-bold text-foreground">
					{syncStarted ? 'Discovering your network' : 'Choose what to import'}
				</h1>
				<p className="mt-2 text-sm text-muted-foreground">
					{syncStarted
						? getSyncStartedDescription(syncScope)
						: 'Telegram is connected in read-only mode for this import flow.'}
				</p>
			</div>

			{syncStarted ? (
				<LiveSyncFeed
					contacts={contacts}
					messages={messages}
					stage={stage}
					isComplete={isComplete}
					recentContacts={recentContacts}
					feedEvents={feedEvents}
					staleContacts={staleContacts}
				/>
			) : (
				<div className="space-y-4">
					<div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
						This starts a small local test import. After onboarding, the dashboard can run the
						slower local history import.
					</div>

					<div className="rounded-lg border border-border bg-card p-4">
						<div className="flex items-center justify-between gap-3">
							<p className="text-sm font-medium text-foreground">Import safety</p>
							<span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
								Read-only
							</span>
						</div>
						<ul className="mt-3 space-y-2">
							{safetyDetails.map((detail) => (
								<li key={detail} className="flex gap-2 text-sm text-muted-foreground">
									<span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />
									<span>{detail}</span>
								</li>
							))}
						</ul>
					</div>

					{telegramAccounts.length > 1 ? (
						<label className="block rounded-lg border border-border bg-card p-4">
							<span className="block text-sm font-medium text-foreground">Telegram account</span>
							<span className="mt-1 block text-sm text-muted-foreground">
								Choose which linked account to use for this local import.
							</span>
							<select
								value={telegramAccountKey}
								onChange={(event) => setTelegramAccountKey(event.currentTarget.value)}
								className="mt-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
							>
								{telegramAccounts.map((account) => (
									<option key={account.key} value={account.key}>
										{account.label}
									</option>
								))}
							</select>
						</label>
					) : null}

					<div className="space-y-3">
						{SYNC_OPTIONS.map((option) => (
							<label
								key={option.value}
								className={`block cursor-pointer rounded-lg border p-4 transition-colors ${
									syncScope === option.value
										? 'border-primary bg-primary/5'
										: 'border-border bg-card hover:bg-muted/40'
								}`}
							>
								<div className="flex gap-3">
									<input
										type="radio"
										name="syncScope"
										value={option.value}
										checked={syncScope === option.value}
										onChange={() => setSyncScope(option.value)}
										className="mt-1 h-4 w-4 accent-primary"
									/>
									<div>
										<p className="text-sm font-medium text-foreground">{option.title}</p>
										<p className="mt-1 text-sm text-muted-foreground">{option.description}</p>
									</div>
								</div>
							</label>
						))}
					</div>

					{showAiControl ? (
						<label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-muted/40 p-4">
							<input
								type="checkbox"
								checked={resolveAiProcessingForSync({
									requested: enableAiProcessing,
									syncScope,
								})}
								onChange={(e) => setEnableAiProcessing(e.target.checked)}
								className="mt-1 h-4 w-4 accent-primary"
							/>
							<span>
								<span className="block text-sm font-medium text-foreground">
									Allow AI analysis for imported messages
								</span>
								<span className="mt-1 block text-sm text-muted-foreground">
									{aiProcessingImportDescription}
								</span>
							</span>
						</label>
					) : null}

					<Button onClick={startSync} disabled={starting} className="w-full">
						{starting ? 'Starting sync...' : 'Start selected import'}
					</Button>
				</div>
			)}

			{syncError ? (
				<div className="mt-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
					{syncError}
				</div>
			) : null}

			{syncStarted && isComplete ? (
				<div className="mt-6 rounded-lg border border-border bg-muted/40 px-4 py-3">
					<p className="text-sm font-medium text-foreground">Telegram session safety</p>
					<p className="mt-1 text-sm text-muted-foreground">
						Imported CRM data stays encrypted locally. Keeping the Telegram session connected allows
						future syncs; disconnecting removes Gordian&apos;s local Telegram session without
						deleting the contacts or messages already imported.
					</p>
					{sessionDisconnected ? (
						<p className="mt-3 text-sm text-green-700">
							Local Telegram session disconnected. You can also revoke it in Telegram Settings &gt;
							Devices.
						</p>
					) : (
						<div className="mt-3">
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={disconnectLocalTelegramSession}
								disabled={isDisconnectPending}
							>
								{isDisconnectPending ? 'Disconnecting...' : 'Disconnect local Telegram session'}
							</Button>
							{disconnectError ? (
								<p className="mt-2 text-sm text-destructive">{disconnectError}</p>
							) : null}
						</div>
					)}
				</div>
			) : null}

			{syncStarted ? (
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
			) : null}
		</OnboardingCard>
	);
}
