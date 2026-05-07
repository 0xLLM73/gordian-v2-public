import { withKeys } from '@repo/crypto';
import type { SealedEnvelope } from '@repo/crypto';
import { and, eq, gte, or, sql } from 'drizzle-orm';
import { db } from '../client';
import { contactRelationships } from '../schema/relationships';

export interface CreateRelationshipInput {
	sourceContactId: string;
	targetContactId: string;
	relationshipType: (typeof contactRelationships.relationshipType.enumValues)[number];
	strength?: number;
	source?: (typeof contactRelationships.source.enumValues)[number];
	evidence?: Record<string, unknown>;
	notes?: string;
}

/** Upsert a relationship edge. On conflict (same workspace+source+target+type), updates strength + evidence. */
export async function createRelationship(
	workspaceId: string,
	input: CreateRelationshipInput,
	envelope: SealedEnvelope,
) {
	if (input.sourceContactId === input.targetContactId) {
		throw new Error('sourceContactId and targetContactId must be different');
	}

	return withKeys(envelope, async () => {
		const result = await db
			.insert(contactRelationships)
			.values({
				workspaceId,
				sourceContactId: input.sourceContactId,
				targetContactId: input.targetContactId,
				relationshipType: input.relationshipType,
				strength: input.strength ?? 0.5,
				source: input.source ?? 'ai_extracted',
				evidence: input.evidence ?? {},
				notes: input.notes,
			})
			.onConflictDoUpdate({
				target: [
					contactRelationships.workspaceId,
					contactRelationships.sourceContactId,
					contactRelationships.targetContactId,
					contactRelationships.relationshipType,
				],
				set: {
					strength: sql`excluded.strength`,
					evidence: sql`excluded.evidence`,
					updatedAt: sql`now()`,
				},
			})
			.returning();

		return result[0] ?? null;
	});
}

/** Get all relationships involving a contact (source or target direction). */
export async function getRelationshipsForContact(
	workspaceId: string,
	contactId: string,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		return await db
			.select()
			.from(contactRelationships)
			.where(
				and(
					eq(contactRelationships.workspaceId, workspaceId),
					or(
						eq(contactRelationships.sourceContactId, contactId),
						eq(contactRelationships.targetContactId, contactId),
					),
				),
			);
	});
}

export interface GetAllRelationshipsOptions {
	minStrength?: number;
	limit?: number;
}

/** Get all relationships for a workspace, optionally filtered by minimum strength. */
export async function getAllRelationships(
	workspaceId: string,
	envelope: SealedEnvelope,
	options?: GetAllRelationshipsOptions,
) {
	const limit = options?.limit ?? 500;
	const conditions = [eq(contactRelationships.workspaceId, workspaceId)];

	if (options?.minStrength !== undefined) {
		conditions.push(gte(contactRelationships.strength, options.minStrength));
	}

	return withKeys(envelope, async () => {
		return await db
			.select()
			.from(contactRelationships)
			.where(and(...conditions))
			.limit(limit);
	});
}

/**
 * Derive relationships from group chat co-participation.
 * Two contacts who both sent messages in the same group/supergroup chat
 * are linked as 'colleague' with source='inferred'.
 * Strength is based on shared chat count: min(sharedChats / 3, 1.0).
 */
export async function deriveGroupChatRelationships(workspaceId: string): Promise<number> {
	const pairs = await db.execute(sql`
		WITH group_pairs AS (
			SELECT DISTINCT
				LEAST(m1.contact_id, m2.contact_id) AS source_id,
				GREATEST(m1.contact_id, m2.contact_id) AS target_id,
				count(DISTINCT m1.chat_id) AS shared_chats
			FROM messages m1
			JOIN messages m2 ON m1.chat_id = m2.chat_id
				AND m1.workspace_id = m2.workspace_id
				AND m1.contact_id < m2.contact_id
			JOIN chats c ON m1.chat_id = c.id AND c.type IN ('group', 'supergroup')
			WHERE m1.workspace_id = ${workspaceId}::uuid
				AND m1.contact_id IS NOT NULL
				AND m2.contact_id IS NOT NULL
			GROUP BY LEAST(m1.contact_id, m2.contact_id), GREATEST(m1.contact_id, m2.contact_id)
		)
		INSERT INTO contact_relationships (id, workspace_id, source_contact_id, target_contact_id, relationship_type, strength, source, evidence)
		SELECT
			gen_random_uuid(),
			${workspaceId}::uuid,
			source_id,
			target_id,
			'colleague',
			LEAST(shared_chats::real / 3.0, 1.0),
			'inferred',
			jsonb_build_object('shared_group_chats', shared_chats)
		FROM group_pairs
		ON CONFLICT (workspace_id, source_contact_id, target_contact_id, relationship_type)
		DO UPDATE SET
			strength = EXCLUDED.strength,
			evidence = EXCLUDED.evidence,
			updated_at = NOW()
		RETURNING id
	`);

	return (pairs as unknown[]).length;
}

/** Update the strength (and optionally evidence) of an existing relationship. */
export async function updateRelationshipStrength(
	workspaceId: string,
	relationshipId: string,
	strength: number,
	envelope: SealedEnvelope,
	evidence?: Record<string, unknown>,
) {
	const updates: Record<string, unknown> = { strength, updatedAt: sql`now()` };
	if (evidence !== undefined) {
		updates.evidence = evidence;
	}

	return withKeys(envelope, async () => {
		const result = await db
			.update(contactRelationships)
			.set(updates)
			.where(
				and(
					eq(contactRelationships.id, relationshipId),
					eq(contactRelationships.workspaceId, workspaceId),
				),
			)
			.returning();

		return result[0] ?? null;
	});
}
