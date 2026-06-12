'use client';

import { TELEGRAM_CONSENT_VERSION, type TelegramSyncScope } from '@repo/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { saveConsentAction } from '@/app/actions/calibration';
import { resolveAiProcessingForSync, SYNC_OPTIONS } from '@/app/onboarding/sync/sync-settings';
import { OnboardingCard } from '@/components/onboarding/onboarding-card';
import { useOnboarding } from '@/components/onboarding/onboarding-provider';
import { Button } from '@/components/ui/button';

type SafetyTone = 'ok' | 'neutral' | 'warn';

type SafetyItem = {
	detail: string;
	label: string;
	status: string;
	tone: SafetyTone;
};

type OnboardingStatus = {
	consent: {
		aiAnalysis: boolean;
		dataProcessing: boolean;
		telegramAccess: boolean;
		version: number;
	} | null;
	hasCurrentTelegramConsent: boolean;
	runtimeSafety: {
		aiAvailable: boolean;
		aiDescription: string;
		items: SafetyItem[];
	};
	telegramAccounts: Array<{ key: string; label: string }>;
	telegramImportOnlyMode: boolean;
	workspaceId: string | null;
};

const toneClassName: Record<SafetyTone, string> = {
	ok: 'border-emerald-200 bg-emerald-50 text-emerald-900',
	neutral: 'border-border bg-muted/40 text-foreground',
	warn: 'border-amber-200 bg-amber-50 text-amber-900',
};

function PermissionCheckbox({
	checked,
	description,
	disabled,
	label,
	onChange,
	required,
}: {
	checked: boolean;
	description: string;
	disabled?: boolean;
	label: string;
	onChange: (checked: boolean) => void;
	required?: boolean;
}) {
	return (
		<label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-background p-4">
			<input
				type="checkbox"
				checked={checked}
				disabled={disabled}
				required={required}
				onChange={(event) => onChange(event.currentTarget.checked)}
				className="mt-1 h-4 w-4 shrink-0 accent-primary"
			/>
			<span>
				<span className="block text-sm font-medium text-foreground">{label}</span>
				<span className="mt-1 block text-sm text-muted-foreground">{description}</span>
			</span>
		</label>
	);
}

export default function PermissionsPage() {
	const router = useRouter();
	const {
		enableAiProcessing,
		hydrated,
		setConsentAcknowledged,
		setEnableAiProcessing,
		setSyncScope,
		setWorkspaceId,
		syncScope,
		workspaceId,
	} = useOnboarding();
	const [status, setStatus] = useState<OnboardingStatus | null>(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [consentDataProcessing, setConsentDataProcessing] = useState(true);
	const [consentTelegramAccess, setConsentTelegramAccess] = useState(true);
	const [consentAiAnalysis, setConsentAiAnalysis] = useState(false);
	const [runAiDuringInitialImport, setRunAiDuringInitialImport] = useState(enableAiProcessing);

	useEffect(() => {
		if (!hydrated) return;

		let cancelled = false;
		async function loadStatus() {
			try {
				const response = await fetch('/api/onboarding/status', { cache: 'no-store' });
				if (response.status === 401) {
					router.replace('/login');
					return;
				}
				if (!response.ok) {
					throw new Error('Could not load onboarding permissions.');
				}

				const data = (await response.json()) as OnboardingStatus;
				if (cancelled) return;

				if (!data.workspaceId) {
					router.replace('/onboarding/connect');
					return;
				}
				if (data.telegramAccounts.length === 0) {
					router.replace('/onboarding/connect');
					return;
				}
				if (!workspaceId) {
					setWorkspaceId(data.workspaceId);
				}
				if (data.hasCurrentTelegramConsent) {
					setConsentAcknowledged(true);
				}

				setStatus(data);
				setConsentDataProcessing(data.consent?.dataProcessing ?? true);
				setConsentTelegramAccess(data.consent?.telegramAccess ?? true);
				setConsentAiAnalysis(data.consent?.aiAnalysis ?? false);
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : 'Could not load onboarding permissions.');
				}
			} finally {
				if (!cancelled) setLoading(false);
			}
		}

		void loadStatus();
		return () => {
			cancelled = true;
		};
	}, [hydrated, router, setConsentAcknowledged, setWorkspaceId, workspaceId]);

	const aiAvailable = status?.runtimeSafety.aiAvailable === true;
	const initialImportCanRunAi = aiAvailable && consentAiAnalysis && syncScope !== 'contacts_only';
	const continueLabel = status?.telegramImportOnlyMode
		? 'Save and open dashboard import'
		: 'Save and continue';
	const aiDescription =
		status?.runtimeSafety.aiDescription ??
		'AI analysis is not configured, so imported messages will not be sent to AI providers.';

	useEffect(() => {
		if (initialImportCanRunAi) return;
		setRunAiDuringInitialImport(false);
		setEnableAiProcessing(false);
	}, [initialImportCanRunAi, setEnableAiProcessing]);

	function updateSyncScope(nextScope: TelegramSyncScope) {
		setSyncScope(nextScope);
		if (nextScope === 'contacts_only') {
			setRunAiDuringInitialImport(false);
			setEnableAiProcessing(false);
		}
	}

	function updateInitialAiRun(enabled: boolean) {
		const resolved = resolveAiProcessingForSync({
			aiSyncEnabled: aiAvailable && consentAiAnalysis,
			requested: enabled,
			syncScope,
		});
		setRunAiDuringInitialImport(resolved);
		setEnableAiProcessing(resolved);
	}

	async function handleSubmit(event: React.FormEvent) {
		event.preventDefault();
		if (!consentDataProcessing || !consentTelegramAccess) {
			setError('Telegram access and local data processing consent are required before import.');
			return;
		}

		setSaving(true);
		setError(null);
		try {
			const result = await saveConsentAction({
				consentDataProcessing,
				consentAiAnalysis: aiAvailable && consentAiAnalysis,
				consentTelegramAccess,
				consentVersion: TELEGRAM_CONSENT_VERSION,
			});

			if (!result?.data?.saved) {
				throw new Error(result?.serverError ?? 'Consent could not be saved.');
			}

			setConsentAcknowledged(true);
			setEnableAiProcessing(
				resolveAiProcessingForSync({
					aiSyncEnabled: aiAvailable && consentAiAnalysis,
					requested: runAiDuringInitialImport,
					syncScope,
				}),
			);
			router.push(status?.telegramImportOnlyMode ? '/' : '/onboarding/sync');
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Consent could not be saved.');
		} finally {
			setSaving(false);
		}
	}

	if (!hydrated || loading) {
		return (
			<OnboardingCard className="max-w-xl">
				<h1 className="text-2xl font-bold text-foreground">Loading permissions...</h1>
			</OnboardingCard>
		);
	}

	return (
		<OnboardingCard className="max-w-2xl">
			<div className="mb-6">
				<h1 className="text-2xl font-bold text-foreground">Choose permissions</h1>
				<p className="mt-2 text-sm text-muted-foreground">
					Save the durable consent settings once. Higher-risk choices like large import and backfill
					still require confirmation when you start a run.
				</p>
			</div>

			{error ? (
				<div className="mb-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
					{error}
				</div>
			) : null}

			<form onSubmit={handleSubmit} className="space-y-5">
				<div className="space-y-3">
					<PermissionCheckbox
						checked={consentTelegramAccess}
						required
						label="Allow read-only Telegram access"
						description="Required for imports. Message sending remains disabled in this local setup."
						onChange={setConsentTelegramAccess}
					/>
					<PermissionCheckbox
						checked={consentDataProcessing}
						required
						label="Allow local data processing"
						description="Required to store, index, and display imported CRM data in the local workspace."
						onChange={setConsentDataProcessing}
					/>
					<PermissionCheckbox
						checked={aiAvailable && consentAiAnalysis}
						disabled={!aiAvailable}
						label="Allow AI analysis for imported messages"
						description={
							aiAvailable
								? aiDescription
								: 'AI analysis is not configured, so imported messages will not be sent to AI providers.'
						}
						onChange={setConsentAiAnalysis}
					/>
				</div>

				{status?.telegramImportOnlyMode ? (
					<div className="rounded-lg border border-border bg-muted/40 p-4">
						<p className="text-sm font-medium text-foreground">Import path</p>
						<p className="mt-1 text-sm text-muted-foreground">
							This local setup opens the saved MTProto session only inside the dashboard history
							import flow. Large import, backfill older history, and run-AI-during-import stay
							explicit per-run controls.
						</p>
					</div>
				) : (
					<div className="space-y-3">
						<p className="text-sm font-medium text-foreground">Initial import scope</p>
						{SYNC_OPTIONS.map((option) => (
							<label
								key={option.value}
								className={`block cursor-pointer rounded-lg border p-4 transition-colors ${
									syncScope === option.value
										? 'border-primary bg-primary/5'
										: 'border-border bg-background hover:bg-muted/40'
								}`}
							>
								<div className="flex gap-3">
									<input
										type="radio"
										name="syncScope"
										value={option.value}
										checked={syncScope === option.value}
										onChange={() => updateSyncScope(option.value)}
										className="mt-1 h-4 w-4 accent-primary"
									/>
									<span>
										<span className="block text-sm font-medium text-foreground">
											{option.title}
										</span>
										<span className="mt-1 block text-sm text-muted-foreground">
											{option.description}
										</span>
									</span>
								</div>
							</label>
						))}

						<PermissionCheckbox
							checked={runAiDuringInitialImport}
							disabled={!initialImportCanRunAi}
							label="Run AI during the initial import"
							description="Leave off to import faster and analyze later. This does not affect the durable AI consent setting above."
							onChange={updateInitialAiRun}
						/>
					</div>
				)}

				<div className="rounded-lg border border-border bg-muted/30 p-4">
					<div className="flex items-center justify-between gap-3">
						<p className="text-sm font-medium text-foreground">Protection on this Mac</p>
						<Link
							href="/settings"
							className="text-xs font-medium text-primary hover:text-primary/80"
						>
							Settings
						</Link>
					</div>
					<div className="mt-3 grid gap-2 sm:grid-cols-2">
						{status?.runtimeSafety.items.map((item) => (
							<div
								key={item.label}
								className={`rounded-md border px-3 py-2 ${toneClassName[item.tone]}`}
							>
								<div className="flex items-center justify-between gap-2">
									<p className="text-xs font-medium">{item.label}</p>
									<p className="text-xs">{item.status}</p>
								</div>
								<p className="mt-1 text-xs opacity-80">{item.detail}</p>
							</div>
						))}
					</div>
					<p className="mt-3 text-xs text-muted-foreground">
						Setup runs before browser onboarding with{' '}
						<code className="rounded bg-background px-1 py-0.5">pnpm telegram:setup</code>,{' '}
						<code className="rounded bg-background px-1 py-0.5">pnpm telegram:touchid:probe</code>,
						and <code className="rounded bg-background px-1 py-0.5">pnpm telegram:doctor</code>.
						More detail lives in{' '}
						<code className="rounded bg-background px-1 py-0.5">
							docs/ONBOARDING_PERMISSIONS.md
						</code>
						.
					</p>
				</div>

				<div className="flex flex-col gap-3 sm:flex-row">
					<Button type="submit" disabled={saving} className="flex-1">
						{saving ? 'Saving...' : continueLabel}
					</Button>
					<Button type="button" variant="outline" asChild>
						<Link href="/onboarding/connect">Back</Link>
					</Button>
				</div>
			</form>
		</OnboardingCard>
	);
}
