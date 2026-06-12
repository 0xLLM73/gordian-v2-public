'use client';

// Needs 'use client': event handlers for Act/Dismiss buttons, useTransition for loading state.

import type { Recommendation, RecommendationType } from '@repo/db';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import {
	actOnRecommendationAction,
	dismissRecommendationAction,
} from '@/app/actions/recommendations';
import { RECOMMENDATION_TYPE_COLORS } from '@/lib/colors';

const TYPE_LABELS: Record<RecommendationType, string> = {
	re_engage: 'Re-engage',
	follow_up: 'Follow Up',
	advance_deal: 'Advance Deal',
	make_intro: 'Make Intro',
	achieve_goal: 'Achieve Goal',
};

function priorityLabel(score: number): { label: string; color: string } {
	if (score >= 0.7) return { label: 'High', color: 'text-red-600' };
	if (score >= 0.4) return { label: 'Medium', color: 'text-amber-600' };
	return { label: 'Low', color: 'text-muted-foreground' };
}

function RecommendationCard({ rec }: { rec: Recommendation }) {
	const router = useRouter();
	const [isPending, startTransition] = useTransition();
	const priority = priorityLabel(rec.priorityScore ?? 0);

	function handleAct() {
		startTransition(async () => {
			await actOnRecommendationAction({ id: rec.id });
			router.refresh();
		});
	}

	function handleDismiss() {
		startTransition(async () => {
			await dismissRecommendationAction({ id: rec.id });
			router.refresh();
		});
	}

	const typeColor =
		RECOMMENDATION_TYPE_COLORS[rec.type as RecommendationType] ?? 'bg-gray-100 text-gray-600';
	const typeLabel = TYPE_LABELS[rec.type as RecommendationType] ?? rec.type;

	return (
		<div className="rounded-lg border border-border bg-card p-4">
			<div className="mb-2 flex items-center gap-2">
				<span className={`rounded px-2 py-0.5 text-xs font-medium ${typeColor}`}>{typeLabel}</span>
				<span className={`text-xs font-medium ${priority.color}`}>{priority.label} priority</span>
				{rec.contactId ? (
					<Link
						href={`/contacts/${rec.contactId}`}
						className="ml-auto text-xs text-indigo-600 hover:underline"
					>
						View contact &rarr;
					</Link>
				) : null}
			</div>
			<p className="mb-3 text-sm text-foreground">{rec.reasoning}</p>
			<div className="flex gap-2">
				<button
					type="button"
					onClick={handleAct}
					disabled={isPending}
					className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
				>
					Act
				</button>
				<button
					type="button"
					onClick={handleDismiss}
					disabled={isPending}
					className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
				>
					Dismiss
				</button>
			</div>
		</div>
	);
}

export function RecommendationCardList({ recommendations }: { recommendations: Recommendation[] }) {
	if (recommendations.length === 0) {
		return (
			<div className="mt-6 rounded-lg border border-border bg-card p-6">
				<h2 className="mb-2 text-lg font-semibold text-foreground">AI Recommendations</h2>
				<p className="text-sm text-muted-foreground">
					No pending recommendations. You're all caught up — Gordian will surface new actions as it
					finds them.
				</p>
			</div>
		);
	}

	return (
		<div className="mt-6">
			<h2 className="mb-3 text-lg font-semibold text-foreground">AI Recommendations</h2>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{recommendations.map((rec) => (
					<RecommendationCard key={rec.id} rec={rec} />
				))}
			</div>
		</div>
	);
}
