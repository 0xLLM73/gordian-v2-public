'use client';

import {
	cancelTelegramImportAction,
	getTelegramImportStatusAction,
	pauseTelegramImportAction,
	resumeTelegramImportAction,
	startTelegramImportAction,
} from '@/app/actions/sync';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
	AlertTriangle,
	CheckCircle2,
	Database,
	Loader2,
	Pause,
	Play,
	ShieldCheck,
	Square,
} from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';

type ImportStatus =
	| 'queued'
	| 'discovering'
	| 'importing'
	| 'pausing'
	| 'paused'
	| 'cancelling'
	| 'cancelled'
	| 'completed'
	| 'failed';

interface ImportProgress {
	runId: string;
	status: ImportStatus;
	totalDialogs: number;
	eligibleDialogs: number;
	skippedDialogs: number;
	chatsQueued: number;
	chatsCompleted: number;
	chatsFailed: number;
	messagesSeen: number;
	messagesInserted: number;
	duplicateMessages: number;
	pagesFetched: number;
	lastHeartbeatAt: string | null;
	errorCode: string | null;
	errorMessage: string | null;
}

type TelegramAccountOption = {
	key: string;
	label: string;
};

const activeStatuses = new Set<ImportStatus>([
	'queued',
	'discovering',
	'importing',
	'pausing',
	'cancelling',
]);

function statusLabel(status: ImportStatus | 'idle') {
	const labels: Record<ImportStatus | 'idle', string> = {
		idle: 'Not started',
		queued: 'Queued',
		discovering: 'Finding chats',
		importing: 'Importing',
		pausing: 'Pausing',
		paused: 'Paused',
		cancelling: 'Cancelling',
		cancelled: 'Cancelled',
		completed: 'Complete',
		failed: 'Failed',
	};
	return labels[status];
}

function formatNumber(value: number) {
	return new Intl.NumberFormat().format(value);
}

function importProgressDescription(progress: ImportProgress | null) {
	if (!progress) {
		return 'Run the small onboarding sync first, then use this slower local import when you want more private-chat and group history.';
	}

	const eligibleSummary = `${formatNumber(progress.eligibleDialogs)} eligible chats found, ${formatNumber(progress.skippedDialogs)} skipped.`;
	switch (progress.status) {
		case 'completed':
			return `${eligibleSummary} Latest import completed with ${formatNumber(progress.messagesInserted)} messages inserted across ${formatNumber(progress.chatsCompleted)} of ${formatNumber(progress.chatsQueued)} chats.`;
		case 'failed':
			return `${eligibleSummary} Latest import failed after ${formatNumber(progress.messagesInserted)} messages were inserted. Check the redacted worker logs before retrying.`;
		case 'cancelled':
			return `${eligibleSummary} Latest import was cancelled after ${formatNumber(progress.messagesInserted)} messages were inserted.`;
		case 'paused':
			return `${eligibleSummary} Import is paused. Resume to continue from the saved offset, or cancel to stop this run.`;
		default:
			return `${eligibleSummary} Keep the local app and worker running while import is active.`;
	}
}

const importSafetyItems = [
	{ label: 'Message sending', value: 'Off' },
	{ label: 'AI analysis', value: 'Off' },
	{ label: 'Channels', value: 'Skipped' },
	{ label: 'Exports', value: 'Skipped' },
	{ label: 'Unlocks', value: 'Per import' },
	{ label: 'Local worker', value: 'Required' },
] as const;

export function TelegramImportManagerCard({ disabledReason }: { disabledReason?: string }) {
	const confirmationId = useId();
	const [progress, setProgress] = useState<ImportProgress | null>(null);
	const [lastDataImport, setLastDataImport] = useState<ImportProgress | null>(null);
	const [loading, setLoading] = useState(true);
	const [mutating, setMutating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [largeImportConfirmed, setLargeImportConfirmed] = useState(false);
	const [telegramAccounts, setTelegramAccounts] = useState<TelegramAccountOption[]>([]);
	const [telegramAccountKey, setTelegramAccountKey] = useState('0');

	const loadStatus = useCallback(async () => {
		const result = await getTelegramImportStatusAction({});
		const accounts = (result?.data?.telegramAccounts ?? []) as TelegramAccountOption[];
		setTelegramAccounts(accounts);
		setTelegramAccountKey((current) =>
			accounts.length > 0 && !accounts.some((account) => account.key === current)
				? (accounts[0]?.key ?? '0')
				: current,
		);
		if (result?.data?.import) {
			setProgress(result.data.import as ImportProgress);
		} else {
			setProgress(null);
		}
		if (result?.data?.lastDataImport) {
			setLastDataImport(result.data.lastDataImport as ImportProgress);
		} else {
			setLastDataImport(null);
		}
		setLoading(false);
	}, []);

	useEffect(() => {
		loadStatus().catch(() => {
			setError('Could not load Telegram import status.');
			setLoading(false);
		});
	}, [loadStatus]);

	useEffect(() => {
		if (!progress || !activeStatuses.has(progress.status)) return;
		const id = window.setInterval(() => {
			loadStatus().catch(() => {});
		}, 4000);
		return () => window.clearInterval(id);
	}, [loadStatus, progress]);

	const active = progress ? activeStatuses.has(progress.status) : false;
	const canStart =
		!disabledReason && largeImportConfirmed && !active && progress?.status !== 'paused';
	const canPause =
		progress?.runId && ['queued', 'discovering', 'importing'].includes(progress.status);
	const canResume = !disabledReason && progress?.runId && progress.status === 'paused';
	const canCancel =
		progress?.runId &&
		['queued', 'discovering', 'importing', 'pausing', 'paused'].includes(progress.status);
	const showRunControls = progress ? active || progress.status === 'paused' : false;
	const chatProgress = useMemo(() => {
		if (!progress?.chatsQueued) return 0;
		return Math.min(100, Math.round((progress.chatsCompleted / progress.chatsQueued) * 100));
	}, [progress]);
	const latestIsNoopAfterDataImport =
		progress &&
		lastDataImport &&
		progress.runId !== lastDataImport.runId &&
		progress.status === 'completed' &&
		progress.chatsQueued === 0 &&
		progress.messagesInserted === 0 &&
		(lastDataImport.messagesInserted > 0 || lastDataImport.pagesFetched > 0);

	async function mutate(action: () => Promise<unknown>) {
		setMutating(true);
		setError(null);
		try {
			const result = (await action()) as { serverError?: string } | undefined;
			if (result?.serverError) throw new Error(result.serverError);
			await loadStatus();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Telegram import action failed.');
		} finally {
			setMutating(false);
		}
	}

	const status = progress?.status ?? 'idle';
	const busy = loading || mutating;

	return (
		<Card className="mt-6 rounded-lg">
			<CardHeader className="gap-3 sm:flex sm:flex-row sm:items-start sm:justify-between">
				<div className="space-y-2">
					<CardTitle className="flex items-center gap-2 text-base">
						<Database className="h-4 w-4" />
						Telegram history import
					</CardTitle>
					<CardDescription>
						Local import for eligible private chats and groups. Channels, bots, exports, message
						sending, and AI analysis stay off.
					</CardDescription>
				</div>
				<div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
					{status === 'completed' ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : null}
					{status === 'failed' ? <AlertTriangle className="h-4 w-4 text-destructive" /> : null}
					{active ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
					<span>{statusLabel(status)}</span>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				{disabledReason ? (
					<div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
						{disabledReason}
					</div>
				) : null}
				{error ? (
					<div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
						{error}
					</div>
				) : null}
				{progress?.errorMessage ? (
					<div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
						{progress.errorMessage}
					</div>
				) : null}
				{latestIsNoopAfterDataImport ? (
					<div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
						Latest check completed with no new chats to import. Last data import added{' '}
						{formatNumber(lastDataImport.messagesInserted)} messages across{' '}
						{formatNumber(lastDataImport.chatsCompleted)} of{' '}
						{formatNumber(lastDataImport.chatsQueued)} chats and fetched{' '}
						{formatNumber(lastDataImport.pagesFetched)} pages.
					</div>
				) : null}

				<div className="rounded-md border border-border bg-muted/30 px-3 py-3">
					<div className="flex items-center gap-2 text-sm font-medium text-foreground">
						<ShieldCheck className="h-4 w-4 text-emerald-600" />
						Import safety
					</div>
					<div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
						{importSafetyItems.map((item) => (
							<div
								key={item.label}
								className="min-h-12 rounded-md border border-border bg-background px-3 py-2"
							>
								<div className="text-xs text-muted-foreground">{item.label}</div>
								<div className="mt-1 text-sm font-medium text-foreground">{item.value}</div>
							</div>
						))}
					</div>
				</div>

				<div className="grid gap-3 sm:grid-cols-5">
					<Metric
						label="Chats"
						value={`${formatNumber(progress?.chatsCompleted ?? 0)} / ${formatNumber(progress?.chatsQueued ?? 0)}`}
					/>
					<Metric label="Failed" value={formatNumber(progress?.chatsFailed ?? 0)} />
					<Metric label="Messages" value={formatNumber(progress?.messagesInserted ?? 0)} />
					<Metric label="Duplicates" value={formatNumber(progress?.duplicateMessages ?? 0)} />
					<Metric label="Pages" value={formatNumber(progress?.pagesFetched ?? 0)} />
				</div>

				<div className="h-2 overflow-hidden rounded-full bg-muted">
					<div
						className="h-full rounded-full bg-foreground transition-all"
						style={{ width: `${chatProgress}%` }}
					/>
				</div>

				{telegramAccounts.length > 1 ? (
					<label className="block rounded-md border border-border bg-background px-3 py-2 text-sm">
						<span className="block font-medium text-foreground">Telegram account</span>
						<span className="mt-1 block text-muted-foreground">
							Choose which linked account to use for this local import.
						</span>
						<select
							value={telegramAccountKey}
							disabled={active || busy}
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

				<label
					htmlFor={confirmationId}
					className="flex items-start gap-3 rounded-md border bg-background px-3 py-2 text-sm"
				>
					<input
						id={confirmationId}
						type="checkbox"
						className="mt-1 h-4 w-4 shrink-0"
						checked={largeImportConfirmed}
						disabled={Boolean(disabledReason) || active || progress?.status === 'paused' || busy}
						onChange={(event) => setLargeImportConfirmed(event.currentTarget.checked)}
					/>
					<span>
						Start a local large import for eligible private chats and groups. This can take time on
						large accounts; the local worker keeps Telegram open only for this import run and
						disconnects it when the run completes, pauses, cancels, or fails.
					</span>
				</label>

				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						size="sm"
						onClick={() =>
							mutate(() =>
								startTelegramImportAction({
									confirmLargeImport: true,
									telegramAccountKey,
								}),
							)
						}
						disabled={!canStart || busy}
					>
						{busy && canStart ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<Play className="h-4 w-4" />
						)}
						Start large import
					</Button>
					{showRunControls ? (
						<>
							<Button
								type="button"
								size="sm"
								variant="outline"
								onClick={() =>
									progress?.runId
										? mutate(() => pauseTelegramImportAction({ runId: progress.runId }))
										: undefined
								}
								disabled={!canPause || busy}
							>
								<Pause className="h-4 w-4" />
								Pause
							</Button>
							<Button
								type="button"
								size="sm"
								variant="outline"
								onClick={() =>
									progress?.runId
										? mutate(() => resumeTelegramImportAction({ runId: progress.runId }))
										: undefined
								}
								disabled={!canResume || busy}
							>
								<Play className="h-4 w-4" />
								Resume
							</Button>
							<Button
								type="button"
								size="sm"
								variant="outline"
								onClick={() =>
									progress?.runId
										? mutate(() => cancelTelegramImportAction({ runId: progress.runId }))
										: undefined
								}
								disabled={!canCancel || busy}
							>
								<Square className="h-4 w-4" />
								Cancel
							</Button>
						</>
					) : null}
				</div>

				<div className="text-xs text-muted-foreground">{importProgressDescription(progress)}</div>
				{lastDataImport && (!progress || progress.runId !== lastDataImport.runId) ? (
					<div className="text-xs text-muted-foreground">
						Last data import: {formatNumber(lastDataImport.messagesInserted)} messages,{' '}
						{formatNumber(lastDataImport.chatsCompleted)} /{' '}
						{formatNumber(lastDataImport.chatsQueued)} chats,{' '}
						{formatNumber(lastDataImport.pagesFetched)} pages.
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}

function Metric({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-md border bg-background px-3 py-2">
			<div className="text-xs text-muted-foreground">{label}</div>
			<div className="mt-1 text-sm font-medium text-foreground">{value}</div>
		</div>
	);
}
