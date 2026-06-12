import {
	getContactsByIds,
	getFollowUpPlanSteps,
	getFollowUpPlanWorkerHealth,
	getGoal,
	listFollowUpPlans,
} from '@repo/db';
import Link from 'next/link';
import { Suspense } from 'react';
import { FollowUpPlanActions } from '@/components/follow-up-plans/follow-up-plan-actions';
import { FollowUpPlanAttentionMessage } from '@/components/follow-up-plans/follow-up-plan-attention-message';
import { FollowUpPlanWizardButton } from '@/components/follow-up-plans/follow-up-plan-wizard';
import { FollowUpStatusStrip } from '@/components/follow-up-plans/follow-up-status-strip';
import { FOLLOW_UP_PLAN_STATUS_COLORS } from '@/lib/colors';
import {
	type FollowUpPlanListFilters,
	followUpPlanMatchesFilters,
	hasFollowUpPlanListFilters,
	parseFollowUpPlanListFilters,
} from '@/lib/follow-up-plan-list-filters';
import {
	countBlockedFollowUpPlanSteps,
	getFollowUpPlanAttentionSummary,
} from '@/lib/follow-up-plan-step-attention';
import { getFollowUpPlanReadiness } from '@/lib/follow-up-plans-readiness';
import { getUserWorkspaceId, getWorkspaceEnvelope, requireSession } from '@/lib/workspace';

type FollowUpPlansSearchParams = Record<string, string | string[] | undefined>;
type FollowUpPlan = Awaited<ReturnType<typeof listFollowUpPlans>>[number];
type FollowUpPlanStep = Awaited<ReturnType<typeof getFollowUpPlanSteps>>[number];

const statusLabels: Record<string, string> = {
	draft: 'Draft',
	active: 'Active',
	paused: 'Paused',
	completed: 'Completed',
	cancelled: 'Cancelled',
};

const statusGroupLabels: Record<string, string> = {
	active: 'Active plans',
	draft: 'Draft plans',
	paused: 'Paused plans',
	completed: 'Completed plans',
	cancelled: 'Cancelled plans',
};

function firstParam(value: string | string[] | undefined) {
	return Array.isArray(value) ? value[0] : value;
}

function validUuid(value: string | undefined) {
	if (!value) return undefined;
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
		? value
		: undefined;
}

function configText(config: unknown, key: string) {
	if (!config || typeof config !== 'object') return null;
	const value = (config as Record<string, unknown>)[key];
	return typeof value === 'string' && value.trim() ? value : null;
}

function formatDateTime(value: Date | string | null | undefined) {
	if (!value) return null;
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return date.toLocaleString();
}

export default async function FollowUpPlansPage({
	searchParams,
}: {
	searchParams: Promise<FollowUpPlansSearchParams>;
}) {
	const session = await requireSession();
	const workspaceId = await getUserWorkspaceId(session.user.id);
	const params = await searchParams;
	const initialContactId = firstParam(params.contactId);
	const requestedGoalId = validUuid(firstParam(params.goalId));
	const filters = parseFollowUpPlanListFilters(params);

	if (!workspaceId) {
		return (
			<div>
				<div className="mb-6 flex items-center justify-between">
					<h1 className="text-2xl font-bold text-foreground">Follow-up Plans</h1>
				</div>
				<p className="text-sm text-muted-foreground">
					Connect Telegram to start using follow-up plans.
				</p>
			</div>
		);
	}

	const readiness = await getFollowUpPlanReadiness({ userId: session.user.id, workspaceId });
	const envelope = requestedGoalId ? await getWorkspaceEnvelope(workspaceId) : null;
	const initialGoal =
		envelope && requestedGoalId ? await getGoal(workspaceId, requestedGoalId, envelope) : null;
	const initialGoalId = initialGoal?.id;
	const initialGoalTitle = initialGoal?.title ?? undefined;
	const openWizard = firstParam(params.new) === '1' || Boolean(initialContactId || initialGoalId);

	return (
		<div>
			<div className="mb-6 flex items-center justify-between">
				<h1 className="text-2xl font-bold text-foreground">Follow-up Plans</h1>
				<FollowUpPlanWizardButton
					initialContactId={initialContactId}
					initialGoalId={initialGoalId}
					initialGoalTitle={initialGoalTitle}
					openOnMount={openWizard}
					readiness={readiness}
				/>
			</div>

			<Suspense fallback={<FollowUpPlansSkeleton />}>
				<FollowUpPlansList workspaceId={workspaceId} readiness={readiness} filters={filters} />
			</Suspense>
		</div>
	);
}

async function FollowUpPlansList({
	workspaceId,
	readiness,
	filters,
}: {
	workspaceId: string;
	readiness: NonNullable<Awaited<ReturnType<typeof getFollowUpPlanReadiness>>>;
	filters: FollowUpPlanListFilters;
}) {
	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) return <p className="text-sm text-muted-foreground">Workspace not found.</p>;
	const [planList, workerHealth] = await Promise.all([
		listFollowUpPlans(workspaceId, { limit: 50 }, envelope),
		getFollowUpPlanWorkerHealth(),
	]);
	const stepEntries = await Promise.all(
		planList.map(
			async (plan) =>
				[plan.id, await getFollowUpPlanSteps(workspaceId, plan.id, envelope)] as const,
		),
	);
	const stepsByPlan = new Map<string, FollowUpPlanStep[]>(stepEntries);
	const now = new Date();
	const templateOptions = [
		...new Set(
			planList.map((plan) => plan.templateId).filter((value): value is string => Boolean(value)),
		),
	].sort((a, b) => a.localeCompare(b));

	if (planList.length === 0) {
		return (
			<div className="space-y-4">
				<FollowUpStatusStrip
					reviewCount={0}
					overdueCount={0}
					blockedCount={0}
					activeCount={0}
					workerHealth={workerHealth}
					readiness={readiness}
				/>
				<FollowUpPlanFilterBar filters={filters} templateOptions={templateOptions} />
				<div className="rounded-lg border border-border bg-muted p-8 text-center text-sm text-muted-foreground">
					No follow-up plans yet. Create one to schedule local draft reminders for review.
				</div>
			</div>
		);
	}

	const contactIds = [...new Set(planList.map((c) => c.contactId).filter(Boolean) as string[])];
	const contactMap = new Map<string, string>();
	if (contactIds.length > 0) {
		const contacts = await getContactsByIds(workspaceId, contactIds, envelope);
		for (const c of contacts) {
			const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown';
			contactMap.set(c.id as string, name);
		}
	}

	const filteredPlanList = planList.filter((plan) =>
		followUpPlanMatchesFilters(plan, stepsByPlan.get(plan.id) ?? [], filters, now),
	);
	const reviewItems = filteredPlanList.flatMap((plan) =>
		(stepsByPlan.get(plan.id) ?? [])
			.filter((step) => step.status === 'pending_review' && step.draftText)
			.map((step) => ({ plan, step })),
	);
	const reviewCount = planList.reduce(
		(count, plan) =>
			count +
			(stepsByPlan.get(plan.id) ?? []).filter(
				(step) => step.status === 'pending_review' && step.draftText,
			).length,
		0,
	);
	const overdueCount = planList.reduce((count, plan) => {
		const overdueSteps = (stepsByPlan.get(plan.id) ?? []).filter((step) => {
			if (step.status !== 'ready' || !step.scheduledAt) return false;
			const scheduledAt =
				step.scheduledAt instanceof Date ? step.scheduledAt : new Date(step.scheduledAt);
			return scheduledAt <= now;
		});
		return count + overdueSteps.length;
	}, 0);
	const blockedCount = planList.reduce(
		(count, plan) => count + countBlockedFollowUpPlanSteps(stepsByPlan.get(plan.id) ?? []),
		0,
	);
	const activeCount = planList.filter((plan) => plan.status === 'active').length;
	const groupedPlans = ['active', 'draft', 'paused', 'completed', 'cancelled'].map((status) => ({
		status,
		plans: filteredPlanList.filter((plan) => plan.status === status),
	}));
	const hasFilters = hasFollowUpPlanListFilters(filters);

	return (
		<div className="space-y-6">
			<FollowUpStatusStrip
				reviewCount={reviewCount}
				overdueCount={overdueCount}
				blockedCount={blockedCount}
				activeCount={activeCount}
				workerHealth={workerHealth}
				readiness={readiness}
			/>
			<FollowUpPlanFilterBar filters={filters} templateOptions={templateOptions} />
			<NeedsReviewQueue reviewItems={reviewItems} contactMap={contactMap} />
			{filteredPlanList.length === 0 && hasFilters ? (
				<div className="rounded-lg border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
					No follow-up plans match these filters.
				</div>
			) : (
				groupedPlans.map(({ status, plans }) =>
					plans.length > 0 ? (
						<PlanSection
							key={status}
							title={statusGroupLabels[status] ?? status}
							plans={plans}
							contactMap={contactMap}
							stepsByPlan={stepsByPlan}
							now={now}
						/>
					) : null,
				)
			)}
		</div>
	);
}

function FollowUpPlanFilterBar({
	filters,
	templateOptions,
}: {
	filters: FollowUpPlanListFilters;
	templateOptions: string[];
}) {
	return (
		<form
			action="/follow-up-plans"
			className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_auto]"
		>
			<label htmlFor="follow-up-status-filter" className="space-y-1">
				<span className="text-xs font-medium uppercase text-muted-foreground">Status</span>
				<select
					id="follow-up-status-filter"
					name="status"
					defaultValue={filters.status ?? ''}
					className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
				>
					<option value="">All statuses</option>
					<option value="active">Active</option>
					<option value="draft">Draft</option>
					<option value="paused">Paused</option>
					<option value="completed">Completed</option>
					<option value="cancelled">Cancelled</option>
				</select>
			</label>
			<label htmlFor="follow-up-attention-filter" className="space-y-1">
				<span className="text-xs font-medium uppercase text-muted-foreground">Attention</span>
				<select
					id="follow-up-attention-filter"
					name="attention"
					defaultValue={filters.attention ?? ''}
					className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
				>
					<option value="">All work</option>
					<option value="needs_review">Needs review</option>
					<option value="overdue">Overdue</option>
					<option value="active">Active plans</option>
				</select>
			</label>
			<label htmlFor="follow-up-template-filter" className="space-y-1">
				<span className="text-xs font-medium uppercase text-muted-foreground">Template</span>
				<select
					id="follow-up-template-filter"
					name="templateId"
					defaultValue={filters.templateId ?? ''}
					className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
				>
					<option value="">All templates</option>
					{templateOptions.map((templateId) => (
						<option key={templateId} value={templateId}>
							{templateId}
						</option>
					))}
				</select>
			</label>
			<div className="flex items-end gap-2">
				<button
					type="submit"
					className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary/90"
				>
					Apply
				</button>
				<Link
					href="/follow-up-plans"
					className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
				>
					Clear
				</Link>
			</div>
		</form>
	);
}

function NeedsReviewQueue({
	reviewItems,
	contactMap,
}: {
	reviewItems: Array<{ plan: FollowUpPlan; step: FollowUpPlanStep }>;
	contactMap: Map<string, string>;
}) {
	if (reviewItems.length === 0) {
		return (
			<div className="rounded-lg border border-border bg-card p-4">
				<h2 className="text-base font-semibold text-foreground">Needs review</h2>
				<p className="mt-1 text-sm text-muted-foreground">
					No local drafts are waiting. Due steps will appear here before anything can be marked
					sent.
				</p>
			</div>
		);
	}

	return (
		<div className="rounded-lg border border-amber-200 bg-amber-50">
			<div className="border-b border-amber-200 p-4">
				<h2 className="text-base font-semibold text-amber-950">Needs review</h2>
				<p className="mt-1 text-sm text-amber-900">
					These drafts were generated locally and have not been sent.
				</p>
			</div>
			<div className="divide-y divide-amber-200">
				{reviewItems.map(({ plan, step }) => {
					const contactName = plan.contactId ? contactMap.get(plan.contactId) : null;
					return (
						<Link
							key={step.id}
							href={`/follow-up-plans/${plan.id}`}
							className="block p-4 hover:bg-amber-100/70"
						>
							<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
								<div>
									<p className="font-medium text-amber-950">{plan.title}</p>
									<p className="mt-0.5 text-xs text-amber-900">
										{contactName ? `${contactName} - ` : ''}Step {step.stepNumber} needs manual
										review
									</p>
								</div>
								<span className="w-fit rounded-full bg-white px-2 py-0.5 text-xs font-medium text-amber-800">
									Not sent
								</span>
							</div>
							<p className="mt-2 line-clamp-2 text-sm text-amber-950">{step.draftText}</p>
						</Link>
					);
				})}
			</div>
		</div>
	);
}

function PlanSection({
	title,
	plans,
	contactMap,
	stepsByPlan,
	now,
}: {
	title: string;
	plans: FollowUpPlan[];
	contactMap: Map<string, string>;
	stepsByPlan: Map<string, FollowUpPlanStep[]>;
	now: Date;
}) {
	return (
		<div className="rounded-lg border border-border">
			<div className="border-b border-border p-4">
				<h2 className="text-base font-semibold text-foreground">{title}</h2>
			</div>
			<div className="divide-y divide-border">
				{plans.map((plan) => (
					<PlanRow
						key={plan.id}
						plan={plan}
						contactName={plan.contactId ? contactMap.get(plan.contactId) : null}
						steps={stepsByPlan.get(plan.id) ?? []}
						now={now}
					/>
				))}
			</div>
		</div>
	);
}

function PlanRow({
	plan,
	contactName,
	steps,
	now,
}: {
	plan: FollowUpPlan;
	contactName: string | null | undefined;
	steps: FollowUpPlanStep[];
	now: Date;
}) {
	const objective = plan.objective ?? configText(plan.config, 'objective');
	const sendingMode = configText(plan.config, 'sendingMode') ?? 'manual';
	const attention = getFollowUpPlanAttentionSummary(steps, now);
	const latestReviewDraft = steps.find(
		(step) => step.status === 'pending_review' && step.draftText,
	);
	const templateLabel = plan.templateId
		? `${plan.templateId}${plan.templateVersion ? ` v${plan.templateVersion}` : ''}`
		: null;

	return (
		<div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
			<div className="min-w-0">
				<Link
					href={`/follow-up-plans/${plan.id}`}
					className="font-medium text-foreground hover:text-indigo-600"
				>
					{plan.title}
				</Link>
				<p className="mt-0.5 text-xs text-muted-foreground">
					{contactName ? <span className="text-foreground">{contactName}</span> : null}
					{contactName ? ' - ' : ''}
					Step {plan.completedSteps}/{plan.totalSteps}
					{templateLabel ? ` - ${templateLabel}` : ''}
				</p>
				{objective ? <p className="mt-1 text-sm text-muted-foreground">{objective}</p> : null}
				{latestReviewDraft?.draftText ? (
					<p className="mt-1 line-clamp-1 text-sm text-amber-700">
						Draft waiting: {latestReviewDraft.draftText}
					</p>
				) : null}
				<FollowUpPlanAttentionMessage attention={attention} />
			</div>
			<div className="flex flex-wrap items-center gap-2 lg:justify-end">
				<span
					className={`rounded-full px-2 py-0.5 text-xs font-medium ${
						attention.tone === 'danger'
							? 'bg-red-100 text-red-700'
							: attention.tone === 'warn'
								? 'bg-amber-100 text-amber-700'
								: attention.tone === 'ok'
									? 'bg-emerald-100 text-emerald-700'
									: 'bg-muted text-muted-foreground'
					}`}
				>
					{attention.label}
				</span>
				<span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
					{sendingMode === 'manual' ? 'Manual send' : 'Reminder only'}
				</span>
				<FollowUpPlanActions followUpPlanId={plan.id} status={plan.status} />
				<Link
					href={`/follow-up-plans/${plan.id}`}
					className="rounded px-2 py-1 text-xs font-medium text-primary hover:bg-blue-50"
				>
					View
				</Link>
				<span
					className={`rounded-full px-2 py-0.5 text-xs font-medium ${FOLLOW_UP_PLAN_STATUS_COLORS[plan.status] || 'bg-muted text-muted-foreground'}`}
				>
					{statusLabels[plan.status] || plan.status}
				</span>
				{plan.activatedAt ? (
					<span className="text-xs text-muted-foreground">
						Started {formatDateTime(plan.activatedAt)}
					</span>
				) : null}
			</div>
		</div>
	);
}

function FollowUpPlansSkeleton() {
	return (
		<div className="divide-y divide-border rounded-lg border border-border">
			{[1, 2, 3].map((i) => (
				<div key={i} className="animate-pulse p-4">
					<div className="flex items-center justify-between">
						<div>
							<div className="h-4 w-48 rounded bg-muted" />
							<div className="mt-2 h-3 w-24 rounded bg-muted" />
						</div>
						<div className="h-5 w-16 rounded-full bg-muted" />
					</div>
				</div>
			))}
		</div>
	);
}
