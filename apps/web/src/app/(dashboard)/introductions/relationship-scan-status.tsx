'use client';

import { Activity, AlertTriangle, CheckCircle2, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAction } from 'next-safe-action/hooks';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
	cleanupRelationshipScanFailuresAction,
	getRelationshipScanStatusAction,
} from '@/app/actions/introductions';

type RelationshipScanStatus = {
	active: number;
	waiting: number;
	delayed: number;
	retainedFailed: number;
	resolvedFailed: number;
	failed: number;
	total: number;
	introductionJobs: number;
	connectionJobs: number;
	unknownJobs: number;
	progressReports: number;
	diagnostics: {
		messagesInBatch: number;
		freshSourceMessages: number;
		relationshipModelCalls: number;
		introductionKeywordMatches: number;
		introductionModelCalls: number;
		introductionRejected: number;
		connectionKeywordMatches: number;
		connectionModelCalls: number;
		connectionRejected: number;
	};
	oldestJobAt: string | null;
	newestJobAt: string | null;
	sampledAt: string;
};

const RELATIONSHIP_SCAN_WORKER_HELP =
	'Start the local worker with pnpm --filter worker dev or update WORKER_URL, then refresh scan status.';

function liveJobCount(status: RelationshipScanStatus | null) {
	if (!status) return 0;
	return status.active + status.waiting + status.delayed;
}

function statusLabel(status: RelationshipScanStatus | null, error: string | null) {
	if (error && !status) return 'Unavailable';
	if (!status) return 'Checking';
	if (liveJobCount(status) > 0) return 'Running';
	return 'Idle';
}

function scanStatusErrorDetail(error: string | null) {
	if (!error) return null;
	if (error.startsWith('Could not reach the local worker.')) return error;
	if (error === 'An unexpected error occurred. Please try again.') {
		return `Relationship scan status failed unexpectedly. ${RELATIONSHIP_SCAN_WORKER_HELP}`;
	}
	if (/worker|WORKER_URL|fetch failed|connection refused/i.test(error)) {
		return `${error}. ${RELATIONSHIP_SCAN_WORKER_HELP}`;
	}
	return error;
}

function formatDate(value: string | null) {
	if (!value) return 'Not available';
	return new Intl.DateTimeFormat(undefined, {
		hour: 'numeric',
		minute: '2-digit',
		month: 'short',
		day: 'numeric',
	}).format(new Date(value));
}

export function RelationshipScanStatusPanel() {
	const router = useRouter();
	const [status, setStatus] = useState<RelationshipScanStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [cleanupNotice, setCleanupNotice] = useState<string | null>(null);
	const previousLiveJobs = useRef(0);
	const { executeAsync, isExecuting } = useAction(getRelationshipScanStatusAction);
	const { executeAsync: cleanupAsync, isExecuting: isCleaning } = useAction(
		cleanupRelationshipScanFailuresAction,
	);

	const refreshStatus = useCallback(async () => {
		const result = await executeAsync({});
		if (result?.data) {
			const nextLiveJobs = liveJobCount(result.data);
			if (previousLiveJobs.current > 0 && nextLiveJobs === 0) {
				router.refresh();
			}
			previousLiveJobs.current = nextLiveJobs;
			setStatus(result.data);
			setError(null);
			return;
		}
		setError(result?.serverError ?? 'Scan status is unavailable');
	}, [executeAsync, router]);

	const cleanupResolvedFailures = useCallback(async () => {
		const result = await cleanupAsync({});
		if (result?.data) {
			setCleanupNotice(
				`Cleared ${result.data.removed.toLocaleString()} resolved retained failure${
					result.data.removed === 1 ? '' : 's'
				}.`,
			);
			await refreshStatus();
			return;
		}
		setCleanupNotice(null);
		setError(result?.serverError ?? 'Could not clear resolved scan failures');
	}, [cleanupAsync, refreshStatus]);

	useEffect(() => {
		void refreshStatus();
		const interval = window.setInterval(() => {
			void refreshStatus();
		}, 15_000);
		return () => window.clearInterval(interval);
	}, [refreshStatus]);

	const liveJobs = liveJobCount(status);
	const label = statusLabel(status, error);
	const Icon =
		error && !status
			? AlertTriangle
			: liveJobs > 0
				? Activity
				: status?.failed
					? AlertTriangle
					: CheckCircle2;
	const hasDiagnostics = Boolean(status?.progressReports);
	const errorDetail = scanStatusErrorDetail(error);

	return (
		<section className="mb-4 rounded-lg border border-border bg-background p-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div className="flex gap-3">
					<div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
						{isExecuting && !status ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<Icon className="size-4" />
						)}
					</div>
					<div>
						<div className="flex flex-wrap items-center gap-2">
							<h2 className="text-sm font-semibold text-foreground">Scan status</h2>
							<span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">
								{label}
							</span>
						</div>
						<p className="mt-1 text-sm text-muted-foreground">
							{error && !status
								? 'Relationship scan status is unavailable. Check worker configuration before queuing scans.'
								: !status
									? 'Checking the relationship scan queue for this workspace.'
									: liveJobs > 0
										? `${liveJobs.toLocaleString()} relationship scan job${liveJobs === 1 ? '' : 's'} still queued or active. Results appear after each job finishes.`
										: 'No relationship scan jobs are currently queued for this workspace.'}
						</p>
					</div>
				</div>
				<div className="flex shrink-0 gap-2">
					{status?.resolvedFailed ? (
						<button
							type="button"
							onClick={() => void cleanupResolvedFailures()}
							disabled={isCleaning}
							title="Clear resolved retained failures"
							aria-label="Clear resolved retained failures"
							className="inline-flex size-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted disabled:opacity-50"
						>
							{isCleaning ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Trash2 className="size-4" />
							)}
						</button>
					) : null}
					<button
						type="button"
						onClick={() => void refreshStatus()}
						disabled={isExecuting}
						title="Refresh scan status"
						aria-label="Refresh scan status"
						className="inline-flex size-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted disabled:opacity-50"
					>
						{isExecuting ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<RefreshCw className="size-4" />
						)}
					</button>
				</div>
			</div>

			<div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
				<div
					className={`h-full rounded-full bg-blue-600 transition-all ${
						liveJobs > 0 ? 'w-full animate-pulse' : 'w-0'
					}`}
				/>
			</div>

			{status ? (
				<div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
					<div className="rounded-md border border-border px-3 py-2">
						<span className="block font-medium text-foreground">Queue</span>
						{status.active.toLocaleString()} active, {status.waiting.toLocaleString()} waiting,{' '}
						{status.delayed.toLocaleString()} delayed
					</div>
					<div className="rounded-md border border-border px-3 py-2">
						<span className="block font-medium text-foreground">Live coverage</span>
						{status.introductionJobs.toLocaleString()} group-chat jobs,{' '}
						{status.connectionJobs.toLocaleString()} contact jobs
					</div>
					<div className="rounded-md border border-border px-3 py-2">
						<span className="block font-medium text-foreground">Last checked</span>
						{formatDate(status.sampledAt)}
					</div>
				</div>
			) : null}

			{hasDiagnostics && status ? (
				<div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
					<div className="rounded-md border border-border px-3 py-2">
						<span className="block font-medium text-foreground">Scan input</span>
						{status.diagnostics.freshSourceMessages.toLocaleString()} source messages from{' '}
						{status.diagnostics.messagesInBatch.toLocaleString()} queued messages
					</div>
					<div className="rounded-md border border-border px-3 py-2">
						<span className="block font-medium text-foreground">Keyword gates</span>
						{status.diagnostics.introductionKeywordMatches.toLocaleString()} intro,{' '}
						{status.diagnostics.connectionKeywordMatches.toLocaleString()} connection
					</div>
					<div className="rounded-md border border-border px-3 py-2">
						<span className="block font-medium text-foreground">Model calls</span>
						{status.diagnostics.introductionModelCalls.toLocaleString()} intro,{' '}
						{status.diagnostics.connectionModelCalls.toLocaleString()} connection
					</div>
				</div>
			) : null}

			{status?.failed ? (
				<p className="mt-3 text-xs text-amber-700">
					{status.failed.toLocaleString()} unresolved retained failed job
					{status.failed === 1 ? '' : 's'} exist for this workspace. Current jobs can still
					continue, but this should be reviewed if the count grows.
				</p>
			) : null}

			{status?.resolvedFailed ? (
				<p className="mt-3 text-xs text-muted-foreground">
					{status.resolvedFailed.toLocaleString()} resolved retained failure
					{status.resolvedFailed === 1 ? '' : 's'} can be cleared. These are old jobs from a fixed
					scan configuration and do not block current scans.
				</p>
			) : null}

			{cleanupNotice ? <p className="mt-3 text-xs text-emerald-700">{cleanupNotice}</p> : null}

			{status?.oldestJobAt && liveJobs > 0 ? (
				<p className="mt-2 text-xs text-muted-foreground">
					Oldest queued job: {formatDate(status.oldestJobAt)}.
				</p>
			) : null}

			{errorDetail ? <p className="mt-3 text-xs text-red-700">{errorDetail}</p> : null}
		</section>
	);
}
