import {
	DEAL_SORT_LABELS,
	DEAL_STAGE_LABELS,
	type DealSortFilter,
	type DealStageFilter,
} from './filter-options';

interface DealsResultSummaryProps {
	displayedCount: number;
	totalMatchingCount: number;
	totalPipelineCount: number;
	stage: DealStageFilter;
	sort: DealSortFilter;
}

export function DealsResultSummary({
	displayedCount,
	totalMatchingCount,
	totalPipelineCount,
	stage,
	sort,
}: DealsResultSummaryProps) {
	const hasStageFilter = stage !== 'all';
	const stageLabel = hasStageFilter ? DEAL_STAGE_LABELS[stage].toLowerCase() : 'pipeline';
	const matchingLabel = hasStageFilter ? `${stageLabel} deal` : 'pipeline deal';

	return (
		<div
			data-testid="deals-result-summary"
			className="mb-3 flex flex-col gap-1 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between"
		>
			<span>
				Showing {displayedCount} of {totalMatchingCount} {matchingLabel}
				{totalMatchingCount !== 1 ? 's' : ''}
				{hasStageFilter ? (
					<>
						. Pipeline total: {totalPipelineCount} deal
						{totalPipelineCount !== 1 ? 's' : ''}
					</>
				) : null}
			</span>
			<span>Sorted by {DEAL_SORT_LABELS[sort].toLowerCase()}.</span>
		</div>
	);
}
