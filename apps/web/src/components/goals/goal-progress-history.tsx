'use client';

// Client boundary: fetches progress events on demand, manages collapse state

import { useCallback, useState, useTransition } from 'react';
import { listGoalProgressAction } from '@/app/actions/goals';
import { GOAL_PROGRESS_SOURCE_COLORS } from '@/lib/colors';

interface ProgressEvent {
	id: string;
	goalId: string;
	delta: number;
	source: string;
	createdAt: Date | string;
}

function formatRelative(date: Date | string): string {
	const now = Date.now();
	const then = new Date(date).getTime();
	const diffMs = now - then;
	const diffMin = Math.floor(diffMs / 60000);
	if (diffMin < 1) return 'just now';
	if (diffMin < 60) return `${diffMin}m ago`;
	const diffH = Math.floor(diffMin / 60);
	if (diffH < 24) return `${diffH}h ago`;
	const diffD = Math.floor(diffH / 24);
	if (diffD === 1) return 'yesterday';
	if (diffD < 7) return `${diffD}d ago`;
	return new Date(date).toLocaleDateString();
}

function PaceChart({ events }: { events: ProgressEvent[] }) {
	const now = new Date();
	const days: number[] = Array.from({ length: 14 }, () => 0);

	for (const ev of events) {
		const diffDays = Math.floor((now.getTime() - new Date(ev.createdAt).getTime()) / 86400000);
		if (diffDays >= 0 && diffDays < 14) {
			days[13 - diffDays] += ev.delta;
		}
	}

	const maxDelta = Math.max(...days, 1);

	return (
		<div className="mt-2">
			<p className="mb-1 text-[10px] text-muted-foreground">Last 14 days</p>
			<div className="flex items-end gap-0.5" style={{ height: 32 }}>
				{days.map((d, i) => (
					<div
						key={`day-${14 - i}`}
						className={`flex-1 rounded-sm transition-all ${d > 0 ? 'bg-primary' : 'bg-primary/20'}`}
						style={{
							height: d > 0 ? `${Math.max((d / maxDelta) * 100, 12)}%` : '4px',
						}}
					/>
				))}
			</div>
		</div>
	);
}

export function GoalProgressHistory({ goalId }: { goalId: string }) {
	const [open, setOpen] = useState(false);
	const [events, setEvents] = useState<ProgressEvent[] | null>(null);
	const [isPending, startTransition] = useTransition();

	const load = useCallback(() => {
		setOpen(true);
		if (events) return;
		startTransition(async () => {
			const result = await listGoalProgressAction({ goalId, limit: 50 });
			if (result?.data) {
				setEvents(result.data as ProgressEvent[]);
			}
		});
	}, [goalId, events]);

	return (
		<div className="mt-2">
			<button
				type="button"
				onClick={() => (open ? setOpen(false) : load())}
				className="text-xs text-muted-foreground hover:text-foreground"
			>
				{open ? 'Hide history' : 'Show history'}
			</button>

			{open ? (
				<div className="mt-2">
					{isPending ? (
						<div className="space-y-1.5">
							{[1, 2, 3].map((i) => (
								<div key={i} className="h-5 w-full animate-pulse rounded bg-muted" />
							))}
						</div>
					) : events && events.length > 0 ? (
						<>
							<div className="max-h-48 space-y-1 overflow-y-auto">
								{events.map((ev) => (
									<div
										key={ev.id}
										className="flex items-center justify-between rounded px-2 py-1 text-xs"
									>
										<div className="flex items-center gap-2">
											<span className="font-medium text-foreground">+{ev.delta}</span>
											<span
												className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${GOAL_PROGRESS_SOURCE_COLORS[ev.source] || 'bg-muted text-muted-foreground'}`}
											>
												{ev.source}
											</span>
										</div>
										<span className="text-muted-foreground">{formatRelative(ev.createdAt)}</span>
									</div>
								))}
							</div>
							<PaceChart events={events} />
						</>
					) : (
						<p className="text-xs text-muted-foreground">No progress events recorded yet.</p>
					)}
				</div>
			) : null}
		</div>
	);
}
