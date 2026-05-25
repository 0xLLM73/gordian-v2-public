import { ConnectionList } from '@/components/connections/connection-list';
import { EventFilter } from '@/components/connections/event-filter';
import { CreateIntroForm } from '@/components/introductions/create-intro-form';
import {
	IntroCardCollapsible,
	type IntroSourceEvidence,
} from '@/components/introductions/intro-card-collapsible';
import { IntroducerLeaderboard } from '@/components/introductions/introducer-leaderboard';
import { cn } from '@/lib/utils';
import { getUserWorkspaceId, getWorkspaceEnvelope, requireSession } from '@/lib/workspace';
import { getContactsByIds, getDistinctEvents, getMessagesByIds, listIntroductions } from '@repo/db';
import Link from 'next/link';
import { Suspense } from 'react';

type IntroStatusFilter = 'triage' | 'active' | 'archive' | 'all';

const INTRO_STATUS_FILTERS: Array<{ value: IntroStatusFilter; label: string }> = [
	{ value: 'triage', label: 'Needs review' },
	{ value: 'active', label: 'Active' },
	{ value: 'archive', label: 'Archived' },
	{ value: 'all', label: 'All' },
];

export default async function IntroductionsPage({
	searchParams,
}: {
	searchParams: Promise<{ event?: string; status?: string }>;
}) {
	const session = await requireSession();
	const workspaceId = await getUserWorkspaceId(session.user.id);
	const { event, status } = await searchParams;
	const introStatus = parseIntroStatusFilter(status);

	const envelope = workspaceId ? await getWorkspaceEnvelope(workspaceId) : null;
	const events = workspaceId && envelope ? await getDistinctEvents(workspaceId, envelope) : [];

	return (
		<div>
			<div className="mb-6">
				<h1 className="text-2xl font-bold text-foreground">Introductions</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					Review detected introductions, keep active relationships visible, and close out dismissed
					items.
				</p>
			</div>

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
				<div>
					<div className="mb-4 flex items-center justify-between">
						<h2 className="text-lg font-semibold text-foreground">Review queue</h2>
						{workspaceId ? <CreateIntroForm /> : null}
					</div>
					<IntroStatusTabs currentStatus={introStatus} event={event} />
					<Suspense fallback={<ListSkeleton />}>
						{workspaceId ? (
							<IntroductionsList workspaceId={workspaceId} status={introStatus} />
						) : (
							<EmptyState status={introStatus} />
						)}
					</Suspense>
					{workspaceId ? (
						<Suspense>
							<IntroducerLeaderboard workspaceId={workspaceId} />
						</Suspense>
					) : null}
				</div>

				<div>
					<div className="mb-4 flex items-center justify-between">
						<h2 className="text-lg font-semibold text-foreground">New Connections</h2>
						{workspaceId ? <EventFilter events={events} /> : null}
					</div>
					<Suspense fallback={<ListSkeleton />}>
						{workspaceId ? (
							<ConnectionList workspaceId={workspaceId} event={event} />
						) : (
							<ConnectionsEmptyState />
						)}
					</Suspense>
				</div>
			</div>
		</div>
	);
}

async function IntroductionsList({
	workspaceId,
	status,
}: {
	workspaceId: string;
	status: IntroStatusFilter;
}) {
	const { EditIntroButton } = await import('@/components/introductions/edit-intro-button');
	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) return <EmptyState status={status} />;
	const introductions = await listIntroductions(
		workspaceId,
		{ status: status === 'all' ? undefined : status, limit: 50 },
		envelope,
	);

	if (!introductions || introductions.length === 0) {
		return <EmptyState status={status} />;
	}

	const contactIds = new Set<string>();
	const sourceMessageIds = new Set<string>();
	for (const intro of introductions) {
		if (intro.introducerContactId) contactIds.add(intro.introducerContactId);
		if (intro.introducedContactId1) contactIds.add(intro.introducedContactId1);
		if (intro.introducedContactId2) contactIds.add(intro.introducedContactId2);
		for (const messageId of getIntroSourceMessageIds(intro)) {
			sourceMessageIds.add(messageId);
		}
	}

	const contactMap = new Map<string, string>();
	if (contactIds.size > 0) {
		const contacts = await getContactsByIds(workspaceId, [...contactIds], envelope);
		for (const c of contacts) {
			contactMap.set(
				c.id as string,
				[c.firstName as string, c.lastName as string].filter(Boolean).join(' ') || 'Unknown',
			);
		}
	}

	const sourceEvidenceById = new Map<string, IntroSourceEvidence>();
	let sourceEvidenceUnavailable = false;
	if (sourceMessageIds.size > 0) {
		try {
			const sourceMessages = await getMessagesByIds(workspaceId, [...sourceMessageIds], envelope);
			for (const message of sourceMessages) {
				const id = message.id as string;
				sourceEvidenceById.set(id, {
					id,
					contactId: (message.contactId as string | null) ?? null,
					text: (message.text as string | null) ?? null,
					isOutgoing: Boolean(message.isOutgoing),
					sentAt: toIsoString(message.sentAt),
				});
			}
		} catch (error) {
			sourceEvidenceUnavailable = true;
			console.warn('Unable to load introduction source message evidence', error);
		}
	}

	return (
		<div className="divide-y divide-border rounded-lg border border-border">
			{introductions.map((intro) => {
				const introSourceIds = getIntroSourceMessageIds(intro);
				return (
					<IntroductionCard
						key={intro.id}
						intro={intro}
						contactMap={contactMap}
						sourceMessageIds={introSourceIds}
						sourceEvidence={introSourceIds
							.map((id) => sourceEvidenceById.get(id))
							.filter((message): message is IntroSourceEvidence => Boolean(message))}
						sourceEvidenceUnavailable={sourceEvidenceUnavailable}
						EditIntroButton={EditIntroButton}
					/>
				);
			})}
		</div>
	);
}

function IntroductionCard({
	intro,
	contactMap,
	sourceMessageIds,
	sourceEvidence,
	sourceEvidenceUnavailable,
	EditIntroButton,
}: {
	intro: Record<string, unknown>;
	contactMap: Map<string, string>;
	sourceMessageIds: string[];
	sourceEvidence: IntroSourceEvidence[];
	sourceEvidenceUnavailable: boolean;
	EditIntroButton: React.ComponentType<{
		introductionId: string;
		initialContext: string;
		initialNote: string | null;
	}>;
}) {
	const context = intro.context as string;
	const status = intro.status as string;
	const confidence = Math.round((intro.confidence as number) * 100);
	const introducerId = intro.introducerContactId as string;
	const introduced1 = intro.introducedContactId1 as string;
	const introduced2 = intro.introducedContactId2 as string;
	const reasoning = intro.reasoning as string | null;
	const autoConfirmed = intro.autoConfirmed as boolean | null;

	const getName = (cid: string) => contactMap.get(cid) || `${cid?.slice(0, 8)}...`;

	return (
		<IntroCardCollapsible
			name={getName(introducerId)}
			introduced1Name={getName(introduced1)}
			introduced2Name={getName(introduced2)}
			introducerId={introducerId}
			introduced1={introduced1}
			introduced2={introduced2}
			confidence={confidence}
			context={context}
			status={status}
			autoConfirmed={autoConfirmed}
			reasoning={reasoning}
			note={(intro.note as string | null) ?? null}
			detectedAt={intro.detectedAt as string}
			introductionId={intro.id as string}
			sourceMessageIds={sourceMessageIds}
			sourceEvidence={sourceEvidence}
			sourceEvidenceUnavailable={sourceEvidenceUnavailable}
			EditIntroButton={EditIntroButton}
		/>
	);
}

function IntroStatusTabs({
	currentStatus,
	event,
}: {
	currentStatus: IntroStatusFilter;
	event?: string;
}) {
	return (
		<div className="mb-4 overflow-x-auto">
			<div className="inline-flex rounded-lg bg-muted p-1">
				{INTRO_STATUS_FILTERS.map((tab) => (
					<Link
						key={tab.value}
						href={buildIntroStatusHref(tab.value, event)}
						className={cn(
							'rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors',
							currentStatus === tab.value && 'bg-background text-foreground shadow-sm',
						)}
					>
						{tab.label}
					</Link>
				))}
			</div>
		</div>
	);
}

function EmptyState({ status = 'triage' }: { status?: IntroStatusFilter }) {
	const copy = getEmptyStateCopy(status);

	return (
		<div className="space-y-4">
			<div className="rounded-lg border border-border bg-card p-6 text-center">
				<h3 className="text-sm font-semibold text-foreground">{copy.title}</h3>
				<p className="mt-1 text-sm text-muted-foreground">{copy.description}</p>
			</div>

			<div className="divide-y divide-border rounded-lg border border-dashed border-muted-foreground/30 opacity-60">
				<div className="p-4">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<p className="text-sm font-medium text-foreground">
								Alice Chen introduced Bob Park to Carol Lee
							</p>
							<span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700">
								deal
							</span>
							<span className="rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-700">
								triage
							</span>
						</div>
						<span className="text-xs text-muted-foreground">87% confidence</span>
					</div>
				</div>
				<div className="p-4">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<p className="text-sm font-medium text-foreground">
								Dave Kim introduced Eva Ross to Frank Wu
							</p>
							<span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
								hiring
							</span>
							<span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">
								active
							</span>
						</div>
						<span className="text-xs text-muted-foreground">92% confidence</span>
					</div>
				</div>
			</div>

			<p className="text-center text-xs text-muted-foreground">
				Tip: Configure detection keywords in{' '}
				<Link href="/settings" className="font-medium text-primary hover:underline">
					Settings
				</Link>{' '}
				to improve accuracy.
			</p>
		</div>
	);
}

function parseIntroStatusFilter(status: string | undefined): IntroStatusFilter {
	if (status === 'active' || status === 'archive' || status === 'all') return status;
	return 'triage';
}

function buildIntroStatusHref(status: IntroStatusFilter, event: string | undefined): string {
	const params = new URLSearchParams();
	if (status !== 'triage') params.set('status', status);
	if (event) params.set('event', event);
	const query = params.toString();
	return query ? `/introductions?${query}` : '/introductions';
}

function getIntroSourceMessageIds(intro: Record<string, unknown>): string[] {
	const sourceMessageIds = intro.sourceMessageIds;
	if (!Array.isArray(sourceMessageIds)) return [];
	return sourceMessageIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
}

function toIsoString(value: unknown): string | null {
	if (!value) return null;
	const date = value instanceof Date ? value : new Date(value as string);
	if (Number.isNaN(date.getTime())) return null;
	return date.toISOString();
}

function getEmptyStateCopy(status: IntroStatusFilter): {
	title: string;
	description: string;
} {
	if (status === 'active') {
		return {
			title: 'No active introductions',
			description: 'Approved introductions will appear here after review.',
		};
	}
	if (status === 'archive') {
		return {
			title: 'No archived introductions',
			description: 'Dismissed or completed introductions will appear here.',
		};
	}
	if (status === 'all') {
		return {
			title: 'No introductions detected yet',
			description:
				'Gordian automatically detects introductions from your group chats, or you can record them manually.',
		};
	}
	return {
		title: 'No introductions need review',
		description:
			'Newly detected introductions will appear here before they become active relationship records.',
	};
}

function ConnectionsEmptyState() {
	return (
		<div className="rounded-lg border border-border bg-muted p-8 text-center">
			<p className="text-sm text-muted-foreground">
				No new connections detected yet. Gordian will automatically detect first-meeting signals
				from your conversations.
			</p>
		</div>
	);
}

function ListSkeleton() {
	return (
		<div className="divide-y divide-border rounded-lg border border-border">
			{[1, 2, 3].map((i) => (
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
