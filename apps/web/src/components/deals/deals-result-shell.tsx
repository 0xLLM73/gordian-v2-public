'use client';

import type { DealSortOption, StageVelocityStats } from '@repo/db';
import type { DealStage } from '@repo/shared';
import { useAction } from 'next-safe-action/hooks';
import { useEffect, useMemo, useState } from 'react';
import { listDealsAction } from '@/app/actions/deals';
import { DealActions } from '@/components/deals/deal-actions';
import { DealRow } from '@/components/deals/deal-row';
import { DealStageMoveMenu } from '@/components/deals/deal-stage-move-menu';
import { DealsKanban } from '@/components/deals/deals-kanban';
import { DealsResultSummary } from '@/components/deals/deals-result-summary';
import { DealsViewToggle } from '@/components/deals/deals-view-toggle';
import { EditDealButton } from '@/components/deals/edit-deal-button';
import { Button } from '@/components/ui/button';
import type { DealSortFilter, DealStageFilter } from './filter-options';
import type { GhostCandidate } from './ghost-card';

interface Deal {
	id: string;
	title: string;
	dealType: string | null;
	stage: string;
	value: number;
	notes: string | null;
	stageHistory: unknown;
	contactFirstName: string | null;
	contactLastName: string | null;
}

const dealTypeLabels: Record<string, string> = {
	investment: 'Investment',
	advisory: 'Advisory',
	partnership: 'Partnership',
	token: 'Token',
	other: 'Other',
};

interface DealsResultShellProps {
	initialDeals: Deal[];
	totalMatchingCount: number;
	totalPipelineCount: number;
	stage: DealStageFilter;
	sort: DealSortFilter;
	velocityStats?: StageVelocityStats | null;
	ghostCandidates?: GhostCandidate[];
}

export function DealsResultShell({
	initialDeals,
	totalMatchingCount,
	totalPipelineCount,
	stage,
	sort,
	velocityStats,
	ghostCandidates,
}: DealsResultShellProps) {
	const [deals, setDeals] = useState<Deal[]>(initialDeals);
	const [hasMore, setHasMore] = useState(initialDeals.length < totalMatchingCount);

	useEffect(() => {
		setDeals(initialDeals);
		setHasMore(initialDeals.length < totalMatchingCount);
	}, [initialDeals, totalMatchingCount]);

	const { execute: loadMore, isExecuting } = useAction(listDealsAction, {
		onSuccess: (result) => {
			if (!result.data) return;
			const loadedDeals = result.data as Deal[];
			setDeals((prev) => {
				const nextDeals = [...prev, ...loadedDeals];
				setHasMore(nextDeals.length < totalMatchingCount && loadedDeals.length >= 50);
				return nextDeals;
			});
		},
	});

	const listView = useMemo(
		() => (
			<div className="divide-y divide-border rounded-lg border border-border">
				{deals.map((deal) => {
					const contactName =
						[deal.contactFirstName, deal.contactLastName].filter(Boolean).join(' ') ||
						'Unknown contact';

					return (
						<DealRow
							key={deal.id}
							dealId={deal.id}
							titleControl={
								<EditDealButton
									dealId={deal.id}
									initialTitle={deal.title}
									initialValue={deal.value}
									initialDealType={deal.dealType || 'other'}
									initialNotes={deal.notes}
								/>
							}
							contactName={contactName}
							dealTypeLabel={
								deal.dealType && deal.dealType !== 'other'
									? dealTypeLabels[deal.dealType] || deal.dealType
									: null
							}
							actions={
								<>
									<DealActions
										dealId={deal.id}
										stage={deal.stage}
										stageHistory={deal.stageHistory as Array<{ stage: string; timestamp: string }>}
									/>
									<DealStageMoveMenu
										dealId={deal.id}
										currentStage={deal.stage}
										label={`Move stage for ${deal.title}`}
									/>
								</>
							}
							value={deal.value}
							stage={deal.stage}
						/>
					);
				})}
			</div>
		),
		[deals],
	);

	const kanbanView = useMemo(
		() => (
			<DealsKanban deals={deals} velocityStats={velocityStats} ghostCandidates={ghostCandidates} />
		),
		[deals, ghostCandidates, velocityStats],
	);

	return (
		<div className="mt-4">
			<DealsResultSummary
				displayedCount={deals.length}
				totalMatchingCount={totalMatchingCount}
				totalPipelineCount={totalPipelineCount}
				stage={stage}
				sort={sort}
			/>
			<DealsViewToggle listView={listView} kanbanView={kanbanView} />
			<div className="mt-3 flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
				<span>
					Loaded {deals.length} of {totalMatchingCount} deal
					{totalMatchingCount !== 1 ? 's' : ''}
				</span>
				{hasMore ? (
					<Button
						variant="outline"
						size="sm"
						disabled={isExecuting}
						onClick={() =>
							loadMore({
								stage: stage !== 'all' ? (stage as DealStage) : undefined,
								sort: sort as DealSortOption,
								limit: 50,
								offset: deals.length,
							})
						}
					>
						{isExecuting ? 'Loading...' : 'Load more'}
					</Button>
				) : null}
			</div>
		</div>
	);
}
