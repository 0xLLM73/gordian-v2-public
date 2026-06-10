'use client';
// Client boundary: fetches outreach suggestions on demand, manages expand/collapse

import { getOutreachSuggestionsAction } from '@/app/actions/goal-outreach';
import { HEALTH_BADGE_COLORS } from '@/lib/colors';
import Link from 'next/link';
import { useCallback, useState, useTransition } from 'react';

interface OutreachSuggestion {
	actionId: string;
	contactId: string;
	contactName: string;
	matchReason: string;
	healthLabel: string;
	healthComposite: number | null;
	healthTrend: string | null;
	lastInteraction: string | null;
	effort: string;
	status: string;
}

function formatRelativeDate(iso: string): string {
	const diffMs = Date.now() - new Date(iso).getTime();
	const days = Math.floor(diffMs / 86400000);
	if (days === 0) return 'today';
	if (days === 1) return 'yesterday';
	if (days < 7) return `${days}d ago`;
	if (days < 30) return `${Math.floor(days / 7)}w ago`;
	return `${Math.floor(days / 30)}mo ago`;
}

export function GoalOutreachPanel({ goalId }: { goalId: string }) {
	const [open, setOpen] = useState(false);
	const [suggestions, setSuggestions] = useState<OutreachSuggestion[] | null>(null);
	const [isPending, startTransition] = useTransition();

	const load = useCallback(() => {
		setOpen(true);
		if (suggestions) return;
		startTransition(async () => {
			const res = await getOutreachSuggestionsAction({ goalId });
			if (res?.data) {
				setSuggestions(res.data as OutreachSuggestion[]);
			}
		});
	}, [goalId, suggestions]);

	return (
		<div className="mt-2">
			<button
				type="button"
				onClick={() => (open ? setOpen(false) : load())}
				className="text-xs text-muted-foreground hover:text-foreground"
			>
				{open ? 'Hide outreach' : 'Outreach suggestions'}
			</button>

			{open ? (
				<div className="mt-2">
					{isPending && !suggestions ? (
						<div className="space-y-2">
							{[1, 2, 3].map((i) => (
								<div key={i} className="h-14 w-full animate-pulse rounded-md bg-muted" />
							))}
						</div>
					) : suggestions && suggestions.length > 0 ? (
						<div className="space-y-2">
							{suggestions.map((s) => (
								<SuggestionCard key={s.actionId} suggestion={s} goalId={goalId} />
							))}
						</div>
					) : (
						<div className="rounded-md border border-dashed border-border bg-muted/50 p-3 text-center">
							<p className="text-xs text-muted-foreground">
								No outreach suggestions yet. Gordian will suggest contacts as it learns about your
								goals.
							</p>
						</div>
					)}
				</div>
			) : null}
		</div>
	);
}

function SuggestionCard({
	suggestion,
	goalId,
}: {
	suggestion: OutreachSuggestion;
	goalId: string;
}) {
	return (
		<div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2">
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<Link
						href={`/contacts/${suggestion.contactId}`}
						className="text-sm font-medium text-foreground hover:underline"
					>
						{suggestion.contactName}
					</Link>
					<span
						className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${HEALTH_BADGE_COLORS[suggestion.healthLabel] || 'bg-muted text-muted-foreground'}`}
					>
						{suggestion.healthLabel}
					</span>
				</div>
				<p className="mt-0.5 text-xs text-muted-foreground">{suggestion.matchReason}</p>
			</div>
			<div className="ml-3 flex shrink-0 items-center gap-2">
				{suggestion.lastInteraction ? (
					<span className="text-[10px] text-muted-foreground">
						{formatRelativeDate(suggestion.lastInteraction)}
					</span>
				) : (
					<span className="text-[10px] text-muted-foreground">no history</span>
				)}
				<Link
					href={`/follow-up-plans?new=1&contactId=${suggestion.contactId}`}
					className="rounded px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
				>
					Draft
				</Link>
				<Link
					href={`/follow-up-plans?new=1&contactId=${suggestion.contactId}&goalId=${goalId}`}
					className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
				>
					Enroll
				</Link>
			</div>
		</div>
	);
}
