import { getCommitmentsByWorkspace } from '@repo/db';
import { canRunCloudCommitmentIntelligence, isLocalOnlyMode } from '@repo/shared';
import { Suspense } from 'react';
import { CommitmentActions } from '@/components/commitment-actions';
import { COMMITMENT_STATUS_COLORS } from '@/lib/colors';
import { getUserWorkspaceId, getWorkspaceEnvelope, requireSession } from '@/lib/workspace';
import { CommitmentFinder } from './commitment-finder';
import { CommitmentsFilter } from './commitments-filter';
import { type CommitmentStatusFilter, normalizeCommitmentStatusFilter } from './status-filter';

function commitmentModeCopy() {
	if (canRunCloudCommitmentIntelligence()) {
		return {
			heading: 'Track short-term promises, tasks, and follow-ups from your workspace.',
			empty:
				'No commitments yet. Automatic extraction will appear here after permitted conversations are analyzed.',
		};
	}

	if (isLocalOnlyMode()) {
		return {
			heading: 'Track short-term promises, tasks, and follow-ups without sending them to cloud AI.',
			empty:
				'No commitments yet. Local-only mode keeps cloud extraction off; this page shows commitments you create, import, or explicitly enable for analysis.',
		};
	}

	return {
		heading: 'Track short-term promises, tasks, and follow-ups from your workspace.',
		empty: 'No commitments yet. Automatic commitment extraction is currently disabled.',
	};
}

function commitmentStatusCopy(status: CommitmentStatusFilter) {
	switch (status) {
		case 'draft':
			return {
				heading: 'Review suggested actions before they become commitments.',
				empty: 'No suggested commitments to review.',
			};
		case 'snoozed':
			return {
				heading: 'Confirmed commitments temporarily hidden from active follow-up.',
				empty: 'No snoozed commitments.',
			};
		case 'completed':
			return {
				heading: 'Commitments marked done.',
				empty: 'No completed commitments yet.',
			};
		case 'dismissed':
			return {
				heading: 'Commitments and suggestions dismissed from review.',
				empty: 'No dismissed commitments.',
			};
		case 'all':
			return {
				heading: 'All confirmed commitments and review suggestions.',
				empty: 'No commitments or suggestions yet.',
			};
		default:
			return {
				heading: 'Confirmed commitments that need action.',
				empty: 'No active commitments yet. Confirmed suggestions from review will appear here.',
			};
	}
}

export default async function CommitmentsPage({
	searchParams,
}: {
	searchParams: Promise<{ status?: string }>;
}) {
	const session = await requireSession();
	const workspaceId = await getUserWorkspaceId(session.user.id);
	const resolvedParams = await searchParams;
	const status = normalizeCommitmentStatusFilter(resolvedParams?.status);
	const copy = commitmentModeCopy();
	const statusCopy = commitmentStatusCopy(status);

	return (
		<div>
			<div className="mb-6 flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold text-foreground">Commitments</h1>
					<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
						{statusCopy.heading} {copy.heading}
					</p>
				</div>
			</div>

			{workspaceId ? (
				<>
					<CommitmentsFilter workspaceId={workspaceId} />
					<CommitmentFinder />
				</>
			) : null}

			<Suspense fallback={<CommitmentsListSkeleton />}>
				{workspaceId ? (
					<CommitmentsList workspaceId={workspaceId} status={status} />
				) : (
					<div className="mt-4 rounded-lg border border-border bg-muted p-8 text-center text-sm text-muted-foreground">
						{copy.empty}
					</div>
				)}
			</Suspense>
		</div>
	);
}

async function CommitmentsList({
	workspaceId,
	status,
}: {
	workspaceId: string;
	status: CommitmentStatusFilter;
}) {
	const statusCopy = commitmentStatusCopy(status);
	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) {
		return (
			<div className="mt-4 rounded-lg border border-border bg-muted p-8 text-center text-sm text-muted-foreground">
				{statusCopy.empty}
			</div>
		);
	}
	const commitments = await getCommitmentsByWorkspace(workspaceId, envelope, { status, limit: 50 });

	if (!commitments || commitments.length === 0) {
		return (
			<div className="mt-4 rounded-lg border border-border bg-muted p-8 text-center text-sm text-muted-foreground">
				{statusCopy.empty}
			</div>
		);
	}

	return (
		<div className="mt-4 divide-y divide-border rounded-lg border border-border">
			{commitments.map((c: Record<string, unknown>) => (
				<CommitmentCard key={c.id as string} commitment={c} />
			))}
		</div>
	);
}

function CommitmentCard({ commitment: c }: { commitment: Record<string, unknown> }) {
	const isFulfilled = c.status === 'completed' && c.fulfillmentEvidence;
	const showActions = c.status === 'active' || c.status === 'draft';
	const isDraft = c.status === 'draft';
	const contactName = [c.contactFirstName, c.contactLastName].filter(Boolean).join(' ');
	const isSnoozed =
		c.status === 'active' && c.snoozedUntil && new Date(c.snoozedUntil as string) > new Date();

	return (
		<div key={c.id as string} className="p-4">
			<div className="flex items-center justify-between">
				<div>
					<p className="font-medium text-foreground">{c.title as string}</p>
					<p className="mt-0.5 text-sm text-muted-foreground">
						{isDraft ? 'Suggested action' : (c.commitmentType as string)} &middot; Assigned to{' '}
						{c.assignee as string}
						{contactName ? ` \u00b7 ${contactName}` : null}
					</p>
				</div>
				<div className="flex items-center gap-3">
					{isDraft ? (
						<span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
							Review
						</span>
					) : null}
					{isSnoozed ? (
						<span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
							Snoozed until {new Date(c.snoozedUntil as string).toLocaleDateString()}
						</span>
					) : null}
					{showActions ? (
						<CommitmentActions
							commitmentId={c.id as string}
							status={c.status as 'active' | 'draft'}
						/>
					) : null}
					<ConfidenceIndicator score={c.confidence as number} />
					<StatusBadge status={isSnoozed ? 'snoozed' : (c.status as string)} />
				</div>
			</div>
			{c.quote ? (
				<blockquote className="mt-2 border-l-2 border-border pl-3 text-sm italic text-muted-foreground">
					&ldquo;{c.quote as string}&rdquo;
				</blockquote>
			) : null}
			{isFulfilled ? (
				<div className="mt-2 rounded-md bg-blue-50 p-2">
					<p className="text-xs font-medium text-blue-700">Fulfillment Evidence:</p>
					<p className="mt-0.5 text-xs text-blue-600">{c.fulfillmentEvidence as string}</p>
					{c.fulfilledAt ? (
						<p className="mt-0.5 text-xs text-blue-400">
							Fulfilled: {new Date(c.fulfilledAt as string).toLocaleDateString()}
						</p>
					) : null}
				</div>
			) : null}
			{c.dueDate ? (
				<p className="mt-1 text-xs text-muted-foreground">
					Due: {new Date(c.dueDate as string).toLocaleDateString()}
				</p>
			) : null}
		</div>
	);
}

function ConfidenceIndicator({ score }: { score: number }) {
	const pct = Math.round(score * 100);
	const color = score > 0.85 ? 'text-green-600' : score > 0.5 ? 'text-yellow-600' : 'text-red-600';
	return <span className={`text-xs font-medium ${color}`}>{pct}%</span>;
}

function StatusBadge({ status }: { status: string }) {
	return (
		<span
			className={`rounded-full px-2 py-0.5 text-xs font-medium ${COMMITMENT_STATUS_COLORS[status] || 'bg-muted text-muted-foreground'}`}
		>
			{status}
		</span>
	);
}

function CommitmentsListSkeleton() {
	return (
		<div className="mt-4 divide-y divide-border rounded-lg border border-border">
			{[1, 2, 3, 4].map((i) => (
				<div key={i} className="animate-pulse p-4">
					<div className="flex items-center justify-between">
						<div>
							<div className="h-4 w-48 rounded bg-muted" />
							<div className="mt-2 h-3 w-32 rounded bg-muted" />
						</div>
						<div className="h-5 w-16 rounded-full bg-muted" />
					</div>
				</div>
			))}
		</div>
	);
}
