import { CreateDealForm } from '@/components/deals/create-deal-form';
import { DealsActiveFilters } from '@/components/deals/deals-active-filters';
import { DealsEmptyState } from '@/components/deals/deals-empty-state';
import { DealsFilter } from '@/components/deals/deals-filter';
import { DealsPipelineSummary } from '@/components/deals/deals-pipeline-summary';
import { DealsResultShell } from '@/components/deals/deals-result-shell';
import { DealsSort } from '@/components/deals/deals-sort';
import {
	type DealSortFilter,
	type DealStageFilter,
	normalizeDealSortFilter,
	normalizeDealStageFilter,
} from '@/components/deals/filter-options';
import { getUserWorkspaceId, getWorkspaceEnvelope, requireSession } from '@/lib/workspace';
import {
	getContactsByIds,
	getDealStageCounts,
	getStageVelocityStats,
	listDeals,
	listPendingCandidates,
} from '@repo/db';
import { Suspense } from 'react';

export default async function DealsPage({
	searchParams,
}: {
	searchParams: Promise<{ stage?: string; sort?: string }>;
}) {
	const session = await requireSession();
	const workspaceId = await getUserWorkspaceId(session.user.id);
	const { stage, sort } = await searchParams;
	const stageFilter = normalizeDealStageFilter(stage);
	const sortFilter = normalizeDealSortFilter(sort);

	return (
		<div>
			<div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<h1 className="text-2xl font-bold text-foreground">Deals</h1>
				{workspaceId ? <CreateDealForm /> : null}
			</div>

			{workspaceId ? (
				<Suspense fallback={<PipelineSummarySkeleton />}>
					<PipelineSummary workspaceId={workspaceId} />
				</Suspense>
			) : null}

			{workspaceId ? (
				<div className="rounded-lg border border-border bg-card p-3">
					<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
						<DealsFilter workspaceId={workspaceId} />
						<DealsSort />
					</div>
					<DealsActiveFilters stage={stageFilter} sort={sortFilter} />
				</div>
			) : null}

			<Suspense fallback={<DealsListSkeleton />}>
				{workspaceId ? (
					<DealsList workspaceId={workspaceId} stage={stageFilter} sort={sortFilter} />
				) : (
					<DealsEmptyState reason="workspace_unavailable" />
				)}
			</Suspense>
		</div>
	);
}

async function PipelineSummary({ workspaceId }: { workspaceId: string }) {
	const counts = await getDealStageCounts(workspaceId);

	return <DealsPipelineSummary counts={counts} />;
}

async function DealsList({
	workspaceId,
	stage,
	sort,
}: { workspaceId: string; stage: DealStageFilter; sort: DealSortFilter }) {
	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) {
		return <DealsEmptyState reason="envelope_unavailable" />;
	}

	const [dealsList, velocityStats, pendingCandidates, counts] = await Promise.all([
		listDeals(workspaceId, envelope, {
			stage: stage !== 'all' ? stage : undefined,
			sort,
			limit: 50,
		}),
		getStageVelocityStats(workspaceId),
		listPendingCandidates(workspaceId, envelope, { limit: 20 }),
		getDealStageCounts(workspaceId),
	]);

	const totalDeals = counts.reduce((sum, c) => sum + c.count, 0);
	const matchingDealsCount =
		stage !== 'all' ? (counts.find((c) => c.stage === stage)?.count ?? 0) : totalDeals;

	if (!dealsList || dealsList.length === 0) {
		return <DealsEmptyState stage={stage === 'all' ? undefined : stage} totalDeals={totalDeals} />;
	}

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

	return (
		<DealsResultShell
			initialDeals={dealsList}
			totalMatchingCount={matchingDealsCount}
			totalPipelineCount={totalDeals}
			stage={stage}
			sort={sort}
			velocityStats={velocityStats}
			ghostCandidates={ghostCandidates}
		/>
	);
}

function PipelineSummarySkeleton() {
	return (
		<div className="mb-6 animate-pulse rounded-lg border border-border bg-card p-4">
			<div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
				<div className="h-4 w-32 rounded bg-muted" />
				<div className="h-4 w-20 rounded bg-muted" />
			</div>
			<div className="flex flex-wrap gap-3">
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
					<div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
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
