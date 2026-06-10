import { ContactReplyPauseNotice } from '@/components/follow-up-plans/contact-reply-pause-notice';
import { FollowUpContactContext } from '@/components/follow-up-plans/follow-up-contact-context';
import { FollowUpPlanActions } from '@/components/follow-up-plans/follow-up-plan-actions';
import { SavePlanTemplateAction } from '@/components/follow-up-plans/save-plan-template-action';
import { StepProcessingStatus } from '@/components/follow-up-plans/step-processing-status';
import { StepRescheduleAction } from '@/components/follow-up-plans/step-reschedule-action';
import { StepReviewActions } from '@/components/follow-up-plans/step-review-actions';
import { StepSendStatus } from '@/components/follow-up-plans/step-send-status';
import { FOLLOW_UP_PLAN_STATUS_COLORS } from '@/lib/colors';
import { getUserWorkspaceId, getWorkspaceEnvelope, requireSession } from '@/lib/workspace';
import {
	getContactsByIds,
	getFollowUpPlan,
	getFollowUpPlanSteps,
	getLastMessageDate,
	getLatestSummary,
	getMessageCount,
	getMessagesByContact,
	listFollowUpPlanActivity,
	listFollowUpPlanDraftRevisions,
	listFollowUpPlanSendRecords,
} from '@repo/db';
import Link from 'next/link';
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
	sent: 'Manually Sent',
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

const reschedulableStepStatuses = new Set(['pending', 'ready', 'failed']);

const draftStatusLabels: Record<string, string> = {
	pending_review: 'Pending review',
	edited: 'Edited',
	sent_version: 'Sent version',
	rejected: 'Rejected',
	superseded: 'Superseded',
	failed: 'Failed',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function telegramDestinationUrl(contact: { username?: unknown } | null) {
	const rawUsername = typeof contact?.username === 'string' ? contact.username.trim() : '';
	const username = rawUsername.replace(/^@/, '');
	if (/^[A-Za-z0-9_]{5,32}$/.test(username)) return `https://t.me/${username}`;
	return 'https://web.telegram.org/k/';
}

export default async function FollowUpPlanDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const session = await requireSession();
	const workspaceId = await getUserWorkspaceId(session.user.id);
	if (!workspaceId) notFound();

	const { id } = await params;
	if (!UUID_RE.test(id)) notFound();

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

	const [plan, steps, activityEvents, draftRevisions, sendRecords] = await Promise.all([
		getFollowUpPlan(workspaceId, planId, envelope),
		getFollowUpPlanSteps(workspaceId, planId, envelope),
		listFollowUpPlanActivity(workspaceId, planId, { limit: 20 }),
		listFollowUpPlanDraftRevisions(workspaceId, planId, envelope, { limit: 100 }),
		listFollowUpPlanSendRecords(workspaceId, planId, { limit: 100 }),
	]);

	if (!plan) notFound();

	let contactName: string | null = null;
	let telegramUrl: string | null = null;
	let contactSummary: {
		summary: string | null;
		generatedAt?: Date | string | null;
		messageCount?: number | null;
		styleVariant?: string | null;
	} | null = null;
	let recentMessages: Array<{
		id: string;
		text: string | null;
		isOutgoing: boolean;
		sentAt: Date | string;
	}> = [];
	let messageCount = 0;
	let lastMessageAt: Date | null = null;
	if (plan.contactId) {
		const [contacts, summary, messages, totalMessages, lastTouch] = await Promise.all([
			getContactsByIds(workspaceId, [plan.contactId], envelope),
			getLatestSummary(workspaceId, plan.contactId, envelope),
			getMessagesByContact(workspaceId, plan.contactId, envelope, { limit: 3 }),
			getMessageCount(workspaceId, plan.contactId),
			getLastMessageDate(workspaceId, plan.contactId),
		]);
		if (contacts.length > 0) {
			const contact = contacts[0];
			contactName = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || null;
			telegramUrl = telegramDestinationUrl(contact);
		}
		contactSummary = summary
			? {
					summary: (summary as Record<string, unknown>).summary as string | null,
					generatedAt: (summary as Record<string, unknown>).generatedAt as Date | string | null,
					messageCount: (summary as Record<string, unknown>).messageCount as number | null,
					styleVariant: (summary as Record<string, unknown>).styleVariant as string | null,
				}
			: null;
		recentMessages = messages.map((message) => ({
			id: message.id,
			text: message.text,
			isOutgoing: message.isOutgoing,
			sentAt: message.sentAt,
		}));
		messageCount = totalMessages;
		lastMessageAt = lastTouch;
	}

	const completedSteps = plan.completedSteps ?? 0;
	const totalSteps = plan.totalSteps ?? steps.length;
	const progressPct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
	const objective = plan.objective ?? configText(plan.config, 'objective');
	const tone = configText(plan.config, 'tone');
	const sendingMode = configText(plan.config, 'sendingMode') ?? 'manual';
	const aiMode = configText(plan.config, 'aiMode') ?? 'local_ai';
	const templateLabel = plan.templateId
		? `${plan.templateId}${plan.templateVersion ? ` v${plan.templateVersion}` : ''}`
		: null;
	const reviewStep = steps.find((step) => step.status === 'pending_review' && step.draftText);
	type DraftRevision = (typeof draftRevisions)[number];
	const draftRevisionsByStep = new Map<string, DraftRevision[]>();
	for (const revision of draftRevisions) {
		const existing = draftRevisionsByStep.get(revision.stepId) ?? [];
		existing.push(revision);
		draftRevisionsByStep.set(revision.stepId, existing);
	}
	type SendRecord = (typeof sendRecords)[number];
	const sendRecordsByStep = new Map<string, SendRecord[]>();
	for (const record of sendRecords) {
		const existing = sendRecordsByStep.get(record.stepId) ?? [];
		existing.push(record);
		sendRecordsByStep.set(record.stepId, existing);
	}

	return (
		<div>
			<div className="mb-6">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<h1 className="text-2xl font-bold text-foreground">{plan.title}</h1>
					<div className="flex flex-wrap items-center gap-3">
						<SavePlanTemplateAction followUpPlanId={plan.id} />
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
					{templateLabel ? <span>Template: {templateLabel}</span> : null}
					{plan.activatedAt ? (
						<span>Started {new Date(plan.activatedAt).toLocaleDateString()}</span>
					) : null}
				</div>
			</div>

			<div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<div className="rounded-lg border border-border bg-card p-4">
					<p className="text-xs font-medium uppercase text-muted-foreground">Draft mode</p>
					<p className="mt-1 text-sm font-semibold text-foreground">
						{aiMode === 'local_ai'
							? 'Local AI'
							: aiMode === 'template_only'
								? 'Template only'
								: 'Reminder only'}
					</p>
				</div>
				<div className="rounded-lg border border-border bg-card p-4">
					<p className="text-xs font-medium uppercase text-muted-foreground">Sending</p>
					<p className="mt-1 text-sm font-semibold text-foreground">
						{sendingMode === 'manual' ? 'Manual confirmation' : 'Reminder only'}
					</p>
				</div>
				<div className="rounded-lg border border-border bg-card p-4">
					<p className="text-xs font-medium uppercase text-muted-foreground">Safety</p>
					<p className="mt-1 text-sm font-semibold text-foreground">No automatic sends</p>
				</div>
				<div className="rounded-lg border border-border bg-card p-4">
					<p className="text-xs font-medium uppercase text-muted-foreground">Tone</p>
					<p className="mt-1 text-sm font-semibold text-foreground">
						{tone ?? 'Workspace default'}
					</p>
				</div>
			</div>

			{objective ? (
				<div className="mb-6 rounded-lg border border-border bg-card p-4">
					<p className="text-xs font-medium uppercase text-muted-foreground">Objective</p>
					<p className="mt-1 text-sm text-foreground">{objective}</p>
				</div>
			) : null}

			<FollowUpContactContext
				contactName={contactName}
				summary={contactSummary}
				messages={recentMessages}
				messageCount={messageCount}
				lastMessageAt={lastMessageAt}
			/>

			<ContactReplyPauseNotice
				planStatus={plan.status}
				contactName={contactName}
				activityEvents={activityEvents}
			/>

			{reviewStep?.draftText ? (
				<div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
					<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
						<div>
							<h2 className="text-base font-semibold text-amber-950">Draft needs review</h2>
							<p className="mt-1 text-sm text-amber-900">
								Draft generated locally. Not sent. Copy it, send it manually, then confirm.
							</p>
						</div>
						<span className="w-fit rounded-full bg-white px-2 py-0.5 text-xs font-medium text-amber-800">
							Step {reviewStep.stepNumber}
						</span>
					</div>
					<div className="mt-3 rounded-md border border-amber-200 bg-white p-3">
						<p className="text-sm text-foreground">{reviewStep.draftText}</p>
					</div>
					<StepSendStatus records={sendRecordsByStep.get(reviewStep.id) ?? []} />
					<StepReviewActions
						stepId={reviewStep.id}
						followUpPlanId={planId}
						draftText={reviewStep.draftText}
						telegramUrl={telegramUrl}
					/>
				</div>
			) : null}

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

			<div className="mb-6 space-y-3">
				<div className="flex items-center justify-between">
					<h2 className="text-lg font-semibold text-foreground">Activity</h2>
					<span className="text-xs text-muted-foreground">
						Copy, manual send, skip, and lifecycle history
					</span>
				</div>
				{activityEvents.length === 0 ? (
					<p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
						No activity recorded for this plan yet.
					</p>
				) : (
					<div className="divide-y divide-border rounded-lg border border-border">
						{activityEvents.map((event) => (
							<div
								key={event.id}
								className="flex flex-col gap-1 p-4 sm:flex-row sm:items-start sm:justify-between"
							>
								<div>
									<p className="text-sm font-medium text-foreground">{event.summary}</p>
									<p className="mt-1 text-xs text-muted-foreground">
										{event.eventType.replaceAll('_', ' ')}
										{event.stepId ? ' · Step activity' : ''}
									</p>
								</div>
								<p className="text-xs text-muted-foreground">{formatDateTime(event.createdAt)}</p>
							</div>
						))}
					</div>
				)}
			</div>

			<div className="space-y-3">
				<h2 className="text-lg font-semibold text-foreground">Steps</h2>
				{steps.length === 0 ? (
					<p className="text-sm text-muted-foreground">No steps configured.</p>
				) : (
					<div className="divide-y divide-border rounded-lg border border-border">
						{steps.map((step) => {
							const showRowReschedule =
								reschedulableStepStatuses.has(step.status) ||
								(step.status === 'pending_review' &&
									(!step.draftText || step.id !== reviewStep?.id));

							return (
								<div key={step.id} className="p-4">
									<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
												<span>Scheduled: {formatDateTime(step.scheduledAt)}</span>
											) : null}
											{step.sentAt ? <span>Manual sent: {formatDateTime(step.sentAt)}</span> : null}
										</div>
									</div>
									<p className="mt-2 text-sm text-muted-foreground">{step.prompt}</p>
									<StepProcessingStatus
										status={step.status}
										lastProcessingError={step.lastProcessingError}
										processingLeaseExpiresAt={step.processingLeaseExpiresAt}
									/>
									{step.draftText ? (
										<div className="mt-2 rounded-md border border-border bg-muted/50 p-3">
											<p className="text-xs font-medium text-muted-foreground">
												Draft generated locally. Not sent.
											</p>
											<p className="mt-1 text-sm text-foreground">{step.draftText}</p>
										</div>
									) : null}
									<StepSendStatus records={sendRecordsByStep.get(step.id) ?? []} />
									{step.status === 'pending_review' &&
									step.draftText &&
									step.id !== reviewStep?.id ? (
										<StepReviewActions
											stepId={step.id}
											followUpPlanId={planId}
											draftText={step.draftText}
											telegramUrl={telegramUrl}
										/>
									) : null}
									{showRowReschedule ? (
										<div className="mt-3">
											<StepRescheduleAction stepId={step.id} followUpPlanId={planId} />
										</div>
									) : null}
									{(draftRevisionsByStep.get(step.id)?.length ?? 0) > 0 ? (
										<div className="mt-3 rounded-md border border-border bg-background p-3">
											<p className="text-xs font-medium text-muted-foreground">Draft history</p>
											<div className="mt-2 space-y-2">
												{draftRevisionsByStep.get(step.id)?.map((revision) => (
													<div key={revision.id} className="rounded-md bg-muted/40 p-3">
														<div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
															<p className="text-xs font-medium text-foreground">
																Version {revision.version} ·{' '}
																{draftStatusLabels[revision.status] ?? revision.status}
															</p>
															<p className="text-xs text-muted-foreground">
																{formatDateTime(revision.createdAt)}
															</p>
														</div>
														<p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
															{revision.draftText}
														</p>
													</div>
												))}
											</div>
										</div>
									) : null}
								</div>
							);
						})}
					</div>
				)}
			</div>
			<div className="mt-4">
				<Link href="/follow-up-plans" className="text-sm font-medium text-primary hover:underline">
					Back to follow-up plan queue
				</Link>
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
