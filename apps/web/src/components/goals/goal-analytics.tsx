'use client';

// Client boundary: fetches analytics on demand, manages collapse state + renders charts

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useCallback, useState, useTransition } from 'react';
import { getGoalAnalyticsAction } from '@/app/actions/goals';
import { GOAL_TYPE_COLORS } from '@/lib/colors';

interface GoalTypeStats {
	type: string;
	total: number;
	completed: number;
	completionRate: number;
	avgDaysToComplete: number | null;
}

interface PaceDistribution {
	onTrack: number;
	slightlyBehind: number;
	atRisk: number;
}

interface GoalAnalyticsData {
	byType: GoalTypeStats[];
	velocityTrend: number[];
	paceDistribution: PaceDistribution;
}

function VelocityChart({ data }: { data: number[] }) {
	const max = Math.max(...data, 1);
	return (
		<div>
			<p className="mb-1 text-xs font-medium text-foreground">Velocity — Last 14 days</p>
			<div className="flex items-end gap-0.5" style={{ height: 48 }}>
				{data.map((d, i) => (
					<div
						key={`vel-${14 - i}`}
						className={`flex-1 rounded-sm transition-all ${d > 0 ? 'bg-primary' : 'bg-primary/20'}`}
						style={{
							height: d > 0 ? `${Math.max((d / max) * 100, 8)}%` : '4px',
						}}
					/>
				))}
			</div>
			<div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground">
				<span>14d ago</span>
				<span>Today</span>
			</div>
		</div>
	);
}

function CompletionByType({ stats }: { stats: GoalTypeStats[] }) {
	if (stats.length === 0) return null;
	const maxTotal = Math.max(...stats.map((s) => s.total), 1);

	return (
		<div>
			<p className="mb-2 text-xs font-medium text-foreground">Completion by Type</p>
			<div className="space-y-2">
				{stats.map((s) => {
					const pct = Math.round(s.completionRate * 100);
					const badgeClass = GOAL_TYPE_COLORS[s.type] || 'bg-muted text-muted-foreground';
					return (
						<div key={s.type}>
							<div className="mb-0.5 flex items-center justify-between text-xs">
								<span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badgeClass}`}>
									{s.type}
								</span>
								<span className="text-muted-foreground">
									{s.completed}/{s.total} ({pct}%)
									{s.avgDaysToComplete != null ? ` · avg ${s.avgDaysToComplete}d` : ''}
								</span>
							</div>
							<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
								<div
									className="h-full rounded-full bg-primary transition-all"
									style={{ width: `${(s.total / maxTotal) * 100}%` }}
								>
									<div className="h-full rounded-full bg-green-500" style={{ width: `${pct}%` }} />
								</div>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

function PaceScoreDistribution({ pace }: { pace: PaceDistribution }) {
	const total = pace.onTrack + pace.slightlyBehind + pace.atRisk;
	if (total === 0) {
		return (
			<div>
				<p className="mb-1 text-xs font-medium text-foreground">Pace Score</p>
				<p className="text-xs text-muted-foreground">No active goals with deadlines.</p>
			</div>
		);
	}

	const segments = [
		{ label: 'On track', count: pace.onTrack, color: 'bg-green-500', textColor: 'text-green-700' },
		{
			label: 'Slightly behind',
			count: pace.slightlyBehind,
			color: 'bg-yellow-500',
			textColor: 'text-yellow-700',
		},
		{ label: 'At risk', count: pace.atRisk, color: 'bg-red-500', textColor: 'text-red-700' },
	];

	return (
		<div>
			<p className="mb-2 text-xs font-medium text-foreground">Pace Score Distribution</p>
			<div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
				{segments.map((seg) =>
					seg.count > 0 ? (
						<div
							key={seg.label}
							className={`h-full ${seg.color} transition-all`}
							style={{ width: `${(seg.count / total) * 100}%` }}
						/>
					) : null,
				)}
			</div>
			<div className="mt-1.5 flex gap-3">
				{segments.map((seg) => (
					<span key={seg.label} className="text-[10px] text-muted-foreground">
						<span className={`font-medium ${seg.textColor}`}>{seg.count}</span> {seg.label}
					</span>
				))}
			</div>
		</div>
	);
}

function generateInsights(data: GoalAnalyticsData): string[] {
	const insights: string[] = [];
	const { byType, paceDistribution } = data;

	// Compare completion rates across types
	const completed = byType.filter((s) => s.completed > 0);
	if (completed.length >= 2) {
		const sorted = [...completed].sort((a, b) => b.completionRate - a.completionRate);
		const best = sorted[0];
		const worst = sorted[sorted.length - 1];
		if (best.completionRate - worst.completionRate > 0.15) {
			insights.push(
				`You complete ${best.type} goals ${Math.round((best.completionRate - worst.completionRate) * 100)}% more often than ${worst.type} goals.`,
			);
		}
	}

	// Check if goals with deadlines complete faster
	const withAvg = byType.filter((s) => s.avgDaysToComplete != null);
	if (withAvg.length >= 2) {
		const fastest = withAvg.reduce((a, b) =>
			(a.avgDaysToComplete ?? Number.POSITIVE_INFINITY) <
			(b.avgDaysToComplete ?? Number.POSITIVE_INFINITY)
				? a
				: b,
		);
		if (fastest.avgDaysToComplete != null) {
			insights.push(
				`Your ${fastest.type} goals complete fastest — averaging ${fastest.avgDaysToComplete} days.`,
			);
		}
	}

	// Pace distribution insight
	const total =
		paceDistribution.onTrack + paceDistribution.slightlyBehind + paceDistribution.atRisk;
	if (total > 0 && paceDistribution.atRisk > 0) {
		insights.push(
			`${paceDistribution.atRisk} of ${total} goal${total > 1 ? 's' : ''} with deadlines ${paceDistribution.atRisk > 1 ? 'are' : 'is'} at risk — consider adjusting targets or timelines.`,
		);
	}

	return insights.slice(0, 2);
}

export function GoalAnalytics() {
	const [open, setOpen] = useState(false);
	const [data, setData] = useState<GoalAnalyticsData | null>(null);
	const [isPending, startTransition] = useTransition();

	const load = useCallback(() => {
		setOpen(true);
		if (data) return;
		startTransition(async () => {
			const result = await getGoalAnalyticsAction({});
			if (result?.data) {
				setData(result.data as GoalAnalyticsData);
			}
		});
	}, [data]);

	const insights = data ? generateInsights(data) : [];

	return (
		<div className="mt-4 rounded-lg border border-border">
			<button
				type="button"
				onClick={() => (open ? setOpen(false) : load())}
				className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/50"
			>
				{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
				Analytics
			</button>

			{open ? (
				<div className="border-t border-border px-4 pb-4 pt-3">
					{isPending ? (
						<div className="space-y-3">
							{[1, 2, 3].map((i) => (
								<div key={i} className="h-12 w-full animate-pulse rounded bg-muted" />
							))}
						</div>
					) : data ? (
						<div className="space-y-5">
							<CompletionByType stats={data.byType} />
							<VelocityChart data={data.velocityTrend} />
							<PaceScoreDistribution pace={data.paceDistribution} />

							{insights.length > 0 ? (
								<div className="space-y-2">
									{insights.map((insight) => (
										<div
											key={insight}
											className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-foreground"
										>
											{insight}
										</div>
									))}
								</div>
							) : null}
						</div>
					) : (
						<p className="text-xs text-muted-foreground">No analytics data available.</p>
					)}
				</div>
			) : null}
		</div>
	);
}
