import type {
	KnowledgeNeighbor,
	KnowledgeNode,
	KnowledgeRelationshipCandidateWithNode,
} from '@repo/db';
import {
	getKnowledgeNeighbors,
	getKnowledgeNode,
	getSharedKnowledge,
	listContactsWithEvidenceForKnowledgeNode,
	listKnowledgeRelationshipCandidatesForNode,
	searchKnowledgeNodes,
} from '@repo/db';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MergeDialog } from '@/components/knowledge/merge-dialog';
import { PeopleEvidenceSection } from '@/components/knowledge/people-evidence-section';
import { KNOWLEDGE_LINK_TYPE_COLORS, KNOWLEDGE_TYPE_COLORS } from '@/lib/colors';
import { formatRelativeDate } from '@/lib/format';
import { computeDecayedRelevance } from '@/lib/knowledge-utils';
import { getUserWorkspaceId, getWorkspaceEnvelope, requireSession } from '@/lib/workspace';

function LinkTypeBadge({ type }: { type: string }) {
	const colorClass = KNOWLEDGE_LINK_TYPE_COLORS[type] ?? 'bg-gray-100 text-gray-600';
	return (
		<span className={`rounded px-2 py-0.5 text-xs font-medium ${colorClass}`}>
			{type.replace(/_/g, ' ')}
		</span>
	);
}

function EdgeClaimBadge({ linkType, weight }: { linkType: string; weight?: number | null }) {
	const label = linkType === 'related_to' && (weight ?? 0) < 0.15 ? 'weak inferred' : 'inferred';
	return <span className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{label}</span>;
}

function CandidateStatusBadge({ status }: { status: string }) {
	const colorClass =
		status === 'eligible'
			? 'bg-emerald-50 text-emerald-700'
			: status === 'rejected'
				? 'bg-red-50 text-red-700'
				: status === 'promoted'
					? 'bg-blue-50 text-blue-700'
					: 'bg-amber-50 text-amber-700';
	return (
		<span className={`rounded px-2 py-0.5 text-xs font-medium ${colorClass}`}>
			{status.replace(/_/g, ' ')}
		</span>
	);
}

function TypeBadge({ type }: { type: string }) {
	const colorClass = KNOWLEDGE_TYPE_COLORS[type] ?? 'bg-gray-100 text-gray-700';
	return <span className={`rounded px-2 py-0.5 text-xs font-medium ${colorClass}`}>{type}</span>;
}

function RelatedEntitiesSection({ neighbors }: { neighbors: KnowledgeNeighbor[] }) {
	if (neighbors.length === 0) {
		return (
			<div className="rounded-lg border border-border bg-card p-6">
				<h2 className="mb-4 text-lg font-semibold text-foreground">Related Entities</h2>
				<p className="text-sm text-muted-foreground">
					No linked entities yet. The AI will connect related topics as it processes more
					conversations.
				</p>
			</div>
		);
	}

	const outbound = neighbors.filter((n) => n.direction === 'outbound');
	const inbound = neighbors.filter((n) => n.direction === 'inbound');

	return (
		<div className="rounded-lg border border-border bg-card p-6">
			<h2 className="mb-4 text-lg font-semibold text-foreground">
				Related Entities{' '}
				<span className="ml-1 text-sm font-normal text-muted-foreground">({neighbors.length})</span>
			</h2>

			{outbound.length > 0 && (
				<div className="mb-5">
					<p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						Links to
					</p>
					<ul className="space-y-2">
						{outbound.map((n) => (
							<li key={`out-${n.node.id}`}>
								<Link
									href={`/knowledge/${n.node.id}`}
									className="flex items-center gap-2 rounded-md p-2 transition-colors hover:bg-accent"
								>
									<span className="text-muted-foreground">&rarr;</span>
									<span className="text-sm font-medium text-foreground">{n.node.displayName}</span>
									<TypeBadge type={n.node.type} />
									<LinkTypeBadge type={n.link.linkType} />
									<EdgeClaimBadge linkType={n.link.linkType} weight={n.link.weight} />
								</Link>
							</li>
						))}
					</ul>
				</div>
			)}

			{inbound.length > 0 && (
				<div>
					<p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						Linked from
					</p>
					<ul className="space-y-2">
						{inbound.map((n) => (
							<li key={`in-${n.node.id}`}>
								<Link
									href={`/knowledge/${n.node.id}`}
									className="flex items-center gap-2 rounded-md p-2 transition-colors hover:bg-accent"
								>
									<span className="text-muted-foreground">&larr;</span>
									<span className="text-sm font-medium text-foreground">{n.node.displayName}</span>
									<TypeBadge type={n.node.type} />
									<LinkTypeBadge type={n.link.linkType} />
									<EdgeClaimBadge linkType={n.link.linkType} weight={n.link.weight} />
								</Link>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}

function RelationshipCandidatesSection({
	candidates,
}: {
	candidates: KnowledgeRelationshipCandidateWithNode[];
}) {
	if (candidates.length === 0) return null;

	return (
		<div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
			<h2 className="mb-2 text-lg font-semibold text-foreground">Relationship Candidates</h2>
			<p className="mb-4 text-sm text-amber-900">
				These candidate edges are visible for review, but they are not confirmed graph links until
				direct source evidence passes promotion checks.
			</p>
			<ul className="space-y-2">
				{candidates.map((item) => (
					<li key={item.candidate.id} className="rounded-md bg-white/70 p-3">
						<Link
							href={`/knowledge/${item.node.id}`}
							className="flex flex-wrap items-center gap-2 text-sm"
						>
							<span className="text-muted-foreground">
								{item.direction === 'outbound' ? '->' : '<-'}
							</span>
							<span className="font-medium text-foreground">{item.node.displayName}</span>
							<TypeBadge type={item.node.type} />
							<LinkTypeBadge type={item.candidate.linkType} />
							<CandidateStatusBadge status={item.candidate.promotionStatus} />
						</Link>
						<div className="mt-2 flex flex-wrap gap-2 text-xs text-amber-900">
							<span>{item.candidate.evidenceKind.replace(/_/g, ' ')}</span>
							{typeof item.candidate.confidence === 'number' ? (
								<span>{Math.round(item.candidate.confidence * 100)}% confidence</span>
							) : null}
						</div>
						{item.candidate.promotionReason ? (
							<p className="mt-2 text-xs text-amber-900">{item.candidate.promotionReason}</p>
						) : null}
					</li>
				))}
			</ul>
		</div>
	);
}

function SharedKnowledgeSection({
	sharedByContact,
}: {
	sharedByContact: Array<{ contactName: string; nodes: KnowledgeNode[] }>;
}) {
	const hasAny = sharedByContact.some((s) => s.nodes.length > 0);

	if (!hasAny) return null;

	return (
		<div className="rounded-lg border border-indigo-100 bg-indigo-50 p-6">
			<h2 className="mb-4 text-lg font-semibold text-foreground">Shared Context</h2>
			<p className="mb-4 text-sm text-muted-foreground">
				Knowledge topics in common with contacts on this node:
			</p>
			<div className="space-y-4">
				{sharedByContact
					.filter((s) => s.nodes.length > 0)
					.map((s) => (
						<div key={s.contactName}>
							<p className="mb-1.5 text-xs font-semibold text-foreground">{s.contactName}</p>
							<div className="flex flex-wrap gap-1.5">
								{s.nodes.map((node) => (
									<Link key={node.id} href={`/knowledge/${node.id}`}>
										<span
											className={`inline-block cursor-pointer rounded px-2 py-0.5 text-xs font-medium transition-opacity hover:opacity-80 ${KNOWLEDGE_TYPE_COLORS[node.type] ?? 'bg-gray-100 text-gray-700'}`}
										>
											{node.displayName}
										</span>
									</Link>
								))}
							</div>
						</div>
					))}
			</div>
		</div>
	);
}

export default async function KnowledgeNodePage({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: Promise<Record<string, string | undefined>>;
}) {
	const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

	const session = await requireSession();
	const workspaceId = await getUserWorkspaceId(session.user.id);
	if (!workspaceId) notFound();
	const { id } = await params;
	if (!UUID_RE.test(id)) notFound();
	const sp = await searchParams;
	const fromContactId = sp.fromContact;
	if (fromContactId && !UUID_RE.test(fromContactId)) notFound();

	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) notFound();

	const node = await getKnowledgeNode(workspaceId, id, envelope);
	if (!node) notFound();

	// Fetch linked contacts, confirmed neighbors, and review-only relationship candidates in parallel
	const [contactRows, neighbors, relationshipCandidates] = await Promise.all([
		listContactsWithEvidenceForKnowledgeNode(node.id, workspaceId, envelope),
		getKnowledgeNeighbors(node.id, workspaceId, envelope),
		listKnowledgeRelationshipCandidatesForNode(workspaceId, node.id, envelope, {
			limit: 8,
			status: 'review_only',
		}),
	]);

	// SEC-006: Project only UI-needed fields — never serialize phone/email/notes/blind indexes into the page payload
	const linkedContacts = contactRows.map((r) => ({
		id: r.contact.id,
		firstName: r.contact.firstName,
		lastName: r.contact.lastName,
		relationType: r.link.relationType,
		strength: r.link.strength,
		evidenceCount: r.link.evidenceCount,
		lastEvidenceAt: r.link.lastEvidenceAt,
		evidence: r.evidence.map((e) => ({
			id: e.id,
			evidenceKind: e.evidenceKind,
			confidence: e.confidence,
			snippet: e.snippet,
			occurredAt: e.occurredAt,
			messageId: e.messageId,
			createdAt: e.createdAt,
			metadata: e.metadata,
		})),
	}));

	// Shared knowledge: if viewing from a contact context, compute shared topics with each linked contact
	let sharedByContact: Array<{ contactName: string; nodes: KnowledgeNode[] }> = [];
	if (fromContactId) {
		const others = linkedContacts.filter((c) => c.id !== fromContactId).slice(0, 5);
		sharedByContact = await Promise.all(
			others.map(async (c) => {
				const contactName = [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown';
				const nodes = await getSharedKnowledge(fromContactId, c.id, workspaceId, envelope);
				return { contactName, nodes };
			}),
		);
	}

	// Merge candidates: search for similar nodes
	const similar = await searchKnowledgeNodes(workspaceId, node.name, undefined, envelope);
	const mergeCandidates = similar.filter((n) => n.id !== node.id).slice(0, 5);

	return (
		<div className="space-y-6">
			<div>
				<Link href="/knowledge" className="text-sm text-muted-foreground hover:text-foreground">
					&larr; Back to Knowledge
				</Link>
			</div>

			{/* Node header */}
			<div className="rounded-lg border border-border bg-card p-6">
				<div className="mb-3 flex items-center gap-3">
					<span
						className={`inline-block rounded px-2.5 py-1 text-sm font-medium ${KNOWLEDGE_TYPE_COLORS[node.type] || 'bg-gray-100 text-gray-700'}`}
					>
						{node.type}
					</span>
				</div>
				<h1 className="text-2xl font-bold text-foreground">{node.displayName}</h1>
				{node.description ? (
					<p className="mt-2 text-sm text-muted-foreground">{node.description}</p>
				) : null}
				<div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
					<span>{node.mentionCount ?? 0} extraction signals</span>
					{node.lastSeenAt ? (
						<span
							className={
								computeDecayedRelevance(node.mentionCount ?? 0, node.lastSeenAt).opacity < 0.5
									? 'text-orange-500'
									: ''
							}
						>
							Last seen {formatRelativeDate(node.lastSeenAt)}
						</span>
					) : null}
				</div>
			</div>

			{/* Related Entities (Phase 32) */}
			<RelatedEntitiesSection neighbors={neighbors} />
			<RelationshipCandidatesSection candidates={relationshipCandidates} />

			{/* Shared Context (Phase 32) — visible when viewing from a contact context */}
			{fromContactId ? <SharedKnowledgeSection sharedByContact={sharedByContact} /> : null}

			<PeopleEvidenceSection contacts={linkedContacts} topicTerms={[node.name, node.displayName]} />

			{/* Merge Candidates */}
			{mergeCandidates.length > 0 ? (
				<div className="rounded-lg border border-border bg-card p-6">
					<h2 className="mb-1 text-lg font-semibold text-foreground">Similar Nodes</h2>
					<p className="mb-4 text-sm text-muted-foreground">
						These nodes have similar names and may be duplicates. Merge to combine their links and
						mentions.
					</p>
					<ul className="divide-y divide-gray-100">
						{mergeCandidates.map((candidate) => (
							<li key={candidate.id} className="flex items-center justify-between py-3">
								<Link
									href={`/knowledge/${candidate.id}`}
									className="flex items-center gap-2 transition-colors hover:text-indigo-700"
								>
									<TypeBadge type={candidate.type} />
									<span className="text-sm font-medium text-foreground">
										{candidate.displayName}
									</span>
									<span className="text-xs text-muted-foreground">
										{candidate.mentionCount ?? 0} mentions
									</span>
								</Link>
								<MergeDialog
									survivor={{
										id: node.id,
										displayName: node.displayName,
										type: node.type,
										mentionCount: node.mentionCount,
									}}
									merged={{
										id: candidate.id,
										displayName: candidate.displayName,
										type: candidate.type,
										mentionCount: candidate.mentionCount,
									}}
								/>
							</li>
						))}
					</ul>
				</div>
			) : null}
		</div>
	);
}
