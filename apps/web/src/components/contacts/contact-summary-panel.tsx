'use client';

import { getSummaryAction } from '@/app/actions/summaries';
import { useState, useTransition } from 'react';

interface SummaryData {
	summary: string | null;
	generatedAt: string;
	messageCount: number;
	styleVariant: string | null;
}

interface Props {
	contactId: string;
	initialSummary: SummaryData | null;
}

export function ContactSummaryPanel({ contactId, initialSummary }: Props) {
	const [summary, setSummary] = useState(initialSummary);
	const [isPending, startTransition] = useTransition();

	function handleRefresh() {
		startTransition(async () => {
			const result = await getSummaryAction({ contactId });
			if (result?.data) setSummary(result.data as unknown as SummaryData);
		});
	}

	if (!summary) {
		return (
			<div className="rounded-lg border border-dashed border-border bg-muted p-6 text-center">
				<p className="text-sm text-muted-foreground">No AI summary available.</p>
				<p className="mt-1 text-xs text-muted-foreground">
					Summaries are generated automatically after message sync.
				</p>
			</div>
		);
	}

	const isStale = Date.now() - new Date(summary.generatedAt).getTime() > 24 * 60 * 60 * 1000;

	return (
		<div className="rounded-lg border border-border bg-card p-4">
			<div className="mb-3 flex items-center justify-between">
				<h3 className="text-sm font-semibold text-foreground">AI Summary</h3>
				<div className="flex items-center gap-2">
					{isStale ? (
						<span className="rounded bg-yellow-100 px-1.5 py-0.5 text-xs font-medium text-yellow-700">
							Stale
						</span>
					) : null}
					{summary.styleVariant ? (
						<span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-700">
							{summary.styleVariant.replace('summary_', '')}
						</span>
					) : null}
					<span className="text-xs text-muted-foreground">
						{new Date(summary.generatedAt).toLocaleDateString()} ({summary.messageCount} messages)
					</span>
					<button
						type="button"
						onClick={handleRefresh}
						disabled={isPending}
						className="text-xs text-primary hover:text-blue-800 disabled:opacity-50"
					>
						{isPending ? 'Refreshing...' : 'Refresh'}
					</button>
				</div>
			</div>
			<div className="prose prose-sm max-w-none whitespace-pre-wrap text-foreground">
				{summary.summary}
			</div>
		</div>
	);
}
