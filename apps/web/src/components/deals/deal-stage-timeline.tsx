import { DEAL_STAGE_BG_COLORS } from '@/lib/colors';

const stageLabels: Record<string, string> = {
	discovery: 'Discovery',
	diligence: 'Diligence',
	negotiation: 'Negotiation',
	committed: 'Committed',
	won: 'Won',
	lost: 'Lost',
};

export interface DealStageTimelineEntry {
	id?: string;
	previousStage?: string | null;
	nextStage?: string;
	stage?: string;
	note?: string | null;
	source?: string | null;
	occurredAt?: Date | string;
	timestamp?: string;
}

export function DealStageTimeline({
	events,
	stageHistory,
}: {
	events: DealStageTimelineEntry[];
	stageHistory: DealStageTimelineEntry[] | null;
}) {
	const entries =
		events.length > 0
			? events.map((event) => ({
					id: event.id,
					stage: event.nextStage ?? event.stage ?? 'discovery',
					previousStage: event.previousStage,
					note: event.note,
					source: event.source ?? 'manual',
					occurredAt: event.occurredAt ?? event.timestamp ?? new Date().toISOString(),
				}))
			: (stageHistory ?? []).map((event, index) => ({
					id: `history-${index}`,
					stage: event.stage ?? event.nextStage ?? 'discovery',
					previousStage: event.previousStage,
					note: event.note,
					source: 'legacy_history',
					occurredAt: event.timestamp ?? event.occurredAt ?? new Date().toISOString(),
				}));

	if (entries.length === 0) return null;

	return (
		<section
			data-testid="deal-stage-timeline"
			className="mt-6 rounded-lg border border-border bg-card p-4"
		>
			<div className="mb-4 flex items-center justify-between">
				<h2 className="text-sm font-semibold text-foreground">Stage Timeline</h2>
				<span className="text-xs text-muted-foreground">
					{events.length > 0 ? 'Durable events' : 'Legacy history'}
				</span>
			</div>
			<div className="relative ml-3 border-l-2 border-border pl-6">
				{entries.map((entry, index) => {
					const isLast = index === entries.length - 1;
					const date = new Date(entry.occurredAt);
					const label = stageLabels[entry.stage] || entry.stage;
					return (
						<div key={entry.id ?? `${entry.stage}-${index}`} className={isLast ? '' : 'pb-5'}>
							<div
								className={`absolute -left-[7px] mt-1 h-3 w-3 rounded-full border-2 border-background ${DEAL_STAGE_BG_COLORS[entry.stage] || 'bg-primary'}`}
							/>
							<div className="min-w-0">
								<div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
									<div className="min-w-0">
										<p className="text-sm font-medium text-foreground">
											{entry.previousStage
												? `${stageLabels[entry.previousStage] || entry.previousStage} -> ${label}`
												: label}
										</p>
										<p className="text-xs text-muted-foreground">
											Source: {entry.source?.replace(/_/g, ' ') || 'manual'}
										</p>
									</div>
									<time className="shrink-0 text-xs text-muted-foreground">
										{date.toLocaleDateString('en-US', {
											month: 'short',
											day: 'numeric',
											year: 'numeric',
										})}
									</time>
								</div>
								{entry.note ? (
									<p className="mt-1 rounded bg-muted px-2 py-1 text-sm text-foreground">
										{entry.note}
									</p>
								) : null}
							</div>
						</div>
					);
				})}
			</div>
		</section>
	);
}
