'use client';
// Needs client boundary for useRouter/useSearchParams URL state management

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
	GOAL_SORT_FILTERS,
	GOAL_SORT_LABELS,
	GOAL_STATUS_FILTERS,
	GOAL_STATUS_LABELS,
	GOAL_TYPE_FILTERS,
	GOAL_TYPE_LABELS,
	normalizeGoalSortFilter,
	normalizeGoalStatusFilter,
	normalizeGoalTypeFilter,
} from './filter-options';

export function GoalsFilter() {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const currentStatus = normalizeGoalStatusFilter(searchParams.get('status') ?? undefined);
	const currentType = normalizeGoalTypeFilter(searchParams.get('type') ?? undefined);
	const currentSort = normalizeGoalSortFilter(searchParams.get('sort') ?? undefined);

	function updateParams(key: string, value: string, defaultValue: string) {
		const params = new URLSearchParams(searchParams.toString());
		if (value === defaultValue) {
			params.delete(key);
		} else {
			params.set(key, value);
		}
		const qs = params.toString();
		router.push(qs ? `${pathname}?${qs}` : pathname);
	}

	return (
		<div className="mb-4 flex flex-wrap items-center gap-4">
			<div className="flex flex-wrap gap-1.5">
				{GOAL_STATUS_FILTERS.map((status) => (
					<button
						key={status}
						type="button"
						onClick={() => updateParams('status', status, 'active')}
						className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
							currentStatus === status
								? 'bg-foreground text-background'
								: 'bg-muted text-muted-foreground hover:bg-accent'
						}`}
					>
						{GOAL_STATUS_LABELS[status]}
					</button>
				))}
			</div>

			<select
				value={currentType}
				onChange={(e) => updateParams('type', e.target.value, 'all')}
				className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
			>
				{GOAL_TYPE_FILTERS.map((type) => (
					<option key={type} value={type}>
						{GOAL_TYPE_LABELS[type]}
					</option>
				))}
			</select>

			<select
				value={currentSort}
				onChange={(e) => updateParams('sort', e.target.value, 'newest')}
				className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
			>
				{GOAL_SORT_FILTERS.map((sort) => (
					<option key={sort} value={sort}>
						{GOAL_SORT_LABELS[sort]}
					</option>
				))}
			</select>
		</div>
	);
}
