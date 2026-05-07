import { FollowUpPlanActions } from '@/components/follow-up-plans/follow-up-plan-actions';
import { FollowUpPlanWizardButton } from '@/components/follow-up-plans/follow-up-plan-wizard';
import { FOLLOW_UP_PLAN_STATUS_COLORS } from '@/lib/colors';
import { getUserWorkspaceId, getWorkspaceEnvelope, requireSession } from '@/lib/workspace';
import { getContactsByIds, listFollowUpPlans } from '@repo/db';
import { Suspense } from 'react';

const statusLabels: Record<string, string> = {
	draft: 'Draft',
	active: 'Active',
	paused: 'Paused',
	completed: 'Completed',
	cancelled: 'Cancelled',
};

export default async function FollowUpPlansPage() {
	const session = await requireSession();
	const workspaceId = await getUserWorkspaceId(session.user.id);

	return (
		<div>
			<div className="mb-6 flex items-center justify-between">
				<h1 className="text-2xl font-bold text-foreground">Follow-up Plans</h1>
				{workspaceId ? <FollowUpPlanWizardButton /> : null}
			</div>

			{workspaceId ? (
				<Suspense fallback={<FollowUpPlansSkeleton />}>
					<FollowUpPlansList workspaceId={workspaceId} />
				</Suspense>
			) : (
				<p className="text-sm text-muted-foreground">
					Connect Telegram to start using follow-up plans.
				</p>
			)}
		</div>
	);
}

async function FollowUpPlansList({ workspaceId }: { workspaceId: string }) {
	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) return <p className="text-sm text-muted-foreground">Workspace not found.</p>;
	const planList = await listFollowUpPlans(workspaceId, { limit: 50 }, envelope);

	if (planList.length === 0) {
		return (
			<div className="rounded-lg border border-border bg-muted p-8 text-center text-sm text-muted-foreground">
				No follow-up plans yet. Create one to start automated outreach sequences.
			</div>
		);
	}

	const contactIds = [...new Set(planList.map((c) => c.contactId).filter(Boolean) as string[])];
	const contactMap = new Map<string, string>();
	if (contactIds.length > 0) {
		const envelope = await getWorkspaceEnvelope(workspaceId);
		if (envelope) {
			const contacts = await getContactsByIds(workspaceId, contactIds, envelope);
			for (const c of contacts) {
				const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown';
				contactMap.set(c.id as string, name);
			}
		}
	}

	return (
		<div className="divide-y divide-border rounded-lg border border-border">
			{planList.map((c) => {
				const contactName = c.contactId ? contactMap.get(c.contactId) : null;
				return (
					<div key={c.id} className="flex items-center justify-between p-4">
						<div>
							<p className="font-medium text-foreground">{c.title}</p>
							<p className="mt-0.5 text-xs text-muted-foreground">
								{contactName ? <span className="text-foreground">{contactName}</span> : null}
								{contactName ? ' — ' : ''}
								Step {c.completedSteps}/{c.totalSteps}
								{c.templateId ? ` — ${c.templateId}` : ''}
							</p>
						</div>
						<div className="flex items-center gap-3">
							<FollowUpPlanActions followUpPlanId={c.id} status={c.status} />
							<span
								className={`rounded-full px-2 py-0.5 text-xs font-medium ${FOLLOW_UP_PLAN_STATUS_COLORS[c.status] || 'bg-muted text-muted-foreground'}`}
							>
								{statusLabels[c.status] || c.status}
							</span>
							{c.activatedAt ? (
								<span className="text-xs text-muted-foreground">
									Started {new Date(c.activatedAt).toLocaleDateString()}
								</span>
							) : null}
						</div>
					</div>
				);
			})}
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
