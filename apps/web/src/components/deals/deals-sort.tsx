'use client';
// Needs interactivity: URL navigation on sort change

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

const sortOptions = [
	{ value: 'last_activity', label: 'Last activity' },
	{ value: 'highest_value', label: 'Highest value' },
	{ value: 'newest', label: 'Newest' },
	{ value: 'oldest', label: 'Oldest' },
	{ value: 'most_stalled', label: 'Most stalled' },
] as const;

export function DealsSort() {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const currentSort = searchParams.get('sort') || 'last_activity';

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
			{sortOptions.map((opt) => (
				<option key={opt.value} value={opt.value}>
					{opt.label}
				</option>
			))}
		</select>
	);
}
