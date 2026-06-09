export const COMMITMENT_STATUS_FILTERS = [
	'active',
	'draft',
	'snoozed',
	'completed',
	'dismissed',
	'all',
] as const;

export type CommitmentStatusFilter = (typeof COMMITMENT_STATUS_FILTERS)[number];

export const COMMITMENT_STATUS_LABELS: Record<CommitmentStatusFilter, string> = {
	active: 'Commitments',
	draft: 'Review',
	snoozed: 'Snoozed',
	completed: 'Completed',
	dismissed: 'Dismissed',
	all: 'All',
};

export function normalizeCommitmentStatusFilter(value: string | undefined): CommitmentStatusFilter {
	if (!value) return 'active';
	return COMMITMENT_STATUS_FILTERS.includes(value as CommitmentStatusFilter)
		? (value as CommitmentStatusFilter)
		: 'active';
}
