'use client';
// Needs interactivity: URL navigation on sort change

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { DEAL_SORT_FILTERS, DEAL_SORT_LABELS, normalizeDealSortFilter } from './filter-options';

export function DealsSort() {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const currentSort = normalizeDealSortFilter(searchParams.get('sort') ?? undefined);

	function handleSort(sort: string) {
		const params = new URLSearchParams(searchParams.toString());
		if (sort === 'last_activity') {
			params.delete('sort');
		} else {
			params.set('sort', sort);
		}
		router.push(`${pathname}?${params.toString()}`);
	}

	return (
		<select
			value={currentSort}
			onChange={(e) => handleSort(e.target.value)}
			className="rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
		>
			{DEAL_SORT_FILTERS.map((sort) => (
				<option key={sort} value={sort}>
					{DEAL_SORT_LABELS[sort]}
				</option>
			))}
		</select>
	);
}
