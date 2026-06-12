'use client';

// Needs interactivity: load-more state management, server action calls

import type { DealStage } from '@repo/shared';
import { useAction } from 'next-safe-action/hooks';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { listDealsAction } from '@/app/actions/deals';
import { DealActions } from '@/components/deals/deal-actions';
import { DealRow } from '@/components/deals/deal-row';
import { EditDealButton } from '@/components/deals/edit-deal-button';
import { Button } from '@/components/ui/button';

type DealSortOption = 'last_activity' | 'highest_value' | 'newest' | 'oldest' | 'most_stalled';

const dealTypeLabels: Record<string, string> = {
	investment: 'Investment',
	advisory: 'Advisory',
	partnership: 'Partnership',
	token: 'Token',
	other: 'Other',
};

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

interface DealsLoadMoreProps {
	initialCount: number;
	totalCount: number;
	stage?: string;
	sort?: DealSortOption;
	children: ReactNode;
}

export function DealsLoadMore({
	initialCount,
	totalCount,
	stage,
	sort,
	children,
}: DealsLoadMoreProps) {
	const [extraDeals, setExtraDeals] = useState<Deal[]>([]);
	const [hasMore, setHasMore] = useState(initialCount < totalCount);
	const displayedCount = initialCount + extraDeals.length;

	const { execute: loadMore, isExecuting } = useAction(listDealsAction, {
		onSuccess: (result) => {
			if (result.data) {
				setExtraDeals((prev) => [...prev, ...(result.data as Deal[])]);
				if ((result.data as Deal[]).length < 50) {
					setHasMore(false);
				}
			}
		},
	});

	return (
		<div>
			{children}
			{extraDeals.length > 0 && (
				<div className="divide-y divide-border rounded-b-lg border-x border-b border-border">
					{extraDeals.map((deal) => {
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
									<DealActions
										dealId={deal.id}
										stage={deal.stage}
										stageHistory={deal.stageHistory as Array<{ stage: string; timestamp: string }>}
									/>
								}
								value={deal.value}
								stage={deal.stage}
							/>
						);
					})}
				</div>
			)}
			<div className="mt-3 flex items-center justify-between">
				<span className="text-sm text-muted-foreground">
					Showing {displayedCount} of {totalCount} deal{totalCount !== 1 ? 's' : ''}
				</span>
				{hasMore && (
					<Button
						variant="outline"
						size="sm"
						disabled={isExecuting}
						onClick={() =>
							loadMore({
								stage: stage && stage !== 'all' ? (stage as DealStage) : undefined,
								sort,
								limit: 50,
								offset: displayedCount,
							})
						}
					>
						{isExecuting ? 'Loading...' : 'Load more'}
					</Button>
				)}
			</div>
		</div>
	);
}
