import { ConnectionList } from '@/components/connections/connection-list';
import { EventFilter } from '@/components/connections/event-filter';
import { CreateIntroForm } from '@/components/introductions/create-intro-form';
import { IntroCardCollapsible } from '@/components/introductions/intro-card-collapsible';
import { IntroducerLeaderboard } from '@/components/introductions/introducer-leaderboard';
import { getUserWorkspaceId, getWorkspaceEnvelope, requireSession } from '@/lib/workspace';
import { getContactsByIds, getDistinctEvents, listIntroductions } from '@repo/db';
import Link from 'next/link';
import { Suspense } from 'react';

export default async function IntroductionsPage({
	searchParams,
}: {
	searchParams: Promise<{ event?: string }>;
}) {
	const session = await requireSession();
	const workspaceId = await getUserWorkspaceId(session.user.id);
	const { event } = await searchParams;

	const envelope = workspaceId ? await getWorkspaceEnvelope(workspaceId) : null;
	const events = workspaceId && envelope ? await getDistinctEvents(workspaceId, envelope) : [];

	return (
		<div>
			<h1 className="mb-6 text-2xl font-bold text-foreground">Network</h1>

			<div className="grid grid-cols-1 gap-6 md:grid-cols-2">
				<div>
					<div className="mb-4 flex items-center justify-between">
						<h2 className="text-lg font-semibold text-foreground">Introductions</h2>
						{workspaceId ? <CreateIntroForm /> : null}
					</div>
					<Suspense fallback={<ListSkeleton />}>
						{workspaceId ? <IntroductionsList workspaceId={workspaceId} /> : <EmptyState />}
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

async function IntroductionsList({ workspaceId }: { workspaceId: string }) {
	const { EditIntroButton } = await import('@/components/introductions/edit-intro-button');
	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) return <EmptyState />;
	const introductions = await listIntroductions(workspaceId, { limit: 50 }, envelope);

	if (!introductions || introductions.length === 0) {
		return <EmptyState />;
	}

	const contactIds = new Set<string>();
	for (const intro of introductions) {
		if (intro.introducerContactId) contactIds.add(intro.introducerContactId);
		if (intro.introducedContactId1) contactIds.add(intro.introducedContactId1);
		if (intro.introducedContactId2) contactIds.add(intro.introducedContactId2);
	}

	const contactMap = new Map<string, string>();
	if (contactIds.size > 0) {
		const envelope = await getWorkspaceEnvelope(workspaceId);
		if (envelope) {
			const contacts = await getContactsByIds(workspaceId, [...contactIds], envelope);
			for (const c of contacts) {
				contactMap.set(
					c.id as string,
					[c.firstName as string, c.lastName as string].filter(Boolean).join(' ') || 'Unknown',
				);
			}
		}
	}

	return (
		<div className="divide-y divide-border rounded-lg border border-border">
			{introductions.map((intro) => (
				<IntroductionCard
					key={intro.id}
					intro={intro}
					contactMap={contactMap}
					EditIntroButton={EditIntroButton}
				/>
			))}
		</div>
	);
}

function IntroductionCard({
	intro,
	contactMap,
	EditIntroButton,
}: {
	intro: Record<string, unknown>;
	contactMap: Map<string, string>;
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
			EditIntroButton={EditIntroButton}
		/>
	);
}

function EmptyState() {
	return (
		<div className="space-y-4">
			<div className="rounded-lg border border-border bg-card p-6 text-center">
				<h3 className="text-sm font-semibold text-foreground">No introductions detected yet</h3>
				<p className="mt-1 text-sm text-muted-foreground">
					Gordian automatically detects introductions from your group chats, or you can record them
					manually. Here&apos;s what they look like:
				</p>
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
