import { DealActions } from '@/components/deals/deal-actions';
import { DEAL_STAGE_BG_COLORS, DEAL_STAGE_COLORS, DECISION_ACTION_COLORS } from '@/lib/colors';
import { formatCurrency, formatRelativeDate } from '@/lib/format';
import { getUserWorkspaceId, getWorkspaceEnvelope, requireSession } from '@/lib/workspace';
import {
	getContactsByIds,
	getDeal,
	getStageVelocityStats,
	listDealArtifacts,
	listDealParticipants,
} from '@repo/db';
import type { StageVelocityStats } from '@repo/db';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

const stageLabels: Record<string, string> = {
	discovery: 'Discovery',
	diligence: 'Diligence',
	negotiation: 'Negotiation',
	committed: 'Committed',
	won: 'Won',
	lost: 'Lost',
};

const dealTypeLabels: Record<string, string> = {
	investment: 'Investment',
	advisory: 'Advisory',
	partnership: 'Partnership',
	token: 'Token',
	other: 'Other',
};

export default async function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const session = await requireSession();
	const workspaceId = await getUserWorkspaceId(session.user.id);
	if (!workspaceId) notFound();

	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) notFound();

	const deal = await getDeal(workspaceId, id, envelope);
	if (!deal) notFound();

	const stage = deal.stage as string;
	const dealType = deal.dealType as string;
	const value = deal.value as number;
	const notes = deal.notes as string | null;
	const createdAt = deal.createdAt as unknown as string;
	const contactId = deal.contactId as string;

	const { AddParticipantForm, RemoveParticipantButton } = await import(
		'@/components/deals/add-participant-form'
	);
	const { AddArtifactForm, RemoveArtifactButton } = await import(
		'@/components/deals/add-artifact-form'
	);

	// Fetch participants, artifacts, velocity stats in parallel
	const [participants, artifacts, velocityStats] = await Promise.all([
		listDealParticipants(workspaceId, id, envelope),
		listDealArtifacts(workspaceId, id),
		getStageVelocityStats(workspaceId),
	]);

	// Resolve contact names
	const contactIds = new Set<string>();
	if (contactId) contactIds.add(contactId);
	for (const p of participants) {
		if (p.contactId) contactIds.add(p.contactId);
	}
	const nameMap = new Map<string, string>();
	if (contactIds.size > 0) {
		const contacts = await getContactsByIds(workspaceId, [...contactIds], envelope);
		for (const c of contacts) {
			nameMap.set(
				c.id as string,
				[c.firstName as string, c.lastName as string].filter(Boolean).join(' ') || 'Unknown',
			);
		}
	}

	const contactName = nameMap.get(contactId) || 'Unknown contact';

	return (
		<div>
			<div className="mb-6">
				<Link href="/deals" className="text-sm text-muted-foreground hover:text-foreground">
					&larr; Back to deals
				</Link>
			</div>

			<div className="mb-6 flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold text-foreground">{deal.title as string}</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						<Link href={`/contacts/${contactId}`} className="text-primary hover:text-primary">
							{contactName}
						</Link>
						{' \u00B7 '}
						{dealTypeLabels[dealType] || dealType}
						{' \u00B7 Created '}
						{formatRelativeDate(createdAt)}
					</p>
				</div>
				<div className="flex items-center gap-3">
					<DealActions
						dealId={id}
						stage={stage}
						stageHistory={deal.stageHistory as Array<{ stage: string; timestamp: string }>}
					/>
					<span className="text-lg font-semibold text-foreground">{formatCurrency(value)}</span>
					<span
						className={`rounded-full px-3 py-1 text-sm font-medium ${DEAL_STAGE_COLORS[stage] || 'bg-muted text-muted-foreground'}`}
					>
						{stageLabels[stage] || stage}
					</span>
				</div>
			</div>

			{notes ? (
				<div className="mb-6 rounded-lg border border-border bg-card p-4">
					<h2 className="mb-2 text-sm font-semibold text-foreground">Notes</h2>
					<p className="whitespace-pre-wrap text-sm text-muted-foreground">{notes}</p>
				</div>
			) : null}

			<div className="grid gap-6 lg:grid-cols-2">
				<Suspense fallback={<SectionSkeleton title="Participants" />}>
					<ParticipantsSection
						participants={participants}
						nameMap={nameMap}
						dealId={id}
						AddForm={AddParticipantForm}
						RemoveButton={RemoveParticipantButton}
					/>
				</Suspense>

				<Suspense fallback={<SectionSkeleton title="Artifacts" />}>
					<ArtifactsSection
						artifacts={artifacts}
						dealId={id}
						AddForm={AddArtifactForm}
						RemoveButton={RemoveArtifactButton}
					/>
				</Suspense>
			</div>

			<StageTimeline
				stageHistory={deal.stageHistory as Array<{ stage: string; timestamp: string }> | null}
				velocityStats={velocityStats}
			/>

			<div className="mt-6">
				<Suspense fallback={<SectionSkeleton title="Decision Trail" />}>
					<DealDecisionTrail dealId={id} />
				</Suspense>
			</div>
		</div>
	);
}

const roleLabels: Record<string, string> = {
	lead: 'Lead',
	co_investor: 'Co-investor',
	advisor: 'Advisor',
	counterparty: 'Counterparty',
	introducer: 'Introducer',
	other: 'Other',
};

function ParticipantsSection({
	participants,
	nameMap,
	dealId,
	AddForm,
	RemoveButton,
}: {
	participants: Record<string, unknown>[];
	nameMap: Map<string, string>;
	dealId: string;
	AddForm: React.ComponentType<{ dealId: string }>;
	RemoveButton: React.ComponentType<{ participantId: string }>;
}) {
	return (
		<div className="rounded-lg border border-border bg-card p-4">
			<div className="mb-3 flex items-center justify-between">
				<h2 className="text-sm font-semibold text-foreground">Participants</h2>
				<AddForm dealId={dealId} />
			</div>
			{participants.length === 0 ? (
				<p className="text-sm text-muted-foreground">No participants added yet.</p>
			) : (
				<div className="space-y-2">
					{participants.map((p) => {
						const cId = p.contactId as string;
						const role = p.role as string;
						const pNotes = p.notes as string | null;
						return (
							<div key={p.id as string} className="rounded-md bg-muted px-3 py-2">
								<div className="flex items-center justify-between">
									<Link
										href={`/contacts/${cId}`}
										className="text-sm font-medium text-foreground hover:text-primary"
									>
										{nameMap.get(cId) || 'Unknown'}
									</Link>
									<div className="flex items-center gap-2">
										<span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
											{roleLabels[role] || role || 'Participant'}
										</span>
										<RemoveButton participantId={p.id as string} />
									</div>
								</div>
								{pNotes ? <p className="mt-0.5 text-xs text-muted-foreground">{pNotes}</p> : null}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

const artifactTypeLabels: Record<string, string> = {
	term_sheet: 'Term Sheet',
	saft: 'SAFT',
	token_warrant: 'Token Warrant',
	cap_table: 'Cap Table',
	contract: 'Contract',
	presentation: 'Presentation',
	note: 'Note',
	other: 'Other',
};

function ArtifactsSection({
	artifacts,
	dealId,
	AddForm,
	RemoveButton,
}: {
	artifacts: Record<string, unknown>[];
	dealId: string;
	AddForm: React.ComponentType<{ dealId: string }>;
	RemoveButton: React.ComponentType<{ artifactId: string }>;
}) {
	return (
		<div className="rounded-lg border border-border bg-card p-4">
			<div className="mb-3 flex items-center justify-between">
				<h2 className="text-sm font-semibold text-foreground">Artifacts</h2>
				<AddForm dealId={dealId} />
			</div>
			{artifacts.length === 0 ? (
				<p className="text-sm text-muted-foreground">No artifacts added yet.</p>
			) : (
				<div className="space-y-2">
					{artifacts.map((a) => {
						const aType = a.artifactType as string;
						const aUrl = a.url as string | null;
						return (
							<div key={a.id as string} className="rounded-md bg-muted px-3 py-2">
								<div className="flex items-center justify-between">
									<div className="min-w-0 flex-1">
										{aUrl ? (
											<a
												href={aUrl}
												target="_blank"
												rel="noopener noreferrer"
												className="text-sm font-medium text-primary hover:text-primary"
											>
												{a.title as string}
											</a>
										) : (
											<p className="text-sm font-medium text-foreground">{a.title as string}</p>
										)}
									</div>
									<div className="ml-2 flex items-center gap-2">
										<span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
											{artifactTypeLabels[aType] || aType || 'Other'}
										</span>
										<RemoveButton artifactId={a.id as string} />
									</div>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

function SectionSkeleton({ title }: { title: string }) {
	return (
		<div className="rounded-lg border border-border bg-card p-4">
			<h2 className="mb-3 text-sm font-semibold text-foreground">{title}</h2>
			<div className="space-y-2">
				{[1, 2].map((i) => (
					<div key={i} className="animate-pulse rounded-md bg-muted px-3 py-2">
						<div className="h-4 w-32 rounded bg-muted" />
					</div>
				))}
			</div>
		</div>
	);
}

function StageTimeline({
	stageHistory,
	velocityStats,
}: {
	stageHistory: Array<{ stage: string; timestamp: string }> | null;
	velocityStats: StageVelocityStats;
}) {
	const history = Array.isArray(stageHistory) && stageHistory.length > 0 ? stageHistory : null;
	if (!history) return null;

	const now = new Date();
	const avgDays = velocityStats.avgDaysPerStage;

	// Compute durations between consecutive stages
	const stages: Array<{
		stage: string;
		enteredAt: Date;
		days: number;
		avg: number | undefined;
		isCurrent: boolean;
	}> = [];

	for (let i = 0; i < history.length; i++) {
		const entry = history[i];
		const enteredAt = new Date(entry.timestamp);
		const exitedAt = i < history.length - 1 ? new Date(history[i + 1].timestamp) : now;
		const days = Math.max(
			0,
			Math.floor((exitedAt.getTime() - enteredAt.getTime()) / (1000 * 60 * 60 * 24)),
		);
		const isCurrent = i === history.length - 1;

		stages.push({
			stage: entry.stage,
			enteredAt,
			days,
			avg: avgDays[entry.stage],
			isCurrent,
		});
	}

	// Total cycle time
	const totalDays = Math.max(
		0,
		Math.floor((now.getTime() - new Date(history[0].timestamp).getTime()) / (1000 * 60 * 60 * 24)),
	);

	return (
		<div className="mt-6 rounded-lg border border-border bg-card p-4">
			<div className="mb-4 flex items-center justify-between">
				<h2 className="text-sm font-semibold text-foreground">Stage Progression</h2>
				<span className="text-xs text-muted-foreground">Total: {totalDays}d</span>
			</div>
			<div className="relative ml-3 border-l-2 border-border pl-6">
				{stages.map((s, idx) => {
					const isLast = idx === stages.length - 1;
					const ratio = s.avg && s.avg > 0 ? s.days / s.avg : 0;
					const barColor =
						ratio > 2.0
							? 'bg-red-400'
							: ratio > 1.5
								? 'bg-orange-400'
								: `${DEAL_STAGE_BG_COLORS[s.stage] || 'bg-primary'}`;
					const barWidth =
						s.avg && s.avg > 0 ? Math.min(100, Math.round((s.days / (s.avg * 2.5)) * 100)) : 40;

					return (
						<div key={`${s.stage}-${idx}`} className={isLast ? '' : 'pb-5'}>
							{/* Timeline dot */}
							<div
								className={`absolute -left-[7px] mt-1 h-3 w-3 rounded-full border-2 border-background ${
									s.isCurrent
										? `${DEAL_STAGE_BG_COLORS[s.stage] || 'bg-primary'}`
										: 'bg-muted-foreground'
								}`}
							/>

							<div>
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-2">
										<span className="text-sm font-medium text-foreground">
											{stageLabels[s.stage] || s.stage}
										</span>
										{s.isCurrent ? (
											<span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
												Current
											</span>
										) : null}
									</div>
									<span className="text-xs font-medium text-foreground">{s.days}d</span>
								</div>

								{/* Benchmark bar */}
								<div className="mt-1.5 flex items-center gap-2">
									<div className="h-1.5 flex-1 rounded-full bg-muted">
										<div
											className={`h-1.5 rounded-full ${barColor}`}
											style={{ width: `${barWidth}%` }}
										/>
									</div>
									{s.avg !== undefined ? (
										<span className="shrink-0 text-[10px] text-muted-foreground">
											avg {Math.round(s.avg)}d
										</span>
									) : null}
								</div>

								<time className="mt-0.5 block text-[10px] text-muted-foreground">
									{s.enteredAt.toLocaleDateString('en-US', {
										month: 'short',
										day: 'numeric',
										year: 'numeric',
									})}
								</time>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

async function DealDecisionTrail({ dealId }: { dealId: string }) {
	const { getDealDecisionTrailAction } = await import('@/app/actions/knowledge');
	const result = await getDealDecisionTrailAction({ dealId });
	const trail = result?.data ?? [];

	if (trail.length === 0) return null;

	return (
		<div className="rounded-lg border border-border bg-card p-4">
			<h2 className="mb-4 text-sm font-semibold text-foreground">Decision Trail</h2>
			<div className="relative ml-3 border-l-2 border-border pl-6">
				{trail.map((step, idx) => {
					const actionLabel = step.action ? step.action.replace(/_/g, ' ') : 'Decision';
					const isLast = idx === trail.length - 1;

					return (
						<div key={step.id} className={isLast ? '' : 'pb-6'}>
							{/* Timeline dot */}
							<div className="absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full border-2 border-background bg-primary" />

							<div className="flex items-start justify-between">
								<div>
									<div className="flex items-center gap-2">
										<span
											className={`rounded px-2 py-0.5 text-xs font-semibold capitalize ${DECISION_ACTION_COLORS[step.action ?? ''] || 'bg-gray-100 text-gray-600'}`}
										>
											{actionLabel}
										</span>
										<span className="text-sm font-medium text-foreground">{step.displayName}</span>
									</div>

									{step.rationales.length > 0 ? (
										<div className="mt-1.5 flex flex-wrap gap-1">
											{step.rationales.map((rationale) => (
												<span
													key={rationale}
													className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
												>
													{rationale}
												</span>
											))}
										</div>
									) : null}

									{step.outcomes.length > 0 ? (
										<div className="mt-1.5 flex flex-wrap gap-1">
											{step.outcomes.map((outcome) => (
												<span
													key={outcome.displayName}
													className={`rounded px-1.5 py-0.5 text-xs font-medium ${
														outcome.result === 'positive'
															? 'bg-green-100 text-green-700'
															: outcome.result === 'negative'
																? 'bg-red-100 text-red-700'
																: 'bg-gray-100 text-gray-600'
													}`}
												>
													{outcome.displayName}
												</span>
											))}
										</div>
									) : null}
								</div>

								{step.decidedAt ? (
									<time className="shrink-0 text-xs text-muted-foreground">
										{formatRelativeDate(new Date(step.decidedAt))}
									</time>
								) : null}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
