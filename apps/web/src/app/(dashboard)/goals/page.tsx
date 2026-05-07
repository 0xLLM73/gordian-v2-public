import { CreateGoalForm } from '@/components/goals/create-goal-form';
import { GoalActionList } from '@/components/goals/goal-action-list';
import { GoalActions } from '@/components/goals/goal-actions';
import { GoalAnalytics } from '@/components/goals/goal-analytics';
import { GoalOutreachPanel } from '@/components/goals/goal-outreach-panel';
import { GoalProgressHistory } from '@/components/goals/goal-progress-history';
import { GoalsFilter } from '@/components/goals/goals-filter';
import { GOAL_STATUS_COLORS, GOAL_TYPE_COLORS } from '@/lib/colors';
import { getUserWorkspaceId, getWorkspaceEnvelope, requireSession } from '@/lib/workspace';
import { type GoalRow, getContactsByIds, listGoalActions, listGoals } from '@repo/db';
import { Suspense } from 'react';

export default async function GoalsPage({
	searchParams,
}: {
	searchParams: Promise<{ status?: string; type?: string; sort?: string }>;
}) {
	const session = await requireSession();
	const workspaceId = await getUserWorkspaceId(session.user.id);
	const { status, type, sort } = await searchParams;

	return (
		<div>
			<div className="mb-6 flex items-center justify-between">
				<h1 className="text-2xl font-bold text-foreground">Goals</h1>
				{workspaceId ? <CreateGoalForm /> : null}
			</div>

			{workspaceId ? <GoalsFilter /> : null}

			{workspaceId ? <GoalAnalytics /> : null}

			<Suspense fallback={<GoalsSkeleton />}>
				{workspaceId ? (
					<GoalsList workspaceId={workspaceId} status={status} type={type} sort={sort} />
				) : (
					<EmptyState />
				)}
			</Suspense>
		</div>
	);
}

async function GoalsList({
	workspaceId,
	status,
	type,
	sort,
}: { workspaceId: string; status?: string; type?: string; sort?: string }) {
	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) return <EmptyState />;
	const goalsList = await listGoals(
		workspaceId,
		{
			status: status && status !== 'all' ? status : undefined,
			type: type && type !== 'all' ? type : undefined,
			sort: sort || undefined,
			limit: 50,
		},
		envelope,
	);

	if (!goalsList || goalsList.length === 0) {
		return <EmptyState />;
	}

	// Fetch actions for all goals in parallel
	const allActions = await Promise.all(
		goalsList.map((goal) => listGoalActions(workspaceId, goal.id, envelope)),
	);

	// Compute pending counts per goal and collect contactIds
	const pendingCounts: Record<string, number> = {};
	const contactIdSet = new Set<string>();
	for (let i = 0; i < goalsList.length; i++) {
		const goal = goalsList[i];
		const actions = allActions[i] ?? [];
		pendingCounts[goal.id] = actions.filter(
			(a) => a.status === 'pending' || a.status === 'in_progress',
		).length;
		for (const a of actions) {
			if (a.contactId) contactIdSet.add(a.contactId);
		}
	}

	// Resolve contact names in one batch
	const contactIds = [...contactIdSet];
	const contacts =
		contactIds.length > 0 ? await getContactsByIds(workspaceId, contactIds, envelope) : [];
	const contactNames: Record<string, string> = {};
	for (const c of contacts) {
		contactNames[c.id] = [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown';
	}

	const { EditGoalButton } = await import('@/components/goals/edit-goal-button');

	return (
		<div className="mt-4 space-y-4">
			{goalsList.map((goal) => (
				<GoalCard
					key={goal.id}
					goal={goal}
					EditGoalButton={EditGoalButton}
					pendingActionCount={pendingCounts[goal.id] ?? 0}
					contactNames={contactNames}
				/>
			))}
		</div>
	);
}

function GoalCard({
	goal,
	EditGoalButton,
	pendingActionCount,
	contactNames,
}: {
	goal: GoalRow;
	EditGoalButton: React.ComponentType<{
		goalId: string;
		initialTitle: string;
		initialDescription: string | null;
		initialType: string;
		initialTargetCount: number;
		initialTargetDate: string | null;
	}>;
	pendingActionCount: number;
	contactNames: Record<string, string>;
}) {
	const pct =
		goal.targetCount > 0
			? Math.min(Math.round((goal.currentCount / goal.targetCount) * 100), 100)
			: 0;
	const isOverdue =
		goal.targetDate && new Date(goal.targetDate) < new Date() && goal.status === 'active';

	// Progress bar gradient: blue -> green -> gold
	const barColor = pct >= 100 ? 'bg-amber-400' : pct >= 60 ? 'bg-green-500' : 'bg-blue-500';

	return (
		<div className="rounded-lg border border-border p-4">
			<div className="flex items-center justify-between">
				<div>
					<EditGoalButton
						goalId={goal.id}
						initialTitle={goal.title}
						initialDescription={goal.description || null}
						initialType={goal.type}
						initialTargetCount={goal.targetCount}
						initialTargetDate={goal.targetDate ? new Date(goal.targetDate).toISOString() : null}
					/>
					{goal.description ? (
						<p className="mt-0.5 text-sm text-muted-foreground">{goal.description}</p>
					) : null}
				</div>
				<div className="flex items-center gap-2">
					<GoalActions goalId={goal.id} status={goal.status} />
					<span
						className={`rounded-full px-2 py-0.5 text-xs font-medium ${GOAL_TYPE_COLORS[goal.type] || 'bg-muted text-muted-foreground'}`}
					>
						{goal.type}
					</span>
					<span
						className={`rounded-full px-2 py-0.5 text-xs font-medium ${GOAL_STATUS_COLORS[goal.status] || 'bg-muted text-muted-foreground'}`}
					>
						{goal.status}
					</span>
				</div>
			</div>

			<div className="mt-3">
				<div className="mb-1 flex items-center justify-between text-sm">
					<span className="text-muted-foreground">
						{goal.currentCount}/{goal.targetCount}
					</span>
					<span className="font-medium text-foreground">{pct}%</span>
				</div>
				<div className="h-2 w-full overflow-hidden rounded-full bg-muted">
					<div
						className={`h-full rounded-full transition-all ${barColor}`}
						style={{ width: `${pct}%` }}
					/>
				</div>
			</div>

			<GoalProgressHistory goalId={goal.id} />

			<GoalActionList
				goalId={goal.id}
				pendingCount={pendingActionCount}
				contactNames={contactNames}
			/>

			{goal.status === 'active' ? <GoalOutreachPanel goalId={goal.id} /> : null}

			{goal.targetDate ? (
				<p
					className={`mt-2 text-xs ${isOverdue ? 'font-medium text-red-600' : 'text-muted-foreground'}`}
				>
					{isOverdue ? 'Overdue — ' : 'Target: '}
					{new Date(goal.targetDate).toLocaleDateString()}
				</p>
			) : null}
			{goal.completedAt ? (
				<p className="mt-1 text-xs text-green-600">
					Completed: {new Date(goal.completedAt).toLocaleDateString()}
				</p>
			) : null}
		</div>
	);
}

function EmptyState() {
	return (
		<div className="mt-4 rounded-lg border border-border bg-muted p-8 text-center">
			<p className="text-sm text-muted-foreground">
				No goals yet. Click "New Goal" to create one, or goals will appear as Gordian identifies
				trackable objectives from your conversations.
			</p>
		</div>
	);
}

function GoalsSkeleton() {
	return (
		<div className="mt-4 space-y-4">
			{[1, 2, 3].map((i) => (
				<div key={i} className="animate-pulse rounded-lg border border-border p-4">
					<div className="flex items-center justify-between">
						<div className="h-4 w-48 rounded bg-muted" />
						<div className="h-5 w-16 rounded-full bg-muted" />
					</div>
					<div className="mt-3 h-2 w-full rounded-full bg-muted" />
				</div>
			))}
		</div>
	);
}
