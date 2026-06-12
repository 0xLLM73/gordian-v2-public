'use client';

import { useEffect, useState, useTransition } from 'react';
import { getSummaryAction } from '@/app/actions/summaries';

interface SummaryData {
	id: string;
	summary: string | null;
	status: string;
	generatedAt: string;
	styleVariant: string | null;
	messageCount: number;
}

export function ContactSummaryPanel({ contactId }: { contactId: string }) {
	const [summary, setSummary] = useState<SummaryData | null>(null);
	const [_isPending, startTransition] = useTransition();
	const [loaded, setLoaded] = useState(false);

	useEffect(() => {
		startTransition(async () => {
			const result = await getSummaryAction({ contactId });
			if (result?.data) {
				setSummary(result.data as unknown as SummaryData);
			}
			setLoaded(true);
		});
	}, [contactId]);

	if (!loaded) {
		return (
			<div className="rounded-lg border border-border bg-card p-6">
				<h2 className="mb-3 text-lg font-semibold text-foreground">AI Summary</h2>
				<div className="animate-pulse space-y-3">
					<div className="h-4 w-3/4 rounded bg-muted" />
					<div className="h-4 w-1/2 rounded bg-muted" />
					<div className="h-4 w-2/3 rounded bg-muted" />
				</div>
			</div>
		);
	}

	if (!summary) {
		return (
			<div className="rounded-lg border border-border bg-card p-6">
				<h2 className="mb-3 text-lg font-semibold text-foreground">AI Summary</h2>
				<p className="text-sm text-muted-foreground">
					No summary available yet. Summaries are generated automatically when messages are synced.
				</p>
			</div>
		);
	}

	return (
		<div className="rounded-lg border border-border bg-card p-6">
			<div className="mb-3 flex items-center justify-between">
				<h2 className="text-lg font-semibold text-foreground">AI Summary</h2>
				<div className="flex items-center gap-2">
					{summary.styleVariant ? (
						<span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-700">
							{summary.styleVariant.replace('summary_', '')}
						</span>
					) : null}
					<span className="text-xs text-muted-foreground">
						{new Date(summary.generatedAt).toLocaleDateString()} ({summary.messageCount} msgs)
					</span>
				</div>
			</div>
			<div className="prose prose-sm max-w-none text-foreground whitespace-pre-wrap">
				{summary.summary}
			</div>
		</div>
	);
}
