'use client';

import type { StageVelocityStats } from '@repo/db';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { updateDealAction } from '@/app/actions/deals';
import { DEAL_STAGE_BORDER_COLORS } from '@/lib/colors';
import { formatCurrency } from '@/lib/format';
import { DealStageMoveMenu } from './deal-stage-move-menu';
import { type GhostCandidate, GhostCard } from './ghost-card';

interface DealItem {
	id: string;
	title: string;
	value: number;
	stage: string;
	dealType: string | null;
	contactFirstName?: string | null;
	contactLastName?: string | null;
	stageHistory?: unknown;
}

const STAGES = ['discovery', 'diligence', 'negotiation', 'committed', 'won', 'lost'] as const;

const stageLabels: Record<string, string> = {
	discovery: 'Discovery',
	diligence: 'Diligence',
	negotiation: 'Negotiation',
	committed: 'Committed',
	won: 'Won',
	lost: 'Lost',
};

function getDaysInStage(deal: DealItem): number | null {
	const history = deal.stageHistory as Array<{ stage: string; timestamp: string }> | null;
	if (!Array.isArray(history) || history.length === 0) return null;
	const lastEntry = history[history.length - 1];
	if (!lastEntry?.timestamp) return null;
	const ms = Date.now() - new Date(lastEntry.timestamp).getTime();
	return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function getVelocityBadgeColor(days: number, avgDays: number | undefined): string {
	if (!avgDays || avgDays <= 0) return 'bg-muted text-muted-foreground';
	const ratio = days / avgDays;
	if (ratio > 2.0) return 'bg-red-100 text-red-700';
	if (ratio > 1.5) return 'bg-orange-100 text-orange-700';
	return 'bg-muted text-muted-foreground';
}

export function DealsKanban({
	deals,
	velocityStats,
	ghostCandidates: initialGhosts,
}: {
	deals: DealItem[];
	velocityStats?: StageVelocityStats | null;
	ghostCandidates?: GhostCandidate[];
}) {
	const router = useRouter();
	const [dragging, setDragging] = useState<string | null>(null);
	const [ghosts, setGhosts] = useState<GhostCandidate[]>(initialGhosts ?? []);

	const handleGhostRemove = useCallback((id: string) => {
		setGhosts((prev) => prev.filter((g) => g.id !== id));
	}, []);

	function handleDragStart(dealId: string) {
		setDragging(dealId);
	}

	function handleDragOver(e: React.DragEvent) {
		e.preventDefault();
	}

	async function handleDrop(e: React.DragEvent, targetStage: string) {
		e.preventDefault();
		if (!dragging) return;

		const deal = deals.find((d) => d.id === dragging);
		if (!deal || deal.stage === targetStage) {
			setDragging(null);
			return;
		}

		setDragging(null);
		await updateDealAction({ dealId: dragging, stage: targetStage as (typeof STAGES)[number] });
		router.refresh();
	}

	const avgDays = velocityStats?.avgDaysPerStage;
	const convRates = velocityStats?.conversionRates;

	return (
		<div data-testid="deals-board" className="grid gap-3 pb-4 md:flex md:overflow-x-auto">
			{STAGES.map((stage, stageIdx) => {
				const stageDeals = deals.filter((d) => d.stage === stage);
				const totalValue = stageDeals.reduce((sum, d) => sum + d.value, 0);
				const stageAvg = avgDays?.[stage];
				const convRate = convRates?.[stage];
				const nextStage = stageIdx < STAGES.length - 1 ? STAGES[stageIdx + 1] : null;

				return (
					<div
						key={stage}
						data-testid="deals-board-column"
						data-stage={stage}
						className={`min-w-0 flex-1 rounded-lg border-t-2 bg-muted md:min-w-[200px] ${DEAL_STAGE_BORDER_COLORS[stage]}`}
						onDragOver={handleDragOver}
						onDrop={(e) => handleDrop(e, stage)}
					>
						{/* Layer 2: Column header with avg + conversion */}
						<div className="border-b border-border px-3 py-2">
							<div className="flex items-center justify-between">
								<span className="text-xs font-semibold uppercase text-muted-foreground">
									{stageLabels[stage]}
								</span>
								<span className="text-xs text-muted-foreground">{stageDeals.length}</span>
							</div>
							{totalValue > 0 ? (
								<p className="text-xs text-muted-foreground">{formatCurrency(totalValue)}</p>
							) : null}
							{(stageAvg !== undefined || convRate !== undefined) &&
							stage !== 'won' &&
							stage !== 'lost' ? (
								<div className="mt-1 flex items-center gap-2">
									{stageAvg !== undefined ? (
										<span className="text-[10px] text-muted-foreground">
											Avg: {Math.round(stageAvg)}d
										</span>
									) : null}
									{convRate !== undefined && nextStage ? (
										<span className="text-[10px] text-muted-foreground">{convRate}% &rarr;</span>
									) : null}
								</div>
							) : null}
						</div>
						<div className="space-y-2 p-2">
							{stage === 'discovery' && ghosts.length > 0 ? (
								<>
									<div className="rounded border border-dashed border-border bg-background px-2 py-1 text-[10px] font-semibold uppercase tracking-normal text-muted-foreground">
										Unconfirmed candidates
									</div>
									{ghosts.map((candidate) => (
										<GhostCard
											key={candidate.id}
											candidate={candidate}
											onRemove={handleGhostRemove}
										/>
									))}
									<div key="ghost-divider" className="border-t border-dashed border-border" />
								</>
							) : null}
							{stageDeals.map((deal) => {
								const name =
									[deal.contactFirstName, deal.contactLastName].filter(Boolean).join(' ') ||
									'Unknown';
								const days = getDaysInStage(deal);
								const badgeColor = days !== null ? getVelocityBadgeColor(days, stageAvg) : '';

								return (
									<div
										key={deal.id}
										data-testid="deal-board-card"
										data-deal-id={deal.id}
										draggable
										onDragStart={() => handleDragStart(deal.id)}
										className={`cursor-grab rounded-md border border-border bg-card p-2.5 shadow-stripe-sm transition-shadow hover:shadow-stripe ${
											dragging === deal.id ? 'opacity-50' : ''
										}`}
									>
										<div className="flex items-start justify-between gap-2">
											<div className="min-w-0">
												<Link
													href={`/deals/${deal.id}`}
													className="break-words text-sm font-medium text-foreground hover:text-primary hover:underline"
												>
													{deal.title}
												</Link>
												<p className="mt-0.5 text-xs text-muted-foreground">{name}</p>
											</div>
											<Link
												href={`/deals/${deal.id}`}
												className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/10"
											>
												Open
											</Link>
										</div>
										<div className="mt-1 flex items-center justify-between">
											<p className="text-xs font-medium text-foreground">
												{formatCurrency(deal.value)}
											</p>
											{/* Layer 1: Days in stage badge */}
											{days !== null && stage !== 'won' && stage !== 'lost' ? (
												<span
													className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badgeColor}`}
												>
													{days}d in stage
												</span>
											) : null}
										</div>
										<div className="mt-2">
											<DealStageMoveMenu
												dealId={deal.id}
												currentStage={deal.stage}
												label={`Move stage for ${deal.title}`}
												className="w-full"
											/>
										</div>
									</div>
								);
							})}
							{stageDeals.length === 0 ? (
								<div className="rounded border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
									Drop here
								</div>
							) : null}
						</div>
					</div>
				);
			})}
		</div>
	);
}
