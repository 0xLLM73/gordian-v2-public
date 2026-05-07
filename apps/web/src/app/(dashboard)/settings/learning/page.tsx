'use client';

import {
	getReviewQueueStatsAction,
	listPendingExamplesAction,
	promoteToGoldAction,
	rejectExampleAction,
} from '@/app/actions/golden-dataset';
import { useAction } from 'next-safe-action/hooks';
import { useCallback, useEffect, useState } from 'react';

const PAGE_SIZE = 20;

const DOMAINS = ['commitment_extraction', 'summary_generation', 'draft_generation'] as const;

const sourceBadge: Record<string, string> = {
	implicit_signal: 'bg-amber-100 text-amber-700',
	user_edit: 'bg-blue-100 text-blue-700',
	expert_review: 'bg-purple-100 text-purple-700',
};

const difficultyBadge: Record<string, string> = {
	trivial: 'bg-muted text-muted-foreground',
	standard: 'bg-blue-100 text-blue-700',
	edge_case: 'bg-red-100 text-red-700',
};

function formatTimestamp(ts: string | Date): string {
	const d = typeof ts === 'string' ? new Date(ts) : ts;
	return d.toLocaleString(undefined, {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}

function formatJson(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

export default function LearningReviewPage() {
	const [domain, setDomain] = useState<string>('');
	const [offset, setOffset] = useState(0);

	const { execute: loadStats, result: statsResult } = useAction(getReviewQueueStatsAction);
	const {
		execute: loadExamples,
		result: examplesResult,
		isPending,
	} = useAction(listPendingExamplesAction);
	const { execute: promote, isPending: isPromoting } = useAction(promoteToGoldAction);
	const { execute: reject, isPending: isRejecting } = useAction(rejectExampleAction);

	const stats = statsResult?.data ?? { pending: 0, verified: 0, rejected: 0 };
	const examples = examplesResult?.data?.examples ?? [];

	const reload = useCallback(() => {
		loadStats({});
		const input: { limit: number; offset: number; featureDomain?: string } = {
			limit: PAGE_SIZE,
			offset,
		};
		if (domain) input.featureDomain = domain;
		loadExamples(input);
	}, [domain, offset, loadStats, loadExamples]);

	useEffect(() => {
		reload();
	}, [reload]);

	async function handlePromote(goldenId: string) {
		await promote({ goldenId });
		reload();
	}

	async function handleReject(goldenId: string) {
		await reject({ goldenId });
		reload();
	}

	const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
	const hasMore = examples.length === PAGE_SIZE;

	return (
		<div>
			<h1 className="mb-6 text-2xl font-bold text-foreground">AI Learning Queue</h1>

			{/* Stats bar */}
			<div className="mb-6 grid grid-cols-3 gap-4">
				<div className="rounded-lg border border-border bg-card p-4">
					<p className="text-xs font-medium uppercase text-muted-foreground">Pending Review</p>
					<p className="mt-1 text-2xl font-bold text-amber-600">{stats.pending}</p>
				</div>
				<div className="rounded-lg border border-border bg-card p-4">
					<p className="text-xs font-medium uppercase text-muted-foreground">Verified (Gold)</p>
					<p className="mt-1 text-2xl font-bold text-green-600">{stats.verified}</p>
				</div>
				<div className="rounded-lg border border-border bg-card p-4">
					<p className="text-xs font-medium uppercase text-muted-foreground">Rejected</p>
					<p className="mt-1 text-2xl font-bold text-muted-foreground">{stats.rejected}</p>
				</div>
			</div>

			{/* Filter bar */}
			<div className="mb-4 flex items-center gap-3">
				<select
					className="rounded-md border border-border px-3 py-1.5 text-sm"
					value={domain}
					onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
						setDomain(e.target.value);
						setOffset(0);
					}}
				>
					<option value="">All domains</option>
					{DOMAINS.map((d) => (
						<option key={d} value={d}>
							{d.replace(/_/g, ' ')}
						</option>
					))}
				</select>

				<button
					type="button"
					className="rounded-md bg-muted px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
					onClick={() => {
						setDomain('');
						setOffset(0);
					}}
				>
					Reset
				</button>
			</div>

			{/* Example cards */}
			<div className="space-y-4">
				{isPending && examples.length === 0 ? (
					<div className="rounded-lg border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
						Loading...
					</div>
				) : examples.length === 0 ? (
					<div className="rounded-lg border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
						No pending examples to review.
					</div>
				) : (
					examples.map((ex) => {
						return (
							<div key={ex.id} className="rounded-lg border border-border bg-card p-4">
								{/* Header */}
								<div className="mb-3 flex flex-wrap items-center gap-2">
									<span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
										{ex.feature_domain.replace(/_/g, ' ')}
									</span>
									{ex.source && (
										<span
											className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${sourceBadge[ex.source] ?? 'bg-muted text-foreground'}`}
										>
											{ex.source.replace(/_/g, ' ')}
										</span>
									)}
									{ex.difficulty && (
										<span
											className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${difficultyBadge[ex.difficulty] ?? 'bg-muted text-muted-foreground'}`}
										>
											{ex.difficulty.replace(/_/g, ' ')}
										</span>
									)}
									<span className="ml-auto text-xs text-muted-foreground">
										{formatTimestamp(ex.created_at)}
									</span>
								</div>

								{/* Model Predicted */}
								<div className="mb-3">
									<p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
										Model Predicted
									</p>
									<pre className="overflow-x-auto rounded bg-blue-50 p-3 font-mono text-xs text-blue-900">
										{formatJson(ex.model_prediction)}
									</pre>
								</div>

								{/* Corrected To */}
								<div className="mb-3">
									<p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
										Corrected To
									</p>
									<pre className="overflow-x-auto rounded bg-green-50 p-3 font-mono text-xs text-green-900">
										{formatJson(ex.corrected_output)}
									</pre>
								</div>

								{/* Reasoning (if present) */}
								{ex.correction_reasoning && (
									<div className="mb-3">
										<p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
											Reasoning
										</p>
										<p className="text-sm italic text-muted-foreground">
											{ex.correction_reasoning}
										</p>
									</div>
								)}

								{/* Actions */}
								<div className="flex items-center gap-2 border-t border-border pt-3">
									<button
										type="button"
										disabled={isPromoting}
										className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
										onClick={() => handlePromote(ex.id)}
									>
										Promote to Gold
									</button>
									<button
										type="button"
										disabled={isRejecting}
										className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
										onClick={() => handleReject(ex.id)}
									>
										Reject
									</button>
								</div>
							</div>
						);
					})
				)}
			</div>

			{/* Pagination */}
			<div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
				<p>Page {currentPage}</p>
				<div className="flex items-center gap-2">
					<button
						type="button"
						disabled={currentPage <= 1}
						className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
						onClick={() => setOffset((prev) => Math.max(0, prev - PAGE_SIZE))}
					>
						Previous
					</button>
					<button
						type="button"
						disabled={!hasMore}
						className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
						onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
					>
						Next
					</button>
				</div>
			</div>
		</div>
	);
}
