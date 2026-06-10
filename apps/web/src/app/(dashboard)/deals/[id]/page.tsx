import { DealActions } from '@/components/deals/deal-actions';
import {
	DealDecisionTrailPanel,
	type DealKnowledgeDecision,
} from '@/components/deals/deal-decision-trail';
import { DealDetailHeader } from '@/components/deals/deal-detail-header';
import { DealEvidencePanel } from '@/components/deals/deal-evidence-panel';
import {
	DealLocalAiPanel,
	type SerializableDealAiRun,
} from '@/components/deals/deal-local-ai-panel';
import { DealOverviewPanel } from '@/components/deals/deal-overview-panel';
import { DealStageTimeline } from '@/components/deals/deal-stage-timeline';
import { formatRelativeDate } from '@/lib/format';
import { getUserWorkspaceId, getWorkspaceEnvelope, requireSession } from '@/lib/workspace';
import {
	getContactsByIds,
	getDeal,
	listDealAiRuns,
	listDealArtifacts,
	listDealDecisionsWithEvidence,
	listDealEvidenceLinks,
	listDealParticipants,
	listDealStageEvents,
} from '@repo/db';
import { getDealLocalAiStatus } from '@repo/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

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

	const { AddParticipantForm, ParticipantRoleSelect, RemoveParticipantButton } = await import(
		'@/components/deals/add-participant-form'
	);
	const { AddArtifactForm, RemoveArtifactButton } = await import(
		'@/components/deals/add-artifact-form'
	);

	const [participants, artifacts, stageEvents, dealDecisions, evidenceLinks, aiRuns] =
		await Promise.all([
			listDealParticipants(workspaceId, id, envelope),
			listDealArtifacts(workspaceId, id, envelope),
			listDealStageEvents(workspaceId, id, envelope),
			listDealDecisionsWithEvidence(workspaceId, id, envelope),
			listDealEvidenceLinks(workspaceId, id, envelope),
			listDealAiRuns(workspaceId, id, envelope),
		]);
	const knowledgeTrail = await getKnowledgeTrailForDeal(id);

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
	const stageHistory = deal.stageHistory as Array<{
		stage: string;
		timestamp: string;
		note?: string;
	}> | null;
	const terminalOutcomeReason =
		stage === 'won' || stage === 'lost'
			? Boolean(
					stageEvents.filter((event) => event.nextStage === stage).at(-1)?.note ||
						stageHistory?.filter((event) => event.stage === stage).at(-1)?.note,
				)
			: true;
	const localAiStatus = getDealLocalAiStatus(process.env);
	const serializedAiRuns: SerializableDealAiRun[] = aiRuns.map((run) => ({
		id: run.id,
		runType: run.runType,
		status: run.status,
		modelRole: run.modelRole,
		modelName: run.modelName,
		localVendorMode: run.localVendorMode,
		output: run.output,
		uncertainty: run.uncertainty,
		sourceCount: Array.isArray(run.sourceManifest) ? run.sourceManifest.length : 0,
		createdAt: run.createdAt instanceof Date ? run.createdAt.toISOString() : String(run.createdAt),
	}));

	return (
		<div>
			<div className="mb-6">
				<Link href="/deals" className="text-sm text-muted-foreground hover:text-foreground">
					&larr; Back to deals
				</Link>
			</div>

			<DealDetailHeader
				title={deal.title as string}
				contactId={contactId}
				contactName={contactName}
				dealTypeLabel={dealTypeLabels[dealType] || dealType}
				createdAtLabel={formatRelativeDate(createdAt)}
				actions={
					<DealActions
						dealId={id}
						stage={stage}
						stageHistory={deal.stageHistory as Array<{ stage: string; timestamp: string }>}
					/>
				}
				value={value}
				stage={stage}
			/>

			{notes ? (
				<div className="mb-6 rounded-lg border border-border bg-card p-4">
					<h2 className="mb-2 text-sm font-semibold text-foreground">Notes</h2>
					<p className="whitespace-pre-wrap text-sm text-muted-foreground">{notes}</p>
				</div>
			) : null}

			<DealOverviewPanel
				stage={stage}
				value={value}
				participantCount={participants.length}
				artifactCount={artifacts.length}
				evidenceCount={evidenceLinks.length}
				hasTerminalOutcomeReason={terminalOutcomeReason}
			/>

			<div className="grid gap-6 lg:grid-cols-2">
				<Suspense fallback={<SectionSkeleton title="Participants" />}>
					<ParticipantsSection
						participants={participants}
						nameMap={nameMap}
						dealId={id}
						AddForm={AddParticipantForm}
						RemoveButton={RemoveParticipantButton}
						RoleSelect={ParticipantRoleSelect}
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

			<DealStageTimeline events={stageEvents} stageHistory={stageHistory} />

			<div className="mt-6 grid gap-6 lg:grid-cols-2">
				<Suspense fallback={<SectionSkeleton title="Decision Trail" />}>
					<DealDecisionTrailPanel decisions={dealDecisions} knowledgeTrail={knowledgeTrail} />
				</Suspense>
				<DealEvidencePanel evidence={evidenceLinks} />
				<DealLocalAiPanel dealId={id} status={localAiStatus} initialRuns={serializedAiRuns} />
			</div>
		</div>
	);
}

async function getKnowledgeTrailForDeal(dealId: string): Promise<DealKnowledgeDecision[]> {
	try {
		const { getDealDecisionTrailAction } = await import('@/app/actions/knowledge');
		const result = await getDealDecisionTrailAction({ dealId });
		return result?.data ?? [];
	} catch {
		return [];
	}
}

function ParticipantsSection({
	participants,
	nameMap,
	dealId,
	AddForm,
	RemoveButton,
	RoleSelect,
}: {
	participants: Record<string, unknown>[];
	nameMap: Map<string, string>;
	dealId: string;
	AddForm: React.ComponentType<{ dealId: string }>;
	RemoveButton: React.ComponentType<{ participantId: string }>;
	RoleSelect: React.ComponentType<{
		participantId: string;
		currentRole: string;
		label: string;
	}>;
}) {
	return (
		<div
			data-testid="deal-participants-section"
			className="rounded-lg border border-border bg-card p-4"
		>
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
									<div className="flex flex-wrap items-center justify-end gap-2">
										<RoleSelect
											participantId={p.id as string}
											currentRole={role || 'other'}
											label={`Change role for ${nameMap.get(cId) || 'Unknown'}`}
										/>
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
		<div
			data-testid="deal-artifacts-section"
			className="rounded-lg border border-border bg-card p-4"
		>
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
						const title = a.title as string;
						return (
							<div key={a.id as string} className="rounded-md bg-muted px-3 py-2">
								<div className="flex items-start justify-between gap-3">
									<div className="min-w-0 flex-1">
										<p className="break-words text-sm font-medium text-foreground">{title}</p>
										{aUrl ? (
											<a
												href={aUrl}
												target="_blank"
												rel="noopener noreferrer"
												aria-label={`Open reference for ${title}`}
												className="mt-1 inline-flex text-xs font-medium text-primary hover:text-primary hover:underline"
											>
												Open reference
											</a>
										) : (
											<p className="mt-1 text-xs text-muted-foreground">No external reference</p>
										)}
									</div>
									<div className="flex shrink-0 items-center gap-2">
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
