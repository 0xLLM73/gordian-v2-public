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
		router.push(`${pathname}?${params.toString()}`);
	}

	return (
		<div className="flex flex-wrap gap-2">
			{DEAL_STAGE_FILTERS.map((stage) => (
				<button
					key={stage}
					type="button"
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
