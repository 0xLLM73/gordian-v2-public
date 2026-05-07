import { ChatContextSetter } from '@/components/chat/chat-context-setter';
import { ContactTagEditor } from '@/components/contact-tag-editor';
import { ContactDetailShell } from '@/components/contacts/contact-detail-shell';
import { ContactSummaryPanel } from '@/components/contacts/contact-summary-panel';
import { DraftComposer } from '@/components/drafts/draft-composer';
import {
	DEAL_STAGE_COLORS,
	DECISION_ACTION_COLORS,
	GOAL_STATUS_COLORS,
	HEALTH_BADGE_COLORS,
	INTRO_CONTEXT_COLORS,
	KNOWLEDGE_TYPE_COLORS,
	OUTCOME_BADGE,
	TREND_STYLES,
} from '@/lib/colors';
import { formatCurrency, formatRelativeDate } from '@/lib/format';
import { getUserWorkspaceId, getWorkspaceEnvelope, requireSession } from '@/lib/workspace';
import {
	getCommitmentsByContact,
	getContact,
	getContactTag,
	getHealthScore,
	getInvestorProfile,
	getLatestSummary,
	getMemoriesByContact,
	getMessageCount,
	getMessagesByContact,
	listKnowledgeByContact,
	listOutcomes,
} from '@repo/db';
import type { InvestorProfile, KnowledgeNode, Outcome, OutcomeResult, OutcomeType } from '@repo/db';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
	const session = await requireSession();
	const workspaceId = await getUserWorkspaceId(session.user.id);
	const { id } = await params;

	if (!workspaceId) notFound();

	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) notFound();

	const contact = await getContact(workspaceId, id, envelope);
	if (!contact) notFound();

	const [
		commitments,
		summary,
		tagData,
		messageCount,
		knowledgeNodes,
		investorProfile,
		outcomes,
		healthScore,
		recentMessages,
	] = await Promise.all([
		getCommitmentsByContact(workspaceId, id, envelope, { limit: 50 }),
		getLatestSummary(workspaceId, id, envelope),
		getContactTag(workspaceId, id, envelope),
		getMessageCount(workspaceId, id),
		listKnowledgeByContact(id, workspaceId, envelope),
		getInvestorProfile(workspaceId, id),
		listOutcomes(workspaceId, id, envelope),
		getHealthScore(workspaceId, id),
		getMessagesByContact(workspaceId, id, envelope, { limit: 10 }),
	]);

	const summaryData = summary
		? {
				summary: (summary as Record<string, unknown>).summary as string | null,
				generatedAt: String((summary as Record<string, unknown>).generatedAt),
				messageCount: (summary as Record<string, unknown>).messageCount as number,
				styleVariant: (summary as Record<string, unknown>).styleVariant as string | null,
			}
		: null;

	const { ContactNotes } = await import('@/components/contact-notes');
	const { getDealsByContact } = await import('@repo/db');
	const { listGoals } = await import('@repo/db');

	const { getIntroductionsByContact, getContactsByIds, getConnectionsByContact } = await import(
		'@repo/db'
	);

	const [contactDeals, contactGoals, contactIntros, contactConnections] = await Promise.all([
		getDealsByContact(workspaceId, id, envelope),
		listGoals(workspaceId, { contactId: id, limit: 10 }, envelope),
		getIntroductionsByContact(workspaceId, id, 10, envelope),
		getConnectionsByContact(workspaceId, id, envelope),
	]);

	// Resolve contact names for introductions
	const introContactIds = new Set<string>();
	for (const intro of contactIntros) {
		if (intro.introducerContactId) introContactIds.add(intro.introducerContactId);
		if (intro.introducedContactId1) introContactIds.add(intro.introducedContactId1);
		if (intro.introducedContactId2) introContactIds.add(intro.introducedContactId2);
	}
	introContactIds.delete(id); // we already have this contact's name
	const introNameMap = new Map<string, string>();
	introNameMap.set(
		id,
		[contact.firstName as string, contact.lastName as string].filter(Boolean).join(' ') ||
			'Unknown',
	);
	if (introContactIds.size > 0) {
		const introContacts = await getContactsByIds(workspaceId, [...introContactIds], envelope);
		for (const c of introContacts) {
			introNameMap.set(
				c.id as string,
				[c.firstName as string, c.lastName as string].filter(Boolean).join(' ') || 'Unknown',
			);
		}
	}

	const overviewContent = (
		<div className="space-y-6">
			<ContactInfoCard contact={contact} />
			<ContactSummaryPanel contactId={id} initialSummary={summaryData} />
			<ContactDealsSection deals={contactDeals} />
			<ContactGoalsSection goals={contactGoals} />
			<ContactIntroductionsSection intros={contactIntros} nameMap={introNameMap} />
			<ContactConnectionsSection connections={contactConnections} />
			<RecentMessagesList messages={recentMessages} />
			<ContactNotes contactId={id} initialNotes={(contact.notes as string) ?? null} />
			<ContactTagEditor contactId={id} initialData={tagData} />
			<DraftComposer contactId={id} />
		</div>
	);

	const commitmentsContent = (
		<div className="space-y-6">
			<Suspense fallback={<SectionSkeleton />}>
				<CommitmentsList commitments={commitments} />
			</Suspense>
			<Suspense fallback={<SectionSkeleton />}>
				<MemoriesList workspaceId={workspaceId} contactId={id} />
			</Suspense>
		</div>
	);

	const knowledgeContent = <ContactKnowledgeList nodes={knowledgeNodes} />;
	const decisionsContent = (
		<Suspense fallback={<SectionSkeleton />}>
			<ContactDecisionsList contactId={id} />
		</Suspense>
	);
	const investorContent = <InvestorProfileTab profile={investorProfile} />;
	const historyContent = <OutcomeHistoryList outcomes={outcomes} />;

	const displayName =
		[contact.firstName as string, contact.lastName as string].filter(Boolean).join(' ') ||
		'Unknown';

	return (
		<div>
			<ChatContextSetter
				page="contacts/detail"
				contactId={id}
				contactName={displayName}
				contactSummary={summaryData?.summary ?? undefined}
			/>
			<div className="mb-6">
				<Link href="/contacts" className="text-sm text-muted-foreground hover:text-foreground">
					&larr; Back to contacts
				</Link>
			</div>

			<ContactHeader contact={contact} healthScore={healthScore} />

			<div className="mt-6">
				<ContactDetailShell
					contactId={id}
					overviewContent={overviewContent}
					commitmentsContent={commitmentsContent}
					knowledgeContent={knowledgeContent}
					decisionsContent={decisionsContent}
					investorContent={investorContent}
					historyContent={historyContent}
					messageBadge={messageCount}
					commitmentBadge={commitments.length}
				/>
			</div>
		</div>
	);
}

const TREND_ARROWS: Record<string, string> = {
	improving: ' \u2191',
	declining: ' \u2193',
	stable: '',
};

function ContactHeader({
	contact,
	healthScore,
}: { contact: Record<string, unknown>; healthScore: Record<string, unknown> | null }) {
	const firstName = (contact.firstName as string) || '';
	const lastName = (contact.lastName as string) || '';
	const displayName = [firstName, lastName].filter(Boolean).join(' ') || 'Unknown';
	const initials = (firstName || '?')[0].toUpperCase();
	const subtitle =
		(contact.phone as string) ||
		(contact.email as string) ||
		(contact.telegramId as string) ||
		'No contact info';

	const label = healthScore?.label as string | undefined;
	const trend = healthScore?.trend as string | undefined;
	const composite = healthScore?.composite as number | undefined;

	return (
		<div className="rounded-lg border border-border bg-card p-6">
			<div className="flex items-center gap-4">
				<div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 text-xl font-bold text-primary">
					{initials}
				</div>
				<div className="flex-1">
					<div className="flex items-center gap-3">
						<h1 className="text-2xl font-bold text-foreground">{displayName}</h1>
						{label ? (
							<span
								className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${HEALTH_BADGE_COLORS[label] || 'bg-muted text-muted-foreground'}`}
							>
								{label}
								{TREND_ARROWS[trend ?? ''] ?? ''}
							</span>
						) : null}
					</div>
					<p className="text-sm text-muted-foreground">
						{subtitle}
						{composite != null ? (
							<span className="ml-2 text-xs text-muted-foreground">
								Health: {Math.round(composite * 100)}%
							</span>
						) : null}
					</p>
				</div>
			</div>
		</div>
	);
}

function RecentMessagesList({ messages }: { messages: Record<string, unknown>[] }) {
	if (!messages || messages.length === 0) return null;

	return (
		<div className="rounded-lg border border-border bg-card p-4">
			<h3 className="mb-3 text-sm font-semibold text-foreground">Recent Messages</h3>
			<div className="space-y-2">
				{messages.map((m) => (
					<div key={m.id as string} className="flex gap-2 text-sm">
						<span
							className={`shrink-0 mt-0.5 h-2 w-2 rounded-full ${m.isOutgoing ? 'bg-blue-400' : 'bg-muted-foreground'}`}
						/>
						<div className="min-w-0 flex-1">
							<p className="text-foreground truncate">{(m.text as string) || '(no text)'}</p>
							<p className="text-xs text-muted-foreground">
								{m.sentAt ? formatRelativeDate(new Date(m.sentAt as string)) : ''}
							</p>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

function ContactInfoCard({ contact }: { contact: Record<string, unknown> }) {
	return (
		<div className="rounded-lg border border-border bg-card p-4">
			<h3 className="mb-3 text-sm font-semibold text-foreground">Contact Info</h3>
			<div className="grid grid-cols-2 gap-4">
				<InfoField label="Phone" value={contact.phone as string} />
				<InfoField label="Email" value={contact.email as string} />
				<InfoField label="Telegram ID" value={contact.telegramId as string} />
				<InfoField label="Notes" value={contact.notes as string} />
			</div>
		</div>
	);
}

function InfoField({ label, value }: { label: string; value: string | null | undefined }) {
	return (
		<div>
			<p className="text-xs font-medium text-muted-foreground">{label}</p>
			<p className="mt-0.5 text-sm text-foreground">{value || '-'}</p>
		</div>
	);
}

async function CommitmentsList({ commitments }: { commitments: Record<string, unknown>[] }) {
	if (!commitments || commitments.length === 0) {
		return (
			<div>
				<h3 className="mb-3 text-sm font-semibold text-foreground">Commitments</h3>
				<div className="rounded-lg border border-border bg-muted p-4 text-center text-sm text-muted-foreground">
					No commitments yet.
				</div>
			</div>
		);
	}

	const { CommitmentActions } = await import('@/components/commitment-actions');

	return (
		<div>
			<h3 className="mb-3 text-sm font-semibold text-foreground">Commitments</h3>
			<div className="space-y-2">
				{commitments.map((c) => {
					const showActions = c.status === 'active' || c.status === 'draft';
					return (
						<div key={c.id as string} className="rounded-lg border border-border bg-card p-3">
							<div className="flex items-center justify-between">
								<p className="text-sm font-medium text-foreground">{c.title as string}</p>
								<div className="flex items-center gap-2">
									{showActions ? (
										<CommitmentActions
											commitmentId={c.id as string}
											status={c.status as 'active' | 'draft'}
										/>
									) : null}
									<StatusBadge status={c.status as string} />
								</div>
							</div>
							{c.dueDate ? (
								<p className="mt-1 text-xs text-muted-foreground">
									Due: {new Date(c.dueDate as string).toLocaleDateString()}
								</p>
							) : null}
						</div>
					);
				})}
			</div>
		</div>
	);
}

async function MemoriesList({
	workspaceId,
	contactId,
}: { workspaceId: string; contactId: string }) {
	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) {
		return (
			<div>
				<h3 className="mb-3 text-sm font-semibold text-foreground">Memories</h3>
				<div className="rounded-lg border border-border bg-muted p-4 text-center text-sm text-muted-foreground">
					No memories recorded yet.
				</div>
			</div>
		);
	}
	const memories = await getMemoriesByContact(workspaceId, contactId, envelope, { limit: 10 });

	if (!memories || memories.length === 0) {
		return (
			<div>
				<h3 className="mb-3 text-sm font-semibold text-foreground">Memories</h3>
				<div className="rounded-lg border border-border bg-muted p-4 text-center text-sm text-muted-foreground">
					No memories recorded yet.
				</div>
			</div>
		);
	}

	return (
		<div>
			<h3 className="mb-3 text-sm font-semibold text-foreground">Memories</h3>
			<div className="space-y-2">
				{memories.map((m: Record<string, unknown>) => (
					<div key={m.id as string} className="rounded-lg border border-border bg-card p-3">
						<div className="flex items-center gap-2">
							<span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
								{m.category as string}
							</span>
						</div>
						<p className="mt-1 text-sm text-foreground">{m.content as string}</p>
					</div>
				))}
			</div>
		</div>
	);
}

function StatusBadge({ status }: { status: string }) {
	const colors: Record<string, string> = {
		active: 'bg-green-100 text-green-700',
		completed: 'bg-blue-100 text-blue-700',
		draft: 'bg-yellow-100 text-yellow-700',
		dismissed: 'bg-muted text-muted-foreground',
	};

	return (
		<span
			className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] || 'bg-muted text-muted-foreground'}`}
		>
			{status}
		</span>
	);
}

function SectionSkeleton() {
	return (
		<div className="space-y-2">
			{[1, 2, 3].map((i) => (
				<div key={i} className="animate-pulse rounded-lg border border-border bg-card p-3">
					<div className="h-4 w-48 rounded bg-muted" />
					<div className="mt-2 h-3 w-32 rounded bg-muted" />
				</div>
			))}
		</div>
	);
}

function MetricCard({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-lg border border-border bg-card p-4">
			<p className="text-xs font-medium text-muted-foreground">{label}</p>
			<p className="mt-1 text-xl font-bold text-foreground">{value}</p>
		</div>
	);
}

function InvestorProfileTab({ profile }: { profile: InvestorProfile | null }) {
	if (!profile) {
		return (
			<div className="rounded-lg border border-border bg-muted p-8 text-center text-sm text-muted-foreground">
				No investor profile yet — close deals to build one.
			</div>
		);
	}

	const trend = TREND_STYLES[profile.activityTrend] ?? TREND_STYLES.steady;
	const winRatePct = Math.round((profile.winRate ?? 0) * 100);
	// ticketMin / ticketMax stored as integer dollar values
	const ticketMin = profile.ticketMin != null ? formatCurrency(Number(profile.ticketMin)) : null;
	const ticketMax = profile.ticketMax != null ? formatCurrency(Number(profile.ticketMax)) : null;

	return (
		<div className="space-y-4">
			<div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
				<MetricCard label="Win Rate" value={`${winRatePct}%`} />
				<MetricCard label="Deals" value={String(profile.dealCount ?? 0)} />
				<MetricCard label="Avg Cycle" value={`${profile.avgCycleDays ?? 0}d`} />
				<div className="rounded-lg border border-border bg-card p-4">
					<p className="text-xs font-medium text-muted-foreground">Activity</p>
					<span
						className={`mt-1 inline-block rounded px-2 py-0.5 text-xs font-semibold ${trend.className}`}
					>
						{trend.label}
					</span>
				</div>
			</div>

			<div className="rounded-lg border border-border bg-card p-4">
				<dl className="space-y-3">
					{profile.preferredRole ? (
						<div>
							<dt className="text-xs font-medium text-muted-foreground">Preferred Role</dt>
							<dd className="mt-0.5 text-sm capitalize text-foreground">
								{profile.preferredRole.replace(/_/g, ' ')}
							</dd>
						</div>
					) : null}
					{ticketMin || ticketMax ? (
						<div>
							<dt className="text-xs font-medium text-muted-foreground">Ticket Range</dt>
							<dd className="mt-0.5 text-sm text-foreground">
								{ticketMin ?? '?'} – {ticketMax ?? '?'}
							</dd>
						</div>
					) : null}
					{profile.sectorFocus && profile.sectorFocus.length > 0 ? (
						<div>
							<dt className="text-xs font-medium text-muted-foreground">Sector Focus</dt>
							<dd className="mt-1.5 flex flex-wrap gap-1.5">
								{profile.sectorFocus.map((s) => (
									<span
										key={s}
										className="rounded bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700"
									>
										{s}
									</span>
								))}
							</dd>
						</div>
					) : null}
					{profile.tokenInterests && profile.tokenInterests.length > 0 ? (
						<div>
							<dt className="text-xs font-medium text-muted-foreground">Token Interests</dt>
							<dd className="mt-1.5 flex flex-wrap gap-1.5">
								{profile.tokenInterests.map((t) => (
									<span
										key={t}
										className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700"
									>
										{t}
									</span>
								))}
							</dd>
						</div>
					) : null}
				</dl>
			</div>
		</div>
	);
}

const OUTCOME_TYPE_LABELS: Record<OutcomeType, string> = {
	deal_closed: 'Deal',
	commitment_fulfilled: 'Commitment',
	commitment_missed: 'Commitment',
	goal_completed: 'Goal',
	intro_connected: 'Introduction',
	relationship_health: 'Health',
};

function OutcomeHistoryList({ outcomes }: { outcomes: Outcome[] }) {
	if (outcomes.length === 0) {
		return (
			<div className="rounded-lg border border-border bg-muted p-8 text-center text-sm text-muted-foreground">
				No outcome history yet.
			</div>
		);
	}

	return (
		<div className="space-y-2">
			{outcomes.map((outcome) => {
				const badge = OUTCOME_BADGE[outcome.type as OutcomeType]?.[
					outcome.result as OutcomeResult
				] ?? { label: outcome.type, className: 'bg-muted text-muted-foreground' };

				return (
					<div key={outcome.id} className="rounded-lg border border-border bg-card p-3">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								<span className={`rounded px-2 py-0.5 text-xs font-semibold ${badge.className}`}>
									{badge.label}
								</span>
								<span className="text-sm text-foreground">
									{OUTCOME_TYPE_LABELS[outcome.type as OutcomeType] ?? outcome.type}
								</span>
							</div>
							<time className="text-xs text-muted-foreground">
								{formatRelativeDate(outcome.occurredAt)}
							</time>
						</div>
						{outcome.contextLabels && outcome.contextLabels.length > 0 ? (
							<div className="mt-2 flex flex-wrap gap-1">
								{outcome.contextLabels.map((label) => (
									<span
										key={label}
										className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
									>
										{label}
									</span>
								))}
							</div>
						) : null}
					</div>
				);
			})}
		</div>
	);
}

function ContactDealsSection({ deals }: { deals: Record<string, unknown>[] }) {
	if (!deals || deals.length === 0) return null;

	return (
		<div className="rounded-lg border border-border bg-card p-4">
			<div className="mb-3 flex items-center justify-between">
				<h3 className="text-sm font-semibold text-foreground">Deals</h3>
				<Link href="/deals" className="text-xs text-primary hover:text-primary">
					View all
				</Link>
			</div>
			<div className="space-y-2">
				{deals.map((deal) => (
					<div
						key={deal.id as string}
						className="flex items-center justify-between rounded-md bg-muted px-3 py-2"
					>
						<div className="min-w-0 flex-1">
							<p className="truncate text-sm font-medium text-foreground">{deal.title as string}</p>
						</div>
						<div className="ml-3 flex items-center gap-2">
							<span className="text-xs font-medium text-muted-foreground">
								{formatCurrency(deal.value as number)}
							</span>
							<span
								className={`rounded-full px-2 py-0.5 text-xs font-medium ${DEAL_STAGE_COLORS[(deal.stage as string) || ''] || 'bg-muted text-muted-foreground'}`}
							>
								{deal.stage as string}
							</span>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

function ContactGoalsSection({ goals }: { goals: Record<string, unknown>[] }) {
	if (!goals || goals.length === 0) return null;

	return (
		<div className="rounded-lg border border-border bg-card p-4">
			<div className="mb-3 flex items-center justify-between">
				<h3 className="text-sm font-semibold text-foreground">Goals</h3>
				<Link href="/goals" className="text-xs text-primary hover:text-primary">
					View all
				</Link>
			</div>
			<div className="space-y-2">
				{goals.map((goal) => {
					const current = goal.currentCount as number;
					const target = goal.targetCount as number;
					const pct = target > 0 ? Math.min(Math.round((current / target) * 100), 100) : 0;
					return (
						<div key={goal.id as string} className="rounded-md bg-muted px-3 py-2">
							<div className="flex items-center justify-between">
								<p className="text-sm font-medium text-foreground">{goal.title as string}</p>
								<span
									className={`rounded-full px-2 py-0.5 text-xs font-medium ${GOAL_STATUS_COLORS[(goal.status as string) || ''] || 'bg-muted text-muted-foreground'}`}
								>
									{goal.status as string}
								</span>
							</div>
							<div className="mt-1 flex items-center gap-2">
								<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
									<div className="h-full rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
								</div>
								<span className="text-xs text-muted-foreground">
									{current}/{target}
								</span>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

function ContactIntroductionsSection({
	intros,
	nameMap,
}: {
	intros: Record<string, unknown>[];
	nameMap: Map<string, string>;
}) {
	if (!intros || intros.length === 0) return null;

	return (
		<div className="rounded-lg border border-border bg-card p-4">
			<div className="mb-3 flex items-center justify-between">
				<h3 className="text-sm font-semibold text-foreground">Introductions</h3>
				<Link href="/introductions" className="text-xs text-primary hover:text-primary">
					View all
				</Link>
			</div>
			<div className="space-y-2">
				{intros.map((intro) => {
					const introducerId = intro.introducerContactId as string;
					const p1 = intro.introducedContactId1 as string;
					const p2 = intro.introducedContactId2 as string;
					const context = intro.context as string;
					const getName = (cid: string) => nameMap.get(cid) || `${cid?.slice(0, 8)}...`;
					return (
						<div
							key={intro.id as string}
							className="flex items-center justify-between rounded-md bg-muted px-3 py-2"
						>
							<p className="text-sm text-foreground">
								<Link
									href={`/contacts/${introducerId}`}
									className="font-medium text-foreground hover:text-primary"
								>
									{getName(introducerId)}
								</Link>
								{' introduced '}
								<Link
									href={`/contacts/${p1}`}
									className="font-medium text-foreground hover:text-primary"
								>
									{getName(p1)}
								</Link>
								{' to '}
								<Link
									href={`/contacts/${p2}`}
									className="font-medium text-foreground hover:text-primary"
								>
									{getName(p2)}
								</Link>
							</p>
							<span
								className={`rounded-full px-2 py-0.5 text-xs font-medium ${INTRO_CONTEXT_COLORS[context] || INTRO_CONTEXT_COLORS.other}`}
							>
								{context}
							</span>
						</div>
					);
				})}
			</div>
		</div>
	);
}

const CONNECTION_STATUS_BADGE: Record<string, string> = {
	detected: 'bg-cyan-100 text-cyan-700',
	confirmed: 'bg-green-100 text-green-700',
	dismissed: 'bg-gray-100 text-gray-500',
};

function ContactConnectionsSection({ connections }: { connections: Record<string, unknown>[] }) {
	if (!connections || connections.length === 0) return null;

	return (
		<div className="rounded-lg border border-border bg-card p-4">
			<div className="mb-3 flex items-center justify-between">
				<h3 className="text-sm font-semibold text-foreground">New Connections</h3>
				<Link
					href="/introductions?tab=connections"
					className="text-xs text-primary hover:text-primary"
				>
					View all
				</Link>
			</div>
			<div className="space-y-2">
				{connections.map((conn) => {
					const event = conn.event as string | null;
					const context = conn.context as string | null;
					const status = conn.status as string;
					const confidence = Math.round((conn.confidence as number) * 100);
					return (
						<div
							key={conn.id as string}
							className="flex items-center justify-between rounded-md bg-muted px-3 py-2"
						>
							<div className="min-w-0 flex-1">
								<p className="text-sm font-medium text-foreground">
									First meeting{event ? ` at ${event}` : ''}
								</p>
								{context ? (
									<p className="truncate text-xs text-muted-foreground">{context}</p>
								) : null}
							</div>
							<div className="ml-3 flex items-center gap-2">
								<span className="text-xs text-muted-foreground">{confidence}%</span>
								{event ? (
									<span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
										{event}
									</span>
								) : null}
								<span
									className={`rounded-full px-2 py-0.5 text-xs font-medium ${CONNECTION_STATUS_BADGE[status] || CONNECTION_STATUS_BADGE.detected}`}
								>
									{status}
								</span>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

async function ContactDecisionsList({ contactId }: { contactId: string }) {
	const { getContactDecisionsAction } = await import('@/app/actions/knowledge');
	const result = await getContactDecisionsAction({ contactId });
	const decisions = result?.data ?? [];

	if (decisions.length === 0) {
		return (
			<div className="rounded-lg border border-border bg-muted p-8 text-center text-sm text-muted-foreground">
				No decisions recorded yet.
			</div>
		);
	}

	return (
		<div className="space-y-2">
			{decisions.map((decision) => {
				const actionLabel = decision.action ? decision.action.replace(/_/g, ' ') : 'Decision';

				return (
					<div key={decision.id} className="rounded-lg border border-border bg-card p-3">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								<span
									className={`rounded px-2 py-0.5 text-xs font-semibold capitalize ${DECISION_ACTION_COLORS[decision.action ?? ''] || 'bg-gray-100 text-gray-600'}`}
								>
									{actionLabel}
								</span>
								<span className="text-sm text-foreground">{decision.displayName}</span>
							</div>
							{decision.decidedAt ? (
								<time className="text-xs text-muted-foreground">
									{formatRelativeDate(new Date(decision.decidedAt))}
								</time>
							) : null}
						</div>
						{decision.rationales.length > 0 ? (
							<div className="mt-2 flex flex-wrap gap-1">
								{decision.rationales.map((rationale) => (
									<span
										key={rationale}
										className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
									>
										{rationale}
									</span>
								))}
							</div>
						) : null}
						{decision.entityId && decision.entityType ? (
							<div className="mt-1.5">
								<Link
									href={`/${decision.entityType === 'deal' ? 'deals' : decision.entityType === 'introduction' ? 'introductions' : 'goals'}/${decision.entityId}`}
									className="text-xs text-primary hover:text-primary"
								>
									View {decision.entityType} &rarr;
								</Link>
							</div>
						) : null}
					</div>
				);
			})}
		</div>
	);
}

function ContactKnowledgeList({ nodes }: { nodes: KnowledgeNode[] }) {
	if (nodes.length === 0) {
		return (
			<div className="rounded-lg border border-border bg-muted p-8 text-center text-sm text-muted-foreground">
				No knowledge nodes extracted yet. Sync messages to discover what this contact knows.
			</div>
		);
	}

	return (
		<div className="space-y-2">
			{nodes.map((node) => (
				<Link
					key={node.id}
					href={`/knowledge/${node.id}`}
					className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-accent"
				>
					<span
						className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${KNOWLEDGE_TYPE_COLORS[node.type] || 'bg-muted text-foreground'}`}
					>
						{node.type}
					</span>
					<div className="min-w-0 flex-1">
						<p className="truncate text-sm font-medium text-foreground">{node.displayName}</p>
						{node.description ? (
							<p className="truncate text-xs text-muted-foreground">{node.description}</p>
						) : null}
					</div>
					<span className="shrink-0 text-xs text-muted-foreground">
						{node.mentionCount ?? 0} mentions
					</span>
				</Link>
			))}
		</div>
	);
}
