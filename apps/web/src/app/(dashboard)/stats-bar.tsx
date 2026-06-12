// 'use client' — needs useState for collapsible toggle interaction
'use client';

import type { DashboardStats } from '@repo/db';
import { useState } from 'react';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';

export function StatsBar({ stats }: { stats: DashboardStats }) {
	const [expanded, setExpanded] = useState(false);

	const items = [
		{ label: 'Contacts', value: stats.contactCount.toString() },
		{ label: 'Commitments', value: stats.activeCommitmentCount.toString() },
		{ label: 'Deals', value: stats.openDealCount.toString() },
		{ label: 'Goals', value: stats.activeGoalCount.toString() },
		{ label: 'Pipeline', value: formatCurrency(stats.totalDealValue) },
	];

	return (
		<div className="rounded-lg border border-border bg-card shadow-stripe-sm">
			<button
				type="button"
				onClick={() => setExpanded((prev) => !prev)}
				className="flex w-full items-center justify-between px-4 py-3 text-left"
				aria-expanded={expanded}
			>
				<div className="flex items-center gap-6">
					{items.map((item) => (
						<div key={item.label} className="flex items-center gap-1.5">
							<span className="text-xs text-muted-foreground">{item.label}</span>
							<span className="text-sm font-semibold text-foreground">{item.value}</span>
						</div>
					))}
				</div>
				<svg
					className={cn(
						'h-4 w-4 text-muted-foreground transition-transform',
						expanded && 'rotate-180',
					)}
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					strokeWidth={2}
					aria-hidden="true"
				>
					<path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
				</svg>
			</button>
			{expanded ? (
				<div className="grid grid-cols-2 gap-4 border-t border-border px-4 py-4 sm:grid-cols-3 lg:grid-cols-5">
					{items.map((item) => (
						<div key={item.label}>
							<p className="text-xs font-medium text-muted-foreground">{item.label}</p>
							<p className="mt-1 text-2xl font-bold text-foreground">{item.value}</p>
						</div>
					))}
				</div>
			) : null}
		</div>
	);
}
