import Link from 'next/link';
import {
	DEAL_SORT_LABELS,
	DEAL_STAGE_LABELS,
	type DealSortFilter,
	type DealStageFilter,
} from './filter-options';

interface DealsActiveFiltersProps {
	stage: DealStageFilter;
	sort: DealSortFilter;
}

export function buildDealsHref({
	stage = 'all',
	sort = 'last_activity',
}: Partial<DealsActiveFiltersProps> = {}) {
	const params = new URLSearchParams();
	if (stage !== 'all') params.set('stage', stage);
	if (sort !== 'last_activity') params.set('sort', sort);
	const query = params.toString();
	return query ? `/deals?${query}` : '/deals';
}

export function DealsActiveFilters({ stage, sort }: DealsActiveFiltersProps) {
	const chips: Array<{ key: string; label: string; href: string }> = [];

	if (stage !== 'all') {
		chips.push({
			key: 'stage',
			label: `Stage: ${DEAL_STAGE_LABELS[stage]}`,
			href: buildDealsHref({ stage: 'all', sort }),
		});
	}

	if (sort !== 'last_activity') {
		chips.push({
			key: 'sort',
			label: `Sort: ${DEAL_SORT_LABELS[sort]}`,
			href: buildDealsHref({ stage, sort: 'last_activity' }),
		});
	}

	if (chips.length === 0) return null;

	return (
		<div
			data-testid="deals-active-filters"
			className="mt-3 flex flex-wrap items-center gap-2 text-sm"
		>
			<span className="text-muted-foreground">Active filters</span>
			{chips.map((chip) => (
				<Link
					key={chip.key}
					href={chip.href}
					className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent"
				>
					{chip.label} <span className="ml-1 text-muted-foreground">Clear</span>
				</Link>
			))}
			<Link href="/deals" className="text-xs font-medium text-primary hover:text-primary">
				Clear all
			</Link>
		</div>
	);
}
