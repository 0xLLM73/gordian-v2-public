// 'use client' — needs event handlers for 👍/👎 feedback buttons and submitted state
'use client';

import { submitBriefFeedbackAction } from '@/app/actions/brief';
import type { LatestBrief } from '@repo/db';
import { useState, useTransition } from 'react';
import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';

interface MorningBriefCardProps {
	brief: LatestBrief | null;
}

export function MorningBriefCard({ brief }: MorningBriefCardProps) {
	const [submitted, setSubmitted] = useState<boolean | null>(brief?.feedback ?? null);
	const [isPending, startTransition] = useTransition();

	if (!brief) {
		return (
			<div className="mb-6 rounded-lg border border-border bg-card p-6">
				<div className="flex items-center justify-between">
					<h2 className="font-semibold text-foreground">Morning Brief</h2>
				</div>
				<div className="mt-4 rounded-md border border-border bg-muted/40 px-3 py-3">
					<p className="text-sm font-medium text-foreground">No morning brief generated yet.</p>
					<ul className="mt-2 space-y-1 text-sm text-muted-foreground">
						<li>Enable the brief schedule in Settings.</li>
						<li>Sync or import enough conversation data for a useful summary.</li>
						<li>Keep the local worker running at the scheduled brief time.</li>
					</ul>
				</div>
			</div>
		);
	}

	const formattedTime = brief.generatedAt.toLocaleTimeString([], {
		hour: 'numeric',
		minute: '2-digit',
	});
	const formattedDate = brief.generatedAt.toLocaleDateString([], {
		weekday: 'long',
		month: 'short',
		day: 'numeric',
	});

	function handleFeedback(reaction: 'helpful' | 'not_helpful') {
		if (submitted !== null || !brief?.toneTraceId || !brief?.detailTraceId) return;

		startTransition(async () => {
			try {
				await submitBriefFeedbackAction({
					briefId: brief.id,
					reaction,
					toneTraceId: brief.toneTraceId as string,
					detailTraceId: brief.detailTraceId as string,
				});
				setSubmitted(reaction === 'helpful');
				toast.success('Thanks for the feedback');
			} catch {
				toast.error('Failed to submit feedback');
			}
		});
	}

	return (
		<div className="mb-6 rounded-lg border border-border bg-card p-6">
			<div className="flex items-center justify-between">
				<h2 className="font-semibold text-foreground">Morning Brief</h2>
				<span className="text-sm text-muted-foreground">
					{formattedDate}, {formattedTime}
				</span>
			</div>

			<div className="prose prose-sm mt-4 max-h-64 max-w-none overflow-y-auto text-gray-800">
				<ReactMarkdown>{brief.content ?? 'Brief content unavailable.'}</ReactMarkdown>
			</div>

			<div className="mt-4 flex items-center gap-2 border-t pt-4 text-sm text-muted-foreground">
				{submitted !== null ? (
					<span>Thanks for the feedback</span>
				) : (
					<>
						<span>Was this helpful?</span>
						<button
							type="button"
							onClick={() => handleFeedback('helpful')}
							disabled={isPending}
							className="rounded px-2 py-1 text-base hover:bg-accent disabled:opacity-50"
							aria-label="Helpful"
						>
							👍
						</button>
						<button
							type="button"
							onClick={() => handleFeedback('not_helpful')}
							disabled={isPending}
							className="rounded px-2 py-1 text-base hover:bg-accent disabled:opacity-50"
							aria-label="Not helpful"
						>
							👎
						</button>
					</>
				)}
			</div>
		</div>
	);
}

export function MorningBriefSkeleton() {
	return (
		<div className="mb-6 animate-pulse rounded-lg border border-border bg-card p-6">
			<div className="flex items-center justify-between">
				<div className="h-5 w-32 rounded bg-muted" />
				<div className="h-4 w-24 rounded bg-muted" />
			</div>
			<div className="mt-4 space-y-2">
				<div className="h-4 w-full rounded bg-muted" />
				<div className="h-4 w-5/6 rounded bg-muted" />
				<div className="h-4 w-4/6 rounded bg-muted" />
			</div>
			<div className="mt-4 flex gap-2 border-t pt-4">
				<div className="h-4 w-28 rounded bg-muted" />
			</div>
		</div>
	);
}
