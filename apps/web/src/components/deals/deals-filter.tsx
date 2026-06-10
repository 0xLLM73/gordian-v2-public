'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { DEAL_STAGE_FILTERS, DEAL_STAGE_LABELS, normalizeDealStageFilter } from './filter-options';

export function DealsFilter({ workspaceId: _workspaceId }: { workspaceId: string }) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const currentStage = normalizeDealStageFilter(searchParams.get('stage') ?? undefined);

	function handleFilter(stage: string) {
		const params = new URLSearchParams(searchParams.toString());
		if (stage === 'all') {
			params.delete('stage');
		} else {
			params.set('stage', stage);
		}
		const query = params.toString();
		router.push(query ? `${pathname}?${query}` : pathname);
	}

	return (
		<div className="flex flex-wrap gap-2" aria-label="Filter deals by stage">
			{DEAL_STAGE_FILTERS.map((stage) => (
				<button
					key={stage}
					type="button"
					aria-pressed={currentStage === stage}
					onClick={() => handleFilter(stage)}
					className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
						currentStage === stage
							? 'bg-foreground text-background'
							: 'bg-muted text-muted-foreground hover:bg-accent'
					}`}
				>
					{DEAL_STAGE_LABELS[stage]}
				</button>
			))}
		</div>
	);
}
