export const COMMITMENT_STATUS_FILTERS = [
	'all',
	'active',
	'draft',
	'snoozed',
	'completed',
	'dismissed',
] as const;

export type CommitmentStatusFilter = (typeof COMMITMENT_STATUS_FILTERS)[number];

export function normalizeCommitmentStatusFilter(value: string | undefined): CommitmentStatusFilter {
	if (!value) return 'all';
	return COMMITMENT_STATUS_FILTERS.includes(value as CommitmentStatusFilter)
		? (value as CommitmentStatusFilter)
		: 'all';
}
