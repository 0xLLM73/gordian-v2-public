export const GOAL_STATUS_FILTERS = ['active', 'paused', 'completed', 'abandoned', 'all'] as const;
export const GOAL_TYPE_FILTERS = [
	'all',
	'relationship',
	'business',
	'habit',
	'network',
	'strategic',
] as const;
export const GOAL_SORT_FILTERS = ['newest', 'deadline', 'progress'] as const;

export type GoalStatusFilter = (typeof GOAL_STATUS_FILTERS)[number];
export type GoalTypeFilter = (typeof GOAL_TYPE_FILTERS)[number];
export type GoalSortFilter = (typeof GOAL_SORT_FILTERS)[number];

export const GOAL_STATUS_LABELS: Record<GoalStatusFilter, string> = {
	active: 'Active',
	paused: 'Paused',
	completed: 'Completed',
	abandoned: 'Abandoned',
	all: 'All',
};

export const GOAL_TYPE_LABELS: Record<GoalTypeFilter, string> = {
	all: 'All Types',
	relationship: 'Relationship',
	business: 'Business',
	habit: 'Habit',
	network: 'Network',
	strategic: 'Strategic',
};

export const GOAL_SORT_LABELS: Record<GoalSortFilter, string> = {
	newest: 'Newest',
	deadline: 'Deadline',
	progress: 'Progress %',
};

export function normalizeGoalStatusFilter(value: string | undefined): GoalStatusFilter {
	if (!value) return 'active';
	return GOAL_STATUS_FILTERS.includes(value as GoalStatusFilter)
		? (value as GoalStatusFilter)
		: 'active';
}

export function normalizeGoalTypeFilter(value: string | undefined): GoalTypeFilter {
	if (!value) return 'all';
	return GOAL_TYPE_FILTERS.includes(value as GoalTypeFilter) ? (value as GoalTypeFilter) : 'all';
}

export function normalizeGoalSortFilter(value: string | undefined): GoalSortFilter {
	if (!value) return 'newest';
	return GOAL_SORT_FILTERS.includes(value as GoalSortFilter) ? (value as GoalSortFilter) : 'newest';
}
