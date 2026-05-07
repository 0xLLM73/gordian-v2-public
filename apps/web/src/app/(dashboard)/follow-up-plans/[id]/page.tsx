import { FollowUpPlanActions } from '@/components/follow-up-plans/follow-up-plan-actions';
import { StepReviewActions } from '@/components/follow-up-plans/step-review-actions';
import { FOLLOW_UP_PLAN_STATUS_COLORS } from '@/lib/colors';
import { getUserWorkspaceId, getWorkspaceEnvelope, requireSession } from '@/lib/workspace';
import { getContactsByIds, getFollowUpPlan, getFollowUpPlanSteps } from '@repo/db';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

const statusLabels: Record<string, string> = {
	draft: 'Draft',
	active: 'Active',
	paused: 'Paused',
	completed: 'Completed',
	cancelled: 'Cancelled',
};

const stepStatusLabels: Record<string, string> = {
	pending: 'Pending',
	ready: 'Ready',
	pending_review: 'Needs Review',
	sent: 'Sent',
	skipped: 'Skipped',
	failed: 'Failed',
};

const stepStatusColors: Record<string, string> = {
	pending: 'bg-gray-100 text-gray-700',
	ready: 'bg-blue-100 text-blue-700',
	pending_review: 'bg-amber-100 text-amber-700',
	sent: 'bg-green-100 text-green-700',
	skipped: 'bg-red-100 text-red-700',
	failed: 'bg-red-100 text-red-700',
};

export default async function FollowUpPlanDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const session = await requireSession();
	const workspaceId = await getUserWorkspaceId(session.user.id);
	if (!workspaceId) notFound();

	const { id } = await params;

	return (
		<Suspense fallback={<DetailSkeleton />}>
			<FollowUpPlanDetail workspaceId={workspaceId} planId={id} />
		</Suspense>
	);
}

async function FollowUpPlanDetail({
	workspaceId,
	planId,
}: {
	workspaceId: string;
	planId: string;
}) {
	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) notFound();

	const [plan, steps] = await Promise.all([
		getFollowUpPlan(workspaceId, planId, envelope),
		getFollowUpPlanSteps(workspaceId, planId, envelope),
	]);

	if (!plan) notFound();

	let contactName: string | null = null;
	if (plan.contactId) {
		const contacts = await getContactsByIds(workspaceId, [plan.contactId], envelope);
		if (contacts.length > 0) {
			contactName = [contacts[0].firstName, contacts[0].lastName].filter(Boolean).join(' ') || null;
		}
	}

	const completedSteps = plan.completedSteps ?? 0;
	const totalSteps = plan.totalSteps ?? steps.length;
	const progressPct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

	return (
		<div>
			<div className="mb-6">
				<div className="flex items-center justify-between">
					<h1 className="text-2xl font-bold text-foreground">{plan.title}</h1>
					<div className="flex items-center gap-3">
						<FollowUpPlanActions followUpPlanId={plan.id} status={plan.status} />
						<span
							className={`rounded-full px-2.5 py-1 text-xs font-medium ${FOLLOW_UP_PLAN_STATUS_COLORS[plan.status] || 'bg-muted text-muted-foreground'}`}
						>
							{statusLabels[plan.status] || plan.status}
						</span>
					</div>
				</div>
				<div className="mt-2 flex items-center gap-4 text-sm text-muted-foreground">
					{contactName ? (
						<span>
							Contact: <span className="text-foreground">{contactName}</span>
						</span>
					) : null}
					{plan.templateId ? <span>Template: {plan.templateId}</span> : null}
					{plan.activatedAt ? (
						<span>Started {new Date(plan.activatedAt).toLocaleDateString()}</span>
					) : null}
				</div>
			</div>

			<div className="mb-6">
				<div className="mb-1 flex items-center justify-between text-sm">
					<span className="text-muted-foreground">Step progress</span>
					<span className="font-medium text-foreground">
						{completedSteps}/{totalSteps}
					</span>
				</div>
				<div className="h-2 w-full overflow-hidden rounded-full bg-muted">
					<div
						className="h-full rounded-full bg-primary transition-all"
						style={{ width: `${progressPct}%` }}
					/>
				</div>
			</div>

			<div className="space-y-3">
				<h2 className="text-lg font-semibold text-foreground">Steps</h2>
				{steps.length === 0 ? (
					<p className="text-sm text-muted-foreground">No steps configured.</p>
				) : (
					<div className="divide-y divide-border rounded-lg border border-border">
						{steps.map((step) => (
							<div key={step.id} className="p-4">
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-2">
										<span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
											{step.stepNumber}
										</span>
										<span
											className={`rounded-full px-2 py-0.5 text-xs font-medium ${stepStatusColors[step.status] || 'bg-muted text-muted-foreground'}`}
										>
											{stepStatusLabels[step.status] || step.status}
										</span>
									</div>
									<div className="flex items-center gap-3 text-xs text-muted-foreground">
										<span>{step.delayHours}h delay</span>
										{step.scheduledAt ? (
											<span>Scheduled: {new Date(step.scheduledAt).toLocaleString()}</span>
										) : null}
										{step.sentAt ? (
											<span>Sent: {new Date(step.sentAt).toLocaleString()}</span>
										) : null}
									</div>
								</div>
								<p className="mt-2 text-sm text-muted-foreground">{step.prompt}</p>
								{step.draftText ? (
									<div className="mt-2 rounded-md border border-border bg-muted/50 p-3">
										<p className="text-xs font-medium text-muted-foreground">Draft</p>
										<p className="mt-1 text-sm text-foreground">{step.draftText}</p>
									</div>
								) : null}
								{step.status === 'pending_review' && step.draftText ? (
									<StepReviewActions
										stepId={step.id}
										followUpPlanId={planId}
										draftText={step.draftText}
									/>
								) : null}
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

function DetailSkeleton() {
	return (
		<div className="animate-pulse">
			<div className="mb-6">
				<div className="h-8 w-64 rounded bg-muted" />
				<div className="mt-2 h-4 w-48 rounded bg-muted" />
			</div>
			<div className="mb-6">
				<div className="h-2 w-full rounded-full bg-muted" />
			</div>
			<div className="space-y-3">
				<div className="h-6 w-24 rounded bg-muted" />
				<div className="divide-y divide-border rounded-lg border border-border">
					{[1, 2, 3].map((i) => (
						<div key={i} className="p-4">
							<div className="flex items-center gap-2">
								<div className="h-6 w-6 rounded-full bg-muted" />
								<div className="h-5 w-16 rounded-full bg-muted" />
							</div>
							<div className="mt-2 h-4 w-full rounded bg-muted" />
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
