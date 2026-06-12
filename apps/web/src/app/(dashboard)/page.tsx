import type { ContactHealthFeedbackRow, UpcomingCommitment } from '@repo/db';
import {
	getActiveContactHealthFeedback,
	getCalibrationCompletionStatus,
	getCommitmentsByWorkspace,
	getContactsByIds,
	getDashboardStats,
	getHealthScoresByWorkspace,
	getLatestMessageTimestamp,
	getPendingDrafts,
	getUpcomingCommitments,
	listConnections,
	listDeals,
	listIntroductions,
	listKnowledgeNodes,
} from '@repo/db';
import Link from 'next/link';
import { Suspense } from 'react';
import { getLatestBriefAction } from '@/app/actions/brief';
import { MorningBriefCard, MorningBriefSkeleton } from '@/components/brief/morning-brief-card';
import { CommitmentActions } from '@/components/commitment-actions';
import { ContactHealthFeedbackActions } from '@/components/contact-health-feedback-actions';
import { ActNowViewTracker } from '@/components/dashboard/act-now-view-tracker';
import { NewIntelViewTracker } from '@/components/dashboard/new-intel-view-tracker';
import { SectionTimeWrapper } from '@/components/dashboard/section-time-wrapper';
import { TelegramImportManagerCard } from '@/components/dashboard/telegram-import-manager-card';
import { GhostingAlertSection } from '@/components/ghosting-alert-section';
import { SyncButton } from '@/components/sync-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DEAL_STAGE_BG_COLORS, HEALTH_BADGE_COLORS } from '@/lib/colors';
import { getContactInitial } from '@/lib/contact-initial';
import { formatCurrency, formatRelativeDate } from '@/lib/format';
import { ensureHealthScoringFreshness } from '@/lib/health-scoring';
import { isRuntimeEnvEnabled } from '@/lib/runtime-env';
import { isStoredSessionUnwrapOutsideImportsAllowed } from '@/lib/telegram-session-policy';
import { track } from '@/lib/track';
import { getUserWorkspaceId, getWorkspaceEnvelope, requireSession } from '@/lib/workspace';
import { StatsBar } from './stats-bar';

export default async function DashboardPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const session = await requireSession();
	const workspaceId = await getUserWorkspaceId(session.user.id);

	if (!workspaceId) return <NoWorkspaceBanner />;

	track(workspaceId, session.user.id, 'dashboard.visited');
	await ensureHealthScoringFreshness(workspaceId, { reason: 'dashboard_open' });

	const params = await searchParams;
	const showWelcome = params.welcome === '1';
	const telegramSyncEnabled = isRuntimeEnvEnabled('TELEGRAM_MTPROTO_ENABLED');
	const contactSyncEnabled = telegramSyncEnabled && isStoredSessionUnwrapOutsideImportsAllowed();

	return (
		<div>
			{showWelcome ? <WelcomeBanner /> : null}
			<div className="mb-6 flex items-center justify-between">
				<h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
				<div className="flex items-center gap-3">
					<Button variant="secondary" size="xs" asChild>
						<Link href="/deals?new=1">+ Deal</Link>
					</Button>
					<Button variant="secondary" size="xs" asChild>
						<Link href="/goals?new=1">+ Goal</Link>
					</Button>
					<Suspense fallback={null}>
						<LastSyncInfo workspaceId={workspaceId} />
					</Suspense>
					<SyncButton
						disabledReason={
							contactSyncEnabled
								? undefined
								: telegramSyncEnabled
									? 'Contact sync is disabled; use Telegram history import'
									: 'Telegram sync is disabled in this demo build'
						}
					/>
				</div>
			</div>

			<Suspense fallback={null}>
				<CalibrationBanner userId={session.user.id} workspaceId={workspaceId} />
			</Suspense>

			<TelegramImportManagerCard
				disabledReason={
					telegramSyncEnabled ? undefined : 'Telegram sync is disabled in this demo build'
				}
			/>

			{/* Collapsible summary bar — stat cards de-emphasized */}
			<Suspense fallback={<StatsSkeleton />}>
				<StatsBarSection workspaceId={workspaceId} />
			</Suspense>

			{/* ─── Act Now ─────────────────────────────────────────────── */}
			<SectionTimeWrapper section="act_now" className="mt-6">
				<h2 className="mb-4 text-lg font-semibold text-foreground">Act Now</h2>
				<div className="space-y-4">
					<Suspense fallback={<ActNowSkeleton />}>
						<ActNowDataSection workspaceId={workspaceId} />
					</Suspense>
				</div>
			</SectionTimeWrapper>

			{/* ─── Watch ───────────────────────────────────────────────── */}
			<SectionTimeWrapper section="watch" className="mt-8">
				<h2 className="mb-4 text-lg font-semibold text-foreground">Watch</h2>
				<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
					<Suspense fallback={<SectionSkeleton title="Contacts Cooling Off" />}>
						<DecayingHealthSection workspaceId={workspaceId} />
					</Suspense>
					<Suspense fallback={<SectionSkeleton title="Contacts Thriving" />}>
						<ThrivingHealthSection workspaceId={workspaceId} />
					</Suspense>
					<Suspense fallback={<SectionSkeleton title="Deals Going Quiet" />}>
						<QuietDealsSection workspaceId={workspaceId} />
					</Suspense>
					<Suspense fallback={<SectionSkeleton title="Approaching Deadlines" />}>
						<ApproachingDeadlinesSection workspaceId={workspaceId} />
					</Suspense>
					<Suspense fallback={<SectionSkeleton title="Ghosting Alerts" />}>
						<GhostingAlertSection workspaceId={workspaceId} userId={session.user.id} />
					</Suspense>
				</div>
			</SectionTimeWrapper>

			{/* ─── New Intel ───────────────────────────────────────────── */}
			<SectionTimeWrapper section="new_intel" className="mt-8">
				<h2 className="mb-4 text-lg font-semibold text-foreground">New Intel</h2>
				<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
					<Suspense fallback={<SectionSkeleton title="New Contacts" />}>
						<NewContactsSection workspaceId={workspaceId} />
					</Suspense>
					<Suspense fallback={<SectionSkeleton title="Trending Topics" />}>
						<TrendingTopicsSection workspaceId={workspaceId} />
					</Suspense>
					<Suspense fallback={<SectionSkeleton title="Introductions" />}>
						<IntroOpportunitiesSection workspaceId={workspaceId} />
					</Suspense>
					<Suspense fallback={<MorningBriefSkeleton />}>
						<MorningBriefSection />
					</Suspense>
				</div>
				{/* Fire view event once counts are available */}
				<Suspense fallback={null}>
					<NewIntelCountFetcher workspaceId={workspaceId} />
				</Suspense>
			</SectionTimeWrapper>
		</div>
	);
}

/* ─── Helper: today's date boundaries ─────────────────────────────────────── */

function todayRange() {
	const now = new Date();
	const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
	return { startOfDay, endOfDay };
}

/* ─── Top-level data helpers ──────────────────────────────────────────────── */

async function LastSyncInfo({ workspaceId }: { workspaceId: string }) {
	const lastMessageTime = await getLatestMessageTimestamp(workspaceId);
	if (!lastMessageTime) return null;

	return (
		<span className="text-xs text-muted-foreground">
			Last synced {formatRelativeDate(lastMessageTime)}
		</span>
	);
}

async function CalibrationBanner({ userId, workspaceId }: { userId: string; workspaceId: string }) {
	const calibration = await getCalibrationCompletionStatus(userId, workspaceId);
	if (calibration?.completedAt) return null;

	return (
		<div className="mb-6 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-4">
			<div>
				<p className="font-medium text-amber-900">
					Calibrate Gordian for better AI recommendations
				</p>
				<p className="text-sm text-amber-700">
					Takes 2 minutes. Personalises summaries, drafts, and briefs to your style.
				</p>
			</div>
			<Button asChild className="ml-4 shrink-0 bg-amber-600 hover:bg-amber-700">
				<Link href="/calibration">Get Started</Link>
			</Button>
		</div>
	);
}

async function StatsBarSection({ workspaceId }: { workspaceId: string }) {
	const stats = await getDashboardStats(workspaceId);
	return <StatsBar stats={stats} />;
}

async function MorningBriefSection() {
	const result = await getLatestBriefAction({});
	const brief = result?.data ?? null;
	return <MorningBriefCard brief={brief} />;
}

/* ─── ACT NOW — Consolidated data section ─────────────────────────────────── */

async function ActNowDataSection({ workspaceId }: { workspaceId: string }) {
	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) return null;

	const [commitments, drafts, draftCommitments] = await Promise.all([
		getUpcomingCommitments(workspaceId, envelope, { limit: 50 }),
		getPendingDrafts(workspaceId, envelope, { limit: 5 }),
		getCommitmentsByWorkspace(workspaceId, envelope, { status: 'draft', limit: 5 }),
	]);

	const overdue = commitments.filter((c) => c.isOverdue);
	const { startOfDay, endOfDay } = todayRange();
	const dueToday = commitments.filter(
		(c) => c.dueDate && c.dueDate >= startOfDay && c.dueDate < endOfDay,
	);

	// Resolve contact names for drafts
	const draftContactIds = [...new Set(drafts.map((d) => d.contactId))];
	const draftContacts =
		draftContactIds.length > 0
			? await getContactsByIds(workspaceId, draftContactIds, envelope)
			: [];
	const contactMap = new Map(draftContacts.map((c) => [c.id, c]));

	const ARM_LABELS: Record<string, string> = {
		casual_nudge: 'Casual',
		professional_value: 'Professional',
		direct_ask: 'Direct',
		soft_memory: 'Memory',
	};

	return (
		<>
			<ActNowViewTracker
				overdueCount={overdue.length}
				pendingDraftCount={drafts.length + draftCommitments.length}
				followUpCount={dueToday.length}
			/>

			{/* Overdue Commitments */}
			{commitments.length === 0 ? (
				<Card className="shadow-stripe-sm">
					<CardContent className="p-4">
						<p className="text-sm text-muted-foreground">
							No commitments yet. Demo data or synced messages will populate this section.
						</p>
					</CardContent>
				</Card>
			) : overdue.length === 0 ? (
				<Card className="border-green-200 bg-green-50/50 shadow-stripe-sm">
					<CardContent className="p-4">
						<p className="text-sm text-green-800">No overdue commitments. You're on track.</p>
					</CardContent>
				</Card>
			) : (
				<Card className="border-red-200 shadow-stripe-sm">
					<CardHeader className="pb-2">
						<CardTitle className="text-base text-red-700">
							Overdue Commitments ({overdue.length})
						</CardTitle>
					</CardHeader>
					<CardContent>
						<ul className="divide-y divide-border">
							{overdue.slice(0, 5).map((item) => (
								<CommitmentRow key={item.id} item={item} trackingItemType="overdue" />
							))}
						</ul>
						{overdue.length > 5 ? (
							<Link
								href="/commitments"
								className="mt-2 block text-xs font-medium text-indigo-600 hover:underline"
							>
								View all {overdue.length} overdue &rarr;
							</Link>
						) : null}
					</CardContent>
				</Card>
			)}

			{/* Suggested Commitments */}
			{draftCommitments.length > 0 ? (
				<Card className="border-blue-200 shadow-stripe-sm">
					<CardHeader className="pb-2">
						<CardTitle className="text-base text-blue-700">
							Suggested Commitments ({draftCommitments.length})
						</CardTitle>
					</CardHeader>
					<CardContent>
						<ul className="divide-y divide-border">
							{draftCommitments.map((item) => {
								const contactName =
									[item.contactFirstName, item.contactLastName].filter(Boolean).join(' ') ||
									'Unknown';

								return (
									<li key={item.id} className="flex items-center justify-between py-3">
										<div className="min-w-0 flex-1">
											<p className="truncate text-sm font-medium text-foreground">{item.title}</p>
											<p className="text-xs text-muted-foreground">
												{contactName} &middot; {Math.round(item.confidence * 100)}% confidence
											</p>
										</div>
										<div className="ml-4 flex items-center gap-2">
											<CommitmentActions commitmentId={item.id} status="draft" />
										</div>
									</li>
								);
							})}
						</ul>
						<Link
							href="/commitments?status=draft"
							className="mt-2 block text-xs font-medium text-indigo-600 hover:underline"
						>
							Review all suggestions &rarr;
						</Link>
					</CardContent>
				</Card>
			) : null}

			{/* Pending Drafts */}
			{drafts.length > 0 ? (
				<Card className="border-blue-200 shadow-stripe-sm">
					<CardHeader className="pb-2">
						<CardTitle className="text-base text-blue-700">
							Pending Drafts ({drafts.length})
						</CardTitle>
					</CardHeader>
					<CardContent>
						<ul className="divide-y divide-border">
							{drafts.map((draft) => {
								const contact = contactMap.get(draft.contactId);
								const firstName = (contact?.firstName as string) || '';
								const lastName = (contact?.lastName as string) || '';
								const name = [firstName, lastName].filter(Boolean).join(' ') || 'Unknown';
								const preview = String(draft.generatedText).slice(0, 100);

								return (
									<li key={draft.id} className="flex items-center justify-between py-3">
										<div className="min-w-0 flex-1">
											<div className="flex items-center gap-2">
												<Link
													href={`/contacts/${draft.contactId}`}
													className="text-sm font-medium text-foreground hover:text-indigo-600"
												>
													{name}
												</Link>
												<span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700">
													{ARM_LABELS[draft.armType] || draft.armType}
												</span>
											</div>
											<p className="mt-0.5 truncate text-xs text-muted-foreground">{preview}...</p>
										</div>
										<Button variant="secondary" size="xs" asChild className="ml-4">
											<Link href={`/contacts/${draft.contactId}`}>Review</Link>
										</Button>
									</li>
								);
							})}
						</ul>
					</CardContent>
				</Card>
			) : null}

			{/* Follow-ups Due Today */}
			{dueToday.length > 0 ? (
				<Card className="border-amber-200 shadow-stripe-sm">
					<CardHeader className="pb-2">
						<CardTitle className="text-base text-amber-700">
							Due Today ({dueToday.length})
						</CardTitle>
					</CardHeader>
					<CardContent>
						<ul className="divide-y divide-border">
							{dueToday.slice(0, 5).map((item) => (
								<CommitmentRow key={item.id} item={item} trackingItemType="follow_up" />
							))}
						</ul>
					</CardContent>
				</Card>
			) : null}
		</>
	);
}

/* ─── NEW INTEL — Count fetcher for view tracking ─────────────────────────── */

async function NewIntelCountFetcher({ workspaceId }: { workspaceId: string }) {
	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) return null;

	const [connections, nodes, intros] = await Promise.all([
		listConnections(workspaceId, { status: 'detected', limit: 5 }, envelope),
		listKnowledgeNodes(workspaceId, { limit: 5 }, envelope),
		listIntroductions(workspaceId, { status: 'triage', limit: 5 }, envelope),
	]);

	return (
		<NewIntelViewTracker
			newContactCount={connections.length}
			trendingTopicCount={nodes.length}
			introCount={intros.length}
		/>
	);
}

/* ─── WATCH SECTIONS ──────────────────────────────────────────────────────── */

type DashboardHealthScore = Awaited<ReturnType<typeof getHealthScoresByWorkspace>>[number];

type HealthComputationData = {
	aiSignals?: {
		directAsk?: {
			confidence?: number;
			userOwesReply?: boolean;
		};
	};
	attention?: {
		score?: number;
	};
	cadence?: {
		currentGapDays?: number | null;
		expectedGapRange?: string;
		sessionCount?: number;
	};
	confidence?: {
		label?: string;
		score?: number;
	};
	statusReason?: {
		code?: string;
		plainLanguage?: string;
		suggestedAction?: string;
	};
	version?: number;
};

const COOLING_ATTENTION_CODES = new Set([
	'frequency_drop',
	'gap_longer_than_usual',
	'mutual_gap',
	'one_sided_initiation',
]);

const RECENT_NEEDS_REPLY_MAX_DAYS = 30;
const MAX_ACTIONABLE_COOLING_GAP_DAYS = 90;
const MIN_ESTABLISHED_CADENCE_SESSIONS = 5;

const SUPPRESSED_HEALTH_FEEDBACK_ACTIONS = new Set([
	'snooze',
	'mark_low_touch',
	'handled_elsewhere',
	'not_important',
	'dismiss_wrong',
]);

function getHealthComputationData(score: DashboardHealthScore): HealthComputationData {
	const data = score.computationData;
	if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
	return data as HealthComputationData;
}

function humanizeHealthLabel(label: string): string {
	return label
		.split('_')
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

function getHealthAttentionScore(score: DashboardHealthScore): number {
	const attention = Number(getHealthComputationData(score).attention?.score);
	if (Number.isFinite(attention)) return attention;
	return score.label === 'cooling' || score.label === 'dormant' ? 1 - score.composite : 0;
}

function isCoolingAttentionScore(score: DashboardHealthScore): boolean {
	const data = getHealthComputationData(score);
	const reasonCode = data.statusReason?.code;
	if (reasonCode === 'learning' || reasonCode === 'steady_low_touch') return false;
	const confidenceLabel = data.confidence?.label;
	const confidenceScore = Number(data.confidence?.score);
	const currentGapDays = Number(data.cadence?.currentGapDays);
	const sessionCount = Number(data.cadence?.sessionCount);
	const isLowConfidence =
		confidenceLabel === 'low' || (Number.isFinite(confidenceScore) && confidenceScore < 0.45);
	const hasEstablishedCadence =
		Number.isFinite(sessionCount) && sessionCount >= MIN_ESTABLISHED_CADENCE_SESSIONS;

	if (reasonCode === 'needs_reply') {
		const localAskConfidence = Number(data.aiSignals?.directAsk?.confidence);
		const localAskDetected =
			data.aiSignals?.directAsk?.userOwesReply === true &&
			Number.isFinite(localAskConfidence) &&
			localAskConfidence >= 0.7;
		return (
			Number.isFinite(currentGapDays) &&
			currentGapDays <= RECENT_NEEDS_REPLY_MAX_DAYS &&
			(!isLowConfidence || localAskDetected)
		);
	}

	if (reasonCode && COOLING_ATTENTION_CODES.has(reasonCode)) {
		return (
			hasEstablishedCadence &&
			!isLowConfidence &&
			Number.isFinite(currentGapDays) &&
			currentGapDays <= MAX_ACTIONABLE_COOLING_GAP_DAYS
		);
	}
	if (reasonCode) return false;
	return score.label === 'cooling';
}

function compareCoolingAttention(a: DashboardHealthScore, b: DashboardHealthScore): number {
	const attentionDelta = getHealthAttentionScore(b) - getHealthAttentionScore(a);
	if (attentionDelta !== 0) return attentionDelta;
	return a.composite - b.composite;
}

function getLatestFeedbackByContact(rows: ContactHealthFeedbackRow[]) {
	const map = new Map<string, ContactHealthFeedbackRow>();
	for (const row of rows) {
		if (!map.has(row.contactId)) map.set(row.contactId, row);
	}
	return map;
}

function isSuppressedByFeedback(feedback: ContactHealthFeedbackRow | undefined): boolean {
	return feedback ? SUPPRESSED_HEALTH_FEEDBACK_ACTIONS.has(feedback.action) : false;
}

function getHealthReasonText(score: DashboardHealthScore): string {
	const reason = getHealthComputationData(score).statusReason?.plainLanguage;
	if (reason) return reason;
	if (score.label === 'thriving') return 'Communication looks consistent with this relationship.';
	if (score.label === 'healthy') return 'No immediate relationship-health concern detected.';
	if (score.label === 'cooling') return 'Communication appears to be slowing.';
	if (score.label === 'dormant') return 'No recent relationship activity is recorded.';
	return 'Gordian is still learning this relationship cadence.';
}

function getHealthMetaText(score: DashboardHealthScore): string {
	const data = getHealthComputationData(score);
	const parts: string[] = [];
	if (data.confidence?.label) parts.push(`${data.confidence.label} confidence`);
	if (data.cadence?.currentGapDays != null && data.cadence.expectedGapRange) {
		parts.push(
			`${Math.round(data.cadence.currentGapDays)}d gap vs ${data.cadence.expectedGapRange}d usual`,
		);
	} else if (data.cadence?.sessionCount) {
		parts.push(`${data.cadence.sessionCount} interaction days`);
	}
	return parts.join(' · ');
}

async function DecayingHealthSection({ workspaceId }: { workspaceId: string }) {
	const healthScores = await getHealthScoresByWorkspace(workspaceId, {
		label: 'cooling',
		sort: 'composite_asc',
		limit: 500,
	});
	const activeFeedback = await getActiveContactHealthFeedback(
		workspaceId,
		healthScores.map((score) => score.contactId),
	);
	const feedbackMap = getLatestFeedbackByContact(activeFeedback);
	const needsAttention = healthScores
		.filter((score) => !isSuppressedByFeedback(feedbackMap.get(score.contactId)))
		.filter(isCoolingAttentionScore)
		.sort(compareCoolingAttention)
		.slice(0, 5);

	if (needsAttention.length === 0) {
		const hasHealthScores =
			healthScores.length > 0 ||
			(await getHealthScoresByWorkspace(workspaceId, { limit: 1 })).length > 0;
		return (
			<ContactHealthScoreCard
				avatarClassName="bg-orange-100 text-orange-700"
				emptyText={
					hasHealthScores
						? 'No recent cadence breaks right now.'
						: 'No relationship health data yet.'
				}
				scores={needsAttention}
				showFeedbackActions
				title="Contacts Cooling Off"
				workspaceId={workspaceId}
			/>
		);
	}

	return (
		<ContactHealthScoreCard
			avatarClassName="bg-orange-100 text-orange-700"
			emptyText="No recent cadence breaks right now."
			scores={needsAttention}
			showFeedbackActions
			title="Contacts Cooling Off"
			workspaceId={workspaceId}
		/>
	);
}

async function ThrivingHealthSection({ workspaceId }: { workspaceId: string }) {
	const thriving = await getHealthScoresByWorkspace(workspaceId, {
		label: 'thriving',
		sort: 'composite_desc',
		limit: 5,
	});

	if (thriving.length === 0) {
		const hasHealthScores =
			(await getHealthScoresByWorkspace(workspaceId, { limit: 1 })).length > 0;

		return (
			<ContactHealthScoreCard
				avatarClassName="bg-emerald-100 text-emerald-700"
				emptyText={
					hasHealthScores ? 'No thriving contacts yet.' : 'No relationship health data yet.'
				}
				scores={thriving}
				title="Contacts Thriving"
				workspaceId={workspaceId}
			/>
		);
	}

	return (
		<ContactHealthScoreCard
			avatarClassName="bg-emerald-100 text-emerald-700"
			emptyText="No thriving contacts yet."
			scores={thriving}
			title="Contacts Thriving"
			workspaceId={workspaceId}
		/>
	);
}

async function ContactHealthScoreCard({
	avatarClassName,
	emptyText,
	scores,
	showFeedbackActions = false,
	title,
	workspaceId,
}: {
	avatarClassName: string;
	emptyText: string;
	scores: DashboardHealthScore[];
	showFeedbackActions?: boolean;
	title: string;
	workspaceId: string;
}) {
	if (scores.length === 0) {
		return (
			<Card className="shadow-stripe-sm">
				<CardHeader className="pb-2">
					<CardTitle className="text-base">{title}</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">{emptyText}</p>
				</CardContent>
			</Card>
		);
	}

	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) return null;

	const contactIds = scores.map((s) => s.contactId);
	const contactRows = await getContactsByIds(workspaceId, contactIds, envelope);
	const contactMap = new Map(contactRows.map((c) => [c.id, c]));

	return (
		<Card className="shadow-stripe-sm">
			<CardHeader className="pb-2">
				<CardTitle className="text-base">{title}</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="space-y-2">
					{scores.map((score) => {
						const contact = contactMap.get(score.contactId);
						if (!contact) return null;
						const firstName = (contact.firstName as string) || '';
						const lastName = (contact.lastName as string) || '';
						const name = [firstName, lastName].filter(Boolean).join(' ') || 'Unknown';
						const pct = Math.round(score.composite * 100);
						const badgeColor = HEALTH_BADGE_COLORS[score.label] || 'bg-muted text-muted-foreground';
						const reason = getHealthReasonText(score);
						const meta = getHealthMetaText(score);
						const statusReasonCode = getHealthComputationData(score).statusReason?.code;

						return (
							<div key={score.contactId} className="rounded-md bg-accent/50 px-3 py-3">
								<div className="flex items-start justify-between gap-3">
									<div className="min-w-0 flex-1">
										<div className="flex flex-wrap items-center gap-2">
											<div
												className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatarClassName}`}
											>
												{getContactInitial(firstName, lastName)}
											</div>
											<span className="min-w-0 text-sm font-medium text-foreground">{name}</span>
											<span
												className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeColor}`}
											>
												{humanizeHealthLabel(score.label)}
											</span>
										</div>
										<p className="mt-1 text-xs leading-5 text-muted-foreground">{reason}</p>
										{meta ? (
											<p className="mt-0.5 text-xs text-muted-foreground/80">{meta}</p>
										) : null}
										{showFeedbackActions ? (
											<div className="mt-2">
												<ContactHealthFeedbackActions
													contactId={score.contactId}
													statusReasonCode={statusReasonCode}
												/>
											</div>
										) : null}
									</div>
									<div className="shrink-0 text-right">
										<span className="block text-xs font-semibold text-foreground">{pct}%</span>
										<Link
											href={`/contacts/${score.contactId}`}
											className="text-xs font-medium text-indigo-600 hover:underline"
										>
											Review
										</Link>
									</div>
								</div>
							</div>
						);
					})}
				</div>
			</CardContent>
		</Card>
	);
}

async function QuietDealsSection({ workspaceId }: { workspaceId: string }) {
	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) return null;

	const allDeals = await listDeals(workspaceId, envelope, { limit: 50 });
	const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

	const quietDeals = allDeals
		.filter(
			(d) =>
				d.stage !== 'won' &&
				d.stage !== 'lost' &&
				d.updatedAt &&
				new Date(d.updatedAt) < sevenDaysAgo,
		)
		.slice(0, 5);

	if (quietDeals.length === 0) {
		return (
			<Card className="shadow-stripe-sm">
				<CardHeader className="pb-2">
					<CardTitle className="text-base">Deals Going Quiet</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">
						{allDeals.length === 0 ? 'No deals yet.' : 'All deals are active.'}
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className="shadow-stripe-sm">
			<CardHeader className="pb-2">
				<CardTitle className="text-base">Deals Going Quiet</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="space-y-2">
					{quietDeals.map((deal) => {
						const contactName =
							[deal.contactFirstName, deal.contactLastName].filter(Boolean).join(' ') || 'Unknown';
						const stageColor = DEAL_STAGE_BG_COLORS[deal.stage] || 'bg-muted';

						return (
							<Link
								key={deal.id}
								href={`/deals/${deal.id}`}
								className="flex items-center justify-between rounded-md bg-accent/50 px-3 py-2 hover:bg-accent"
							>
								<div className="min-w-0 flex-1">
									<p className="truncate text-sm font-medium text-foreground">
										{String(deal.title)}
									</p>
									<p className="text-xs text-muted-foreground">
										{contactName} &middot;{' '}
										{deal.updatedAt ? formatRelativeDate(deal.updatedAt) : 'no activity'}
									</p>
								</div>
								<div className="ml-3 flex items-center gap-2">
									<span className="text-xs font-medium text-muted-foreground">
										{formatCurrency(deal.value)}
									</span>
									<span className={`h-2 w-2 rounded-full ${stageColor}`} title={deal.stage} />
								</div>
							</Link>
						);
					})}
				</div>
			</CardContent>
		</Card>
	);
}

async function ApproachingDeadlinesSection({ workspaceId }: { workspaceId: string }) {
	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) return null;

	const all = await getUpcomingCommitments(workspaceId, envelope, { limit: 50 });
	const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
	const now = new Date();

	const approaching = all.filter(
		(c) => !c.isOverdue && c.dueDate && c.dueDate > now && c.dueDate <= threeDaysFromNow,
	);

	if (approaching.length === 0) {
		return (
			<Card className="shadow-stripe-sm">
				<CardHeader className="pb-2">
					<CardTitle className="text-base">Approaching Deadlines</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">No commitments due within 3 days.</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className="shadow-stripe-sm">
			<CardHeader className="pb-2">
				<CardTitle className="text-base">Approaching Deadlines ({approaching.length})</CardTitle>
			</CardHeader>
			<CardContent>
				<ul className="divide-y divide-border">
					{approaching.slice(0, 5).map((item) => (
						<CommitmentRow key={item.id} item={item} />
					))}
				</ul>
			</CardContent>
		</Card>
	);
}

/* ─── NEW INTEL SECTIONS ──────────────────────────────────────────────────── */

async function NewContactsSection({ workspaceId }: { workspaceId: string }) {
	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) return null;

	const rawConnections = await listConnections(
		workspaceId,
		{ status: 'detected', limit: 5 },
		envelope,
	);

	if (rawConnections.length === 0) {
		return (
			<Card className="shadow-stripe-sm">
				<CardHeader className="pb-2">
					<CardTitle className="text-base">New Contacts</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">No new contacts detected.</p>
				</CardContent>
			</Card>
		);
	}

	// Resolve contact names
	const contactIds = [...new Set(rawConnections.map((c) => c.contactId))];
	const contactRows = await getContactsByIds(workspaceId, contactIds, envelope);
	const contactMap = new Map(contactRows.map((c) => [c.id, c]));

	return (
		<Card className="shadow-stripe-sm">
			<CardHeader className="pb-2">
				<CardTitle className="text-base">New Contacts ({rawConnections.length})</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="space-y-2">
					{rawConnections.map((conn) => {
						const contact = contactMap.get(conn.contactId);
						const firstName = (contact?.firstName as string) || '';
						const lastName = (contact?.lastName as string) || '';
						const name = [firstName, lastName].filter(Boolean).join(' ') || 'Unknown contact';

						return (
							<div
								key={conn.id}
								className="flex items-center justify-between rounded-md bg-accent/50 px-3 py-2"
							>
								<div>
									<p className="text-sm font-medium text-foreground">{name}</p>
									{conn.event ? (
										<p className="text-xs text-muted-foreground">{String(conn.event)}</p>
									) : null}
								</div>
								<Link
									href="/introductions?tab=connections"
									className="text-xs font-medium text-indigo-600 hover:underline"
								>
									Review
								</Link>
							</div>
						);
					})}
				</div>
			</CardContent>
		</Card>
	);
}

async function TrendingTopicsSection({ workspaceId }: { workspaceId: string }) {
	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) return null;

	const nodes = await listKnowledgeNodes(workspaceId, { limit: 5 }, envelope);

	if (nodes.length === 0) {
		return (
			<Card className="shadow-stripe-sm">
				<CardHeader className="pb-2">
					<CardTitle className="text-base">Trending Topics</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">
						No knowledge topics yet. Topics emerge as messages are processed.
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className="shadow-stripe-sm">
			<CardHeader className="pb-2">
				<CardTitle className="text-base">Trending Topics</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="space-y-2">
					{nodes.map((node) => (
						<Link
							key={node.id}
							href={`/knowledge/${node.id}`}
							className="flex items-center justify-between rounded-md bg-accent/50 px-3 py-2 hover:bg-accent"
						>
							<div className="flex items-center gap-2">
								<span className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-700">
									{node.type}
								</span>
								<span className="text-sm font-medium text-foreground">
									{String(node.displayName ?? node.name)}
								</span>
							</div>
							<span className="text-xs text-muted-foreground">
								{node.mentionCount ?? 0} mentions
							</span>
						</Link>
					))}
				</div>
			</CardContent>
		</Card>
	);
}

const INTRO_CONTEXT_LABELS: Record<string, string> = {
	deal: 'Deal',
	hiring: 'Hiring',
	knowledge: 'Knowledge',
	social: 'Social',
	other: 'Other',
};

async function IntroOpportunitiesSection({ workspaceId }: { workspaceId: string }) {
	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) return null;

	const intros = await listIntroductions(workspaceId, { status: 'triage', limit: 5 }, envelope);

	if (intros.length === 0) {
		return (
			<Card className="shadow-stripe-sm">
				<CardHeader className="pb-2">
					<CardTitle className="text-base">Introduction Opportunities</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">
						No introduction opportunities detected yet.
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className="shadow-stripe-sm">
			<CardHeader className="pb-2">
				<CardTitle className="text-base">Introduction Opportunities ({intros.length})</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="space-y-2">
					{intros.map((intro) => (
						<Link
							key={intro.id}
							href="/introductions"
							className="flex items-center justify-between rounded-md bg-accent/50 px-3 py-2 hover:bg-accent"
						>
							<div>
								<div className="flex items-center gap-2">
									<span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-700">
										{INTRO_CONTEXT_LABELS[intro.context] || intro.context}
									</span>
								</div>
								{intro.note ? (
									<p className="mt-0.5 truncate text-xs text-muted-foreground">
										{String(intro.note)}
									</p>
								) : null}
							</div>
							<span className="text-xs font-medium text-indigo-600">Review</span>
						</Link>
					))}
				</div>
			</CardContent>
		</Card>
	);
}

/* ─── Shared Components ───────────────────────────────────────────────────── */

function CommitmentRow({
	item,
	trackingItemType,
}: {
	item: UpcomingCommitment;
	trackingItemType?: 'overdue' | 'follow_up';
}) {
	const typeLabels: Record<string, string> = {
		promise: 'Promise',
		task: 'Task',
		meeting: 'Meeting',
		financial: 'Financial',
	};

	return (
		<li className="flex items-center justify-between py-3">
			<div className="min-w-0 flex-1">
				<p
					className={`truncate text-sm font-medium ${item.isOverdue ? 'text-red-700' : 'text-foreground'}`}
				>
					{item.title}
				</p>
				<p className="text-xs text-muted-foreground">
					{typeLabels[item.commitmentType] || item.commitmentType}
				</p>
			</div>
			<div className="ml-4 flex items-center gap-2">
				<CommitmentActions
					commitmentId={item.id}
					status="active"
					trackingItemType={trackingItemType}
				/>
				<div className="text-right">
					{item.dueDate ? (
						<span
							className={`text-xs font-medium ${item.isOverdue ? 'text-red-600' : 'text-muted-foreground'}`}
						>
							{item.isOverdue ? 'Overdue: ' : 'Due: '}
							{item.dueDate.toLocaleDateString()}
						</span>
					) : (
						<span className="text-xs text-muted-foreground">No due date</span>
					)}
				</div>
			</div>
		</li>
	);
}

/* ─── Skeleton / Banner Components ─────────────────────────────────────────── */

function WelcomeBanner() {
	return (
		<div className="mb-6 rounded-lg border border-success/30 bg-success/5 p-4">
			<div className="flex items-start justify-between">
				<div>
					<p className="font-medium text-foreground">You're all set!</p>
					<p className="mt-0.5 text-sm text-muted-foreground">
						Sync is running in the background. Your dashboard will update automatically as more
						contacts and messages are processed.
					</p>
				</div>
			</div>
		</div>
	);
}

function NoWorkspaceBanner() {
	const telegramLinkingEnabled = process.env.NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED === 'true';

	if (!telegramLinkingEnabled) {
		return (
			<div>
				<h1 className="mb-6 text-2xl font-bold text-foreground">Dashboard</h1>
				<div className="rounded-lg border border-border bg-card p-8 text-center">
					<h2 className="text-lg font-semibold text-foreground">Use the demo workspace</h2>
					<p className="mt-2 text-sm text-muted-foreground">
						This public build ships without Telegram account access. Run{' '}
						<code className="rounded bg-muted px-1 py-0.5">pnpm demo:setup</code>, then sign in as{' '}
						<code className="rounded bg-muted px-1 py-0.5">alice@gordian.dev</code>.
					</p>
					<Button asChild className="mt-4">
						<Link href="/login">Go to sign in</Link>
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div>
			<h1 className="mb-6 text-2xl font-bold text-foreground">Dashboard</h1>
			<div className="rounded-lg border border-blue-200 bg-blue-50 p-8 text-center">
				<h2 className="text-lg font-semibold text-blue-900">Welcome to Gordian</h2>
				<p className="mt-2 text-sm text-blue-700">
					Connect your Telegram account to get started. Your contacts and messages will be synced
					automatically.
				</p>
				<Button asChild className="mt-4">
					<Link href="/onboarding/connect">Connect Telegram</Link>
				</Button>
			</div>
		</div>
	);
}

function StatsSkeleton() {
	return (
		<div className="rounded-lg border border-border bg-card p-4">
			<div className="flex items-center gap-6">
				{[1, 2, 3, 4, 5].map((i) => (
					<div key={i} className="flex items-center gap-2">
						<Skeleton className="h-4 w-16" />
						<Skeleton className="h-5 w-10" />
					</div>
				))}
			</div>
		</div>
	);
}

function ActNowSkeleton() {
	return (
		<>
			<SectionSkeleton title="Overdue Commitments" />
			<SectionSkeleton title="Pending Drafts" />
			<SectionSkeleton title="Follow-ups Due Today" />
		</>
	);
}

function SectionSkeleton({ title }: { title: string }) {
	return (
		<Card className="shadow-stripe-sm">
			<CardHeader className="pb-2">
				<CardTitle className="text-base">{title}</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="space-y-3">
					{[1, 2, 3].map((i) => (
						<Skeleton key={i} className="h-4 w-full" />
					))}
				</div>
			</CardContent>
		</Card>
	);
}
