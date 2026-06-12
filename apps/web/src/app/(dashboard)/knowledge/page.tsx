import {
	getContactsByIds,
	getKnowledgeNodeEvidenceStats,
	getMessageContactCoverageReport,
	listContactIdsByKnowledge,
	listKnowledgeNodes,
} from '@repo/db';
import { Suspense } from 'react';
import { KnowledgeBrowser } from '@/app/(dashboard)/knowledge/knowledge-browser';
import { LocalAiStatusPanel } from '@/components/local-ai-status-panel';
import { getKnowledgeEvidenceQualityStatsForNodes } from '@/lib/knowledge-evidence-quality';
import { getUserWorkspaceId, getWorkspaceEnvelope, requireSession } from '@/lib/workspace';

export const metadata = { title: 'Knowledge' };

export default async function KnowledgePage() {
	const session = await requireSession();
	const workspaceId = await getUserWorkspaceId(session.user.id);

	return (
		<div>
			<div className="mb-6">
				<h1 className="text-2xl font-bold text-foreground">Knowledge</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					Topics, projects, organizations, and concepts extracted from your conversations.
				</p>
			</div>

			<LocalAiStatusPanel />

			{workspaceId ? (
				<Suspense fallback={<KnowledgeSkeleton />}>
					<KnowledgeBrowserSection workspaceId={workspaceId} />
				</Suspense>
			) : (
				<div className="rounded-lg border border-border bg-muted p-8 text-center text-sm text-muted-foreground">
					Connect Telegram to start extracting knowledge from your conversations.
				</div>
			)}
		</div>
	);
}

async function KnowledgeBrowserSection({ workspaceId }: { workspaceId: string }) {
	const envelope = await getWorkspaceEnvelope(workspaceId);
	const nodes = await listKnowledgeNodes(workspaceId, { limit: 50 }, envelope ?? undefined);
	const evidenceStats = await getKnowledgeNodeEvidenceStats(
		workspaceId,
		nodes.map((node) => node.id),
	);
	const evidenceQualityStats = await getKnowledgeEvidenceQualityStatsForNodes(
		workspaceId,
		nodes,
		envelope,
	);
	const messageCoverage = await getMessageContactCoverageReport(workspaceId);

	// Enrich with contact previews (same logic as listKnowledgeNodesAction)
	const contactIdsByNode = await Promise.all(
		nodes.map(async (n) => ({
			nodeId: n.id,
			contactIds: await listContactIdsByKnowledge(n.id, workspaceId),
		})),
	);

	const previewContactIds = new Set<string>();
	const nodeContactMap = new Map<string, string[]>();
	for (const { nodeId, contactIds } of contactIdsByNode) {
		nodeContactMap.set(nodeId, contactIds);
		for (const cid of contactIds.slice(0, 3)) {
			previewContactIds.add(cid);
		}
	}

	let contactNameMap = new Map<string, string>();
	if (previewContactIds.size > 0 && envelope) {
		const contactRows = await getContactsByIds(workspaceId, [...previewContactIds], envelope);
		contactNameMap = new Map(contactRows.map((c) => [c.id, (c.firstName as string) || 'Someone']));
	}

	const enrichedNodes = nodes.map((n) => {
		const contactIds = nodeContactMap.get(n.id) ?? [];
		const contactPreviews = contactIds
			.slice(0, 3)
			.map((cid) => contactNameMap.get(cid) ?? 'Someone');
		return {
			id: n.id,
			type: n.type,
			name: n.name,
			displayName: n.displayName,
			description: n.description ?? null,
			mentionCount: n.mentionCount ?? 0,
			evidenceCount: evidenceStats.get(n.id)?.evidenceRows ?? 0,
			distinctEvidenceMessages: evidenceStats.get(n.id)?.distinctEvidenceMessages ?? 0,
			distinctEvidenceContacts: evidenceStats.get(n.id)?.distinctEvidenceContacts ?? 0,
			aggregateEvidenceCount: evidenceStats.get(n.id)?.aggregateLinkEvidenceCount ?? 0,
			directEvidenceRows: evidenceQualityStats.get(n.id)?.directEvidenceRows ?? 0,
			directEvidenceMessages: evidenceQualityStats.get(n.id)?.directEvidenceMessages ?? 0,
			directEvidenceContacts: evidenceQualityStats.get(n.id)?.directEvidenceContacts ?? 0,
			possibleEvidenceRows: evidenceQualityStats.get(n.id)?.possibleEvidenceRows ?? 0,
			weakEvidenceRows: evidenceQualityStats.get(n.id)?.weakEvidenceRows ?? 0,
			firstSeenAt: n.firstSeenAt ?? null,
			lastSeenAt: n.lastSeenAt ?? null,
			createdAt: n.createdAt ?? null,
			contactCount: contactIds.length,
			contactPreviews,
		};
	});

	return <KnowledgeBrowser initialNodes={enrichedNodes} messageCoverage={messageCoverage} />;
}

function KnowledgeSkeleton() {
	return (
		<div>
			<div className="mb-4 h-10 w-full animate-pulse rounded bg-muted" />
			<div className="mb-6 h-9 w-full animate-pulse rounded bg-muted" />
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{[1, 2, 3, 4, 5, 6].map((i) => (
					<div key={i} className="animate-pulse rounded-lg border border-border bg-card p-4">
						<div className="mb-2 h-5 w-20 rounded bg-muted" />
						<div className="h-4 w-3/4 rounded bg-muted" />
						<div className="mt-2 h-3 w-full rounded bg-muted" />
					</div>
				))}
			</div>
		</div>
	);
}
