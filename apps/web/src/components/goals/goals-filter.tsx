'use client';
// Needs client boundary for useRouter/useSearchParams URL state management

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

const statuses = ['active', 'paused', 'completed', 'abandoned', 'all'] as const;

const statusLabels: Record<string, string> = {
	active: 'Active',
	paused: 'Paused',
	completed: 'Completed',
	abandoned: 'Abandoned',
	all: 'All',
};

const types = ['all', 'relationship', 'business', 'habit', 'network', 'strategic'] as const;

const typeLabels: Record<string, string> = {
	all: 'All Types',
	relationship: 'Relationship',
	business: 'Business',
	habit: 'Habit',
	network: 'Network',
	strategic: 'Strategic',
};

const sorts = ['newest', 'deadline', 'progress'] as const;

const sortLabels: Record<string, string> = {
	newest: 'Newest',
	deadline: 'Deadline',
	progress: 'Progress %',
};

export function GoalsFilter() {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const currentStatus = searchParams.get('status') || 'active';
	const currentType = searchParams.get('type') || 'all';
	const currentSort = searchParams.get('sort') || 'newest';

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
				{statuses.map((status) => (
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
						{statusLabels[status]}
					</button>
				))}
			</div>

			<select
				value={currentType}
				onChange={(e) => updateParams('type', e.target.value, 'all')}
				className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
			>
				{types.map((type) => (
					<option key={type} value={type}>
						{typeLabels[type]}
					</option>
				))}
			</select>

			<select
				value={currentSort}
				onChange={(e) => updateParams('sort', e.target.value, 'newest')}
				className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
			>
				{sorts.map((sort) => (
					<option key={sort} value={sort}>
						{sortLabels[sort]}
					</option>
				))}
			</select>
		</div>
	);
}
