import { CreateDealForm } from '@/components/deals/create-deal-form';
import { DealActions } from '@/components/deals/deal-actions';
import { DealsFilter } from '@/components/deals/deals-filter';
import { DealsKanban } from '@/components/deals/deals-kanban';
import { DealsLoadMore } from '@/components/deals/deals-load-more';
import { DealsSort } from '@/components/deals/deals-sort';
import { DealsViewToggle } from '@/components/deals/deals-view-toggle';
import { DEAL_STAGE_BG_COLORS, DEAL_STAGE_COLORS } from '@/lib/colors';
import { formatCurrency } from '@/lib/format';
import { getUserWorkspaceId, getWorkspaceEnvelope, requireSession } from '@/lib/workspace';
import {
	type DealSortOption,
	getContactsByIds,
	getDealStageCounts,
	getStageVelocityStats,
	listDeals,
	listPendingCandidates,
} from '@repo/db';
import Link from 'next/link';
import { Suspense } from 'react';

export default async function DealsPage({
	searchParams,
}: {
	searchParams: Promise<{ stage?: string; sort?: string }>;
}) {
	const session = await requireSession();
	const workspaceId = await getUserWorkspaceId(session.user.id);
	const { stage, sort } = await searchParams;

	return (
		<div>
			<div className="mb-6 flex items-center justify-between">
				<h1 className="text-2xl font-bold text-foreground">Deals</h1>
				{workspaceId ? <CreateDealForm /> : null}
			</div>

			{workspaceId ? (
				<Suspense fallback={<PipelineSummarySkeleton />}>
					<PipelineSummary workspaceId={workspaceId} />
				</Suspense>
			) : null}

			{workspaceId ? (
				<div className="flex items-center justify-between gap-3">
					<DealsFilter workspaceId={workspaceId} />
					<DealsSort />
				</div>
			) : null}

			<Suspense fallback={<DealsListSkeleton />}>
				{workspaceId ? (
					<DealsList workspaceId={workspaceId} stage={stage} sort={sort as DealSortOption} />
				) : (
					<div className="mt-4 rounded-lg border border-border bg-muted p-8 text-center text-sm text-muted-foreground">
						Create a deal to start tracking — Gordian will build its decision context over time.
					</div>
				)}
			</Suspense>
		</div>
	);
}

const stageLabels: Record<string, string> = {
	discovery: 'Discovery',
	diligence: 'Diligence',
	negotiation: 'Negotiation',
	committed: 'Committed',
	won: 'Won',
	lost: 'Lost',
};

async function PipelineSummary({ workspaceId }: { workspaceId: string }) {
	const counts = await getDealStageCounts(workspaceId);

	if (counts.length === 0) return null;

	const totalDeals = counts.reduce((sum, c) => sum + c.count, 0);
	const totalValue = counts.reduce((sum, c) => sum + c.totalValue, 0);

	return (
		<div className="mb-6 rounded-lg border border-border bg-card p-4">
			<div className="mb-3 flex items-center justify-between">
				<span className="text-sm font-medium text-foreground">
					Pipeline: {totalDeals} deal{totalDeals !== 1 ? 's' : ''}
				</span>
				<span className="text-sm font-medium text-foreground">{formatCurrency(totalValue)}</span>
			</div>
			<div className="flex gap-3">
				{counts.map((entry) => (
					<div key={entry.stage} className="flex items-center gap-1.5">
						<span
							className={`inline-block h-2 w-2 rounded-full ${DEAL_STAGE_BG_COLORS[entry.stage] || 'bg-muted-foreground'}`}
						/>
						<span className="text-xs text-muted-foreground">
							{stageLabels[entry.stage] || entry.stage} ({entry.count})
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

const dealTypeLabels: Record<string, string> = {
	investment: 'Investment',
	advisory: 'Advisory',
	partnership: 'Partnership',
	token: 'Token',
	other: 'Other',
};

async function DealsList({
	workspaceId,
	stage,
	sort,
}: { workspaceId: string; stage?: string; sort?: DealSortOption }) {
	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) {
		return (
			<div className="mt-4 rounded-lg border border-border bg-muted p-8 text-center text-sm text-muted-foreground">
				No deals yet. Click &ldquo;New Deal&rdquo; to create one — Gordian will build its decision
				context over time.
			</div>
		);
	}

	const [dealsList, velocityStats, pendingCandidates] = await Promise.all([
		listDeals(workspaceId, envelope, {
			stage: stage && stage !== 'all' ? stage : undefined,
			sort,
			limit: 50,
		}),
		getStageVelocityStats(workspaceId),
		listPendingCandidates(workspaceId, envelope, { limit: 20 }),
	]);

	if (!dealsList || dealsList.length === 0) {
		return (
			<div className="mt-4 rounded-lg border border-border bg-muted p-8 text-center text-sm text-muted-foreground">
				No deals yet. Click &ldquo;New Deal&rdquo; to create one — Gordian will build its decision
				context over time.
			</div>
		);
	}

	const counts = await getDealStageCounts(workspaceId);
	const totalDeals =
		stage && stage !== 'all'
			? (counts.find((c) => c.stage === stage)?.count ?? dealsList.length)
			: counts.reduce((sum, c) => sum + c.count, 0);

	// Resolve contact names for ghost candidates
	const candidateContactIds = [
		...new Set(pendingCandidates.filter((c) => c.contactId).map((c) => c.contactId as string)),
	];
	const candidateNameMap = new Map<string, string>();
	if (candidateContactIds.length > 0) {
		const contacts = await getContactsByIds(workspaceId, candidateContactIds, envelope);
		for (const c of contacts) {
			candidateNameMap.set(
				c.id as string,
				[c.firstName as string, c.lastName as string].filter(Boolean).join(' ') || 'Unknown',
			);
		}
	}

	const ghostCandidates = pendingCandidates.map((c) => ({
		id: c.id,
		dealTitleGuess: c.dealTitleGuess as string,
		dealTypeGuess: c.dealTypeGuess as string,
		contactId: c.contactId as string,
		contactName: candidateNameMap.get(c.contactId as string) || 'Unknown contact',
		confidence: c.confidence as number,
		signals: (c.signals ?? []) as Array<{ text: string; tier: string }>,
		createdAt: c.createdAt,
	}));

	const { EditDealButton } = await import('@/components/deals/edit-deal-button');

	const listView = (
		<div className="divide-y divide-border rounded-lg border border-border">
			{dealsList.map((deal) => {
				const contactName =
					[deal.contactFirstName, deal.contactLastName].filter(Boolean).join(' ') ||
					'Unknown contact';

				return (
					<div key={deal.id} className="flex items-center justify-between p-4">
						<div className="min-w-0">
							<div className="flex items-center gap-2">
								<EditDealButton
									dealId={deal.id}
									initialTitle={deal.title}
									initialValue={deal.value}
									initialDealType={deal.dealType || 'other'}
									initialNotes={deal.notes}
								/>
								{deal.dealType && deal.dealType !== 'other' ? (
									<span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
										{dealTypeLabels[deal.dealType] || deal.dealType}
									</span>
								) : null}
							</div>
							<Link
								href={`/deals/${deal.id}`}
								className="mt-0.5 block text-sm text-muted-foreground hover:text-primary"
							>
								{contactName}
							</Link>
						</div>
						<div className="flex items-center gap-3">
							<DealActions
								dealId={deal.id}
								stage={deal.stage}
								stageHistory={deal.stageHistory as Array<{ stage: string; timestamp: string }>}
							/>
							<span className="text-sm font-medium text-foreground">
								{formatCurrency(deal.value)}
							</span>
							<DealStageBadge stage={deal.stage} />
						</div>
					</div>
				);
			})}
		</div>
	);

	const kanbanView = (
		<DealsKanban
			deals={dealsList}
			velocityStats={velocityStats}
			ghostCandidates={ghostCandidates}
		/>
	);

	return (
		<div className="mt-4">
			<DealsLoadMore
				initialCount={dealsList.length}
				totalCount={totalDeals}
				stage={stage}
				sort={sort}
			>
				<DealsViewToggle listView={listView} kanbanView={kanbanView} />
			</DealsLoadMore>
		</div>
	);
}

function DealStageBadge({ stage }: { stage: string }) {
	return (
		<span
			className={`rounded-full px-2 py-0.5 text-xs font-medium ${DEAL_STAGE_COLORS[stage] || 'bg-muted text-muted-foreground'}`}
		>
			{stageLabels[stage] || stage}
		</span>
	);
}

function PipelineSummarySkeleton() {
	return (
		<div className="mb-6 animate-pulse rounded-lg border border-border bg-card p-4">
			<div className="mb-3 flex items-center justify-between">
				<div className="h-4 w-32 rounded bg-muted" />
				<div className="h-4 w-20 rounded bg-muted" />
			</div>
			<div className="flex gap-3">
				{[1, 2, 3].map((i) => (
					<div key={i} className="h-3 w-24 rounded bg-muted" />
				))}
			</div>
		</div>
	);
}

function DealsListSkeleton() {
	return (
		<div className="mt-4 divide-y divide-border rounded-lg border border-border">
			{[1, 2, 3, 4].map((i) => (
				<div key={i} className="animate-pulse p-4">
					<div className="flex items-center justify-between">
						<div>
							<div className="h-4 w-48 rounded bg-muted" />
							<div className="mt-2 h-3 w-32 rounded bg-muted" />
						</div>
						<div className="flex items-center gap-3">
							<div className="h-4 w-16 rounded bg-muted" />
							<div className="h-5 w-16 rounded-full bg-muted" />
						</div>
					</div>
				</div>
			))}
		</div>
	);
}
