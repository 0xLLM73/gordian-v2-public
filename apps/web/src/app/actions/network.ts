'use server';

import { getAllRelationships, getHealthScoresByWorkspace, listContacts } from '@repo/db';
import { z } from 'zod';
import { workspaceAction } from '@/lib/safe-action';

export interface GraphNode {
	id: string;
	name: string;
	healthLabel: string;
	composite: number;
	connectionCount: number;
}

export interface GraphLink {
	source: string;
	target: string;
	strength: number;
	relationshipType: string;
}

export interface GraphData {
	nodes: GraphNode[];
	links: GraphLink[];
}

/**
 * Fetch network graph data for the workspace.
 * CRITICAL: Uses workspaceAction — workspaceId is never accepted from client.
 */
export const getNetworkGraphAction = workspaceAction
	.schema(
		z.object({
			minStrength: z.number().min(0).max(1).optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const { workspaceId, envelope } = ctx;
		if (!envelope) throw new Error('Workspace encryption key not found');

		// 0. Refresh group-chat co-occurrence relationships (pure SQL, fast)
		const { deriveGroupChatRelationships } = await import('@repo/db');
		await deriveGroupChatRelationships(workspaceId).catch(() => 0);

		// 1. Fetch all relationships (with optional min strength filter)
		const relationships = await getAllRelationships(workspaceId, envelope, {
			minStrength: parsedInput.minStrength,
		}).catch(() => []);

		if (relationships.length === 0) {
			return { nodes: [], links: [] } satisfies GraphData;
		}

		// 2. Collect unique contact IDs appearing in relationships
		const contactIdSet = new Set<string>();
		for (const rel of relationships) {
			contactIdSet.add(rel.sourceContactId);
			contactIdSet.add(rel.targetContactId);
		}

		// 3. Fetch health scores (Phase 14 may not have run yet — degrade gracefully)
		const healthScores = await getHealthScoresByWorkspace(workspaceId).catch(() => []);
		const healthByContactId = new Map(healthScores.map((hs) => [hs.contactId, hs]));

		// 4. Fetch all contacts and decrypt names via envelope
		const allContacts = await listContacts(workspaceId, envelope, { limit: 500 });
		const contactById = new Map(allContacts.map((c) => [c.id, c]));

		// 5. Count connections per node for node sizing
		const connectionCount = new Map<string, number>();
		for (const rel of relationships) {
			connectionCount.set(rel.sourceContactId, (connectionCount.get(rel.sourceContactId) ?? 0) + 1);
			connectionCount.set(rel.targetContactId, (connectionCount.get(rel.targetContactId) ?? 0) + 1);
		}

		// 6. Build nodes (only contacts that appear in relationships)
		const nodes: GraphNode[] = [];
		for (const contactId of contactIdSet) {
			const contact = contactById.get(contactId);
			const hs = healthByContactId.get(contactId);

			const firstName = contact?.firstName ?? '';
			const lastName = contact?.lastName ?? '';
			const name = [firstName, lastName].filter(Boolean).join(' ') || 'Unknown';

			nodes.push({
				id: contactId,
				name,
				healthLabel: hs?.label ?? 'unknown',
				composite: hs?.composite ?? 0,
				connectionCount: connectionCount.get(contactId) ?? 0,
			});
		}

		// 7. Build links
		const links: GraphLink[] = relationships.map((rel) => ({
			source: rel.sourceContactId,
			target: rel.targetContactId,
			strength: rel.strength,
			relationshipType: rel.relationshipType,
		}));

		return { nodes, links } satisfies GraphData;
	});
