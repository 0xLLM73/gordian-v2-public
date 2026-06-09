import type { SealedEnvelope } from '@repo/crypto';
import { listEvidenceForKnowledgeNodes } from '@repo/db';
import { classifyKnowledgeEvidenceQuality } from '@repo/shared';

export interface KnowledgeQualityNodeTerms {
	id: string;
	name: string;
	displayName: string;
}

export interface KnowledgeEvidenceQualityStats {
	nodeId: string;
	directEvidenceRows: number;
	directEvidenceMessages: number;
	directEvidenceContacts: number;
	possibleEvidenceRows: number;
	weakEvidenceRows: number;
}

function emptyQualityStats(nodeId: string): KnowledgeEvidenceQualityStats {
	return {
		nodeId,
		directEvidenceRows: 0,
		directEvidenceMessages: 0,
		directEvidenceContacts: 0,
		possibleEvidenceRows: 0,
		weakEvidenceRows: 0,
	};
}

export function topicTermsForKnowledgeNode(node: KnowledgeQualityNodeTerms): string[] {
	return [node.name, node.displayName].map((term) => term.trim()).filter(Boolean);
}

export async function getKnowledgeEvidenceQualityStatsForNodes(
	workspaceId: string,
	nodes: KnowledgeQualityNodeTerms[],
	envelope: SealedEnvelope | null | undefined,
): Promise<Map<string, KnowledgeEvidenceQualityStats>> {
	const stats = new Map<string, KnowledgeEvidenceQualityStats>();
	for (const node of nodes) stats.set(node.id, emptyQualityStats(node.id));
	if (!envelope || nodes.length === 0) return stats;

	const termsByNode = new Map(nodes.map((node) => [node.id, topicTermsForKnowledgeNode(node)]));
	const directMessageIdsByNode = new Map<string, Set<string>>();
	const directContactIdsByNode = new Map<string, Set<string>>();
	const evidenceRows = await listEvidenceForKnowledgeNodes(
		workspaceId,
		nodes.map((node) => node.id),
		envelope,
	);

	for (const row of evidenceRows) {
		const current = stats.get(row.knowledgeNodeId);
		if (!current) continue;
		const quality = classifyKnowledgeEvidenceQuality(
			row,
			termsByNode.get(row.knowledgeNodeId) ?? [],
		);
		if (quality.quality === 'direct_source') {
			current.directEvidenceRows++;
			if (row.messageId) {
				const messages = directMessageIdsByNode.get(row.knowledgeNodeId) ?? new Set<string>();
				messages.add(row.messageId);
				directMessageIdsByNode.set(row.knowledgeNodeId, messages);
			}
			if (row.contactId) {
				const contacts = directContactIdsByNode.get(row.knowledgeNodeId) ?? new Set<string>();
				contacts.add(row.contactId);
				directContactIdsByNode.set(row.knowledgeNodeId, contacts);
			}
		} else if (quality.quality === 'possible_connection') {
			current.possibleEvidenceRows++;
		} else {
			current.weakEvidenceRows++;
		}
	}

	for (const [nodeId, current] of stats) {
		current.directEvidenceMessages = directMessageIdsByNode.get(nodeId)?.size ?? 0;
		current.directEvidenceContacts = directContactIdsByNode.get(nodeId)?.size ?? 0;
	}

	return stats;
}
