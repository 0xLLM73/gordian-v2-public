'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

const stages = [
	'all',
	'discovery',
	'diligence',
	'negotiation',
	'committed',
	'won',
	'lost',
] as const;

const stageLabels: Record<string, string> = {
	all: 'All',
	discovery: 'Discovery',
	diligence: 'Diligence',
	negotiation: 'Negotiation',
	committed: 'Committed',
	won: 'Won',
	lost: 'Lost',
};

export function DealsFilter({ workspaceId: _workspaceId }: { workspaceId: string }) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const currentStage = searchParams.get('stage') || 'all';

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
			{stages.map((stage) => (
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
					{stageLabels[stage]}
				</button>
			))}
		</div>
	);
}
