export const DEAL_STAGE_FILTERS = [
	'all',
	'discovery',
	'diligence',
	'negotiation',
	'committed',
	'won',
	'lost',
] as const;

export const DEAL_STAGE_LABELS: Record<DealStageFilter, string> = {
	all: 'All',
	discovery: 'Discovery',
	diligence: 'Diligence',
	negotiation: 'Negotiation',
	committed: 'Committed',
	won: 'Won',
	lost: 'Lost',
};

export const DEAL_SORT_FILTERS = [
	'last_activity',
	'highest_value',
	'newest',
	'oldest',
	'most_stalled',
] as const;

export const DEAL_SORT_LABELS: Record<DealSortFilter, string> = {
	last_activity: 'Last activity',
	highest_value: 'Highest value',
	newest: 'Newest',
	oldest: 'Oldest',
	most_stalled: 'Most stalled',
};

export type DealStageFilter = (typeof DEAL_STAGE_FILTERS)[number];
export type DealSortFilter = (typeof DEAL_SORT_FILTERS)[number];

export function normalizeDealStageFilter(value: string | undefined): DealStageFilter {
	if (!value) return 'all';
	return DEAL_STAGE_FILTERS.includes(value as DealStageFilter) ? (value as DealStageFilter) : 'all';
}

export function normalizeDealSortFilter(value: string | undefined): DealSortFilter {
	if (!value) return 'last_activity';
	return DEAL_SORT_FILTERS.includes(value as DealSortFilter)
		? (value as DealSortFilter)
		: 'last_activity';
}
