'use client';

import { saveConsentAction } from '@/app/actions/calibration';
import { TELEGRAM_CONSENT_VERSION } from '@repo/shared';
import { useMemo, useState, useTransition } from 'react';

interface AiAnalysisConsentProps {
	aiAvailable: boolean;
	consentAiAnalysis: boolean;
	consentDataProcessing: boolean;
	consentTelegramAccess: boolean;
}

export function AiAnalysisConsent({
	aiAvailable,
	consentAiAnalysis,
	consentDataProcessing,
	consentTelegramAccess,
}: AiAnalysisConsentProps) {
	const [enabled, setEnabled] = useState(consentAiAnalysis);
	const [savedEnabled, setSavedEnabled] = useState(consentAiAnalysis);
	const [status, setStatus] = useState<'error' | 'saved' | null>(null);
	const [isPending, startTransition] = useTransition();
	const changed = enabled !== savedEnabled;
	const disabled = !aiAvailable || isPending;
	const statusLabel = enabled ? 'Enabled' : 'Off';
	const savedStatusLabel = savedEnabled ? 'Saved on' : 'Saved off';
	const detail = useMemo(() => {
		if (!aiAvailable) return 'Local or vendor AI analysis is not configured for this build.';
		if (changed) {
			return enabled
				? 'AI analysis will remain blocked until this setting is saved.'
				: 'AI analysis will remain enabled until this change is saved.';
		}
		return savedEnabled
			? 'Imported messages may be analyzed by configured local models.'
			: 'Knowledge analysis, chat, and digest generation remain blocked.';
	}, [aiAvailable, changed, enabled, savedEnabled]);

	function handleSave() {
		if (disabled || !changed) return;
		setStatus(null);
		startTransition(async () => {
			const result = await saveConsentAction({
				consentDataProcessing: consentDataProcessing || enabled,
				consentAiAnalysis: enabled,
				consentTelegramAccess,
				consentVersion: TELEGRAM_CONSENT_VERSION,
			});
			if (result?.data?.saved) {
				setSavedEnabled(enabled);
				setStatus('saved');
			} else {
				setStatus('error');
			}
		});
	}

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<p className="text-sm font-medium text-foreground">AI analysis</p>
					<p className="mt-1 text-sm text-muted-foreground">{detail}</p>
				</div>
				<span
					className={`rounded-full px-2 py-0.5 text-xs font-medium ${
						enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'
					}`}
				>
					{statusLabel}
				</span>
			</div>
			<div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
				<span className="font-medium text-foreground">Persisted status:</span> {savedStatusLabel}
				{changed ? (
					<span className="ml-2 text-yellow-700">Unsaved change</span>
				) : aiAvailable ? (
					<span className="ml-2">Current workspace setting is in sync.</span>
				) : (
					<span className="ml-2">Runtime configuration blocks saving AI analysis on.</span>
				)}
			</div>

			<label
				className={`flex items-start gap-3 rounded-md border border-border bg-muted/40 p-3 ${
					aiAvailable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'
				}`}
			>
				<input
					type="checkbox"
					checked={enabled}
					disabled={!aiAvailable}
					onChange={(event) => {
						setEnabled(event.currentTarget.checked);
						setStatus(null);
					}}
					className="mt-0.5 h-4 w-4 accent-primary"
				/>
				<span>
					<span className="block text-sm font-medium text-foreground">
						Allow AI analysis for imported messages
					</span>
					<span className="mt-1 block text-sm text-muted-foreground">
						Applies to knowledge extraction, chat, digest generation, and message-derived CRM
						analysis.
					</span>
				</span>
			</label>

			<div className="flex items-center gap-3">
				<button
					type="button"
					onClick={handleSave}
					disabled={disabled || !changed}
					className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
				>
					{isPending ? 'Saving...' : 'Save'}
				</button>
				{status === 'saved' ? <span className="text-sm text-green-600">Saved</span> : null}
				{status === 'error' ? (
					<span className="text-sm text-destructive">Could not save consent</span>
				) : null}
			</div>
		</div>
	);
}
