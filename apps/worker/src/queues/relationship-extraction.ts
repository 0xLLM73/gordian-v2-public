import type { SealedEnvelope } from '@repo/crypto';
import {
	createConnection,
	createIntroduction,
	createRelationship,
	getMemoriesByContact,
	getMessagesByContact,
	getWorkspaceIntroKeywords,
	searchContactByName,
} from '@repo/db';
import { Queue, Worker } from 'bullmq';
import { detectConnections, hasConnectionKeywords } from '../ai/connection-detection';
import { detectIntroductions, hasIntroKeywords } from '../ai/introduction-detection';
import { extractRelationships } from '../ai/relationship-extraction';
import { withRLS } from '../middleware/rls';
import { connection } from '../redis';

/**
 * Relationship Extraction Queue (Phase 13).
 * Triggered after message sync — not scheduled (DragonflyDB doesn't support BullMQ repeat).
 * Fetches entity-masked memories for a contact, extracts relationships via AI,
 * and upserts them into contact_relationships.
 *
 * CRITICAL: Queue prefix MUST be '{ai-flow}' to share hashtag with other AI queues
 * (prevents CROSSSLOT errors on DragonflyDB).
 */

export interface RelationshipExtractionJobData {
	workspaceId: string;
	contactId: string;
	/** Encrypted key envelope — NEVER plaintext keys in job payloads */
	keyEnvelope?: {
		encryptedWrk: string;
		kmsContext: Record<string, string>;
		wrkVersion: number;
	};
}

export const relationshipExtractionQueue = new Queue('relationship-extraction', {
	connection,
	prefix: '{ai-flow}',
	defaultJobOptions: {
		attempts: 2,
		backoff: { type: 'exponential', delay: 10000 },
		removeOnComplete: { count: 100 },
		removeOnFail: { count: 500 },
	},
});

function envelopeFromJob(data: RelationshipExtractionJobData): SealedEnvelope | null {
	if (!data.keyEnvelope) return null;
	return {
		encryptedWrk: Buffer.from(data.keyEnvelope.encryptedWrk, 'base64'),
		kmsContext: data.keyEnvelope.kmsContext,
		wrkVersion: data.keyEnvelope.wrkVersion,
	};
}

export const relationshipExtractionWorker = new Worker<RelationshipExtractionJobData>(
	'relationship-extraction',
	withRLS(async (job) => {
		const { workspaceId, contactId } = job.data;
		const envelope = envelopeFromJob(job.data);

		console.log(
			`[relationship-extraction] Processing contact=${contactId.slice(0, 8)} workspace=${workspaceId.slice(0, 8)}`,
		);

		// 1. Fetch entity-masked memories for this contact
		// Use contentSanitized — already ELM-masked, safe to pass to LLM
		const memories = envelope
			? await getMemoriesByContact(workspaceId, contactId, envelope, { limit: 20 })
			: [];

		const sanitizedContent = memories
			.map((m) => m.contentSanitized)
			.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
			.join('\n\n');

		// 2. Skip if no usable content
		if (!sanitizedContent) {
			console.log(
				`[relationship-extraction] No sanitized memories for contact=${contactId.slice(0, 8)}, skipping`,
			);
			return;
		}

		// 3. Extract relationships via AI
		const extracted = await extractRelationships(sanitizedContent);

		// 4. Resolve pseudonym names back to contact IDs via blind-index lookup
		// entity-masked names (e.g. PERSON_a1b2) won't match — we skip unresolvable names
		if (!envelope) {
			console.warn(
				`[relationship-extraction] No envelope for contact=${contactId.slice(0, 8)}, skipping DB writes`,
			);
			return;
		}

		// Fetch recent message IDs for this contact — used as sourceMessageIds for intro/connection records
		const recentMessages = await getMessagesByContact(workspaceId, contactId, envelope, {
			limit: 20,
		});
		const sourceMessageIds = recentMessages.map((m) => m.id);

		if (extracted.length === 0) {
			console.log(
				`[relationship-extraction] No relationships found for contact=${contactId.slice(0, 8)}`,
			);
		} else {
			console.log(
				`[relationship-extraction] Found ${extracted.length} relationships for contact=${contactId.slice(0, 8)}`,
			);

			let upserted = 0;
			for (const rel of extracted) {
				// Attempt to resolve source and target names to real contact IDs
				const [sourceCandidates, targetCandidates] = await Promise.all([
					searchContactByName(workspaceId, rel.source_name, envelope).catch(() => []),
					searchContactByName(workspaceId, rel.target_name, envelope).catch(() => []),
				]);

				const sourceContact = sourceCandidates[0];
				const targetContact = targetCandidates[0];

				if (!sourceContact || !targetContact) continue;
				if (sourceContact.id === targetContact.id) continue;

				try {
					await createRelationship(
						workspaceId,
						{
							sourceContactId: sourceContact.id,
							targetContactId: targetContact.id,
							relationshipType: rel.relationship_type as Parameters<
								typeof createRelationship
							>[1]['relationshipType'],
							strength: rel.strength_estimate,
							source: 'ai_extracted',
							evidence: { reasoning: rel.reasoning },
						},
						envelope,
					);
					upserted++;
				} catch (err) {
					console.error(
						`[relationship-extraction] Failed to upsert relationship: ${(err as Error).message}`,
					);
				}
			}

			console.log(
				`[relationship-extraction] Upserted ${upserted}/${extracted.length} relationships for contact=${contactId.slice(0, 8)}`,
			);
		}

		// 5. Introduction detection — post-step (Phase 16)
		// Keyword pre-filter: merge workspace-level custom keywords with built-in defaults
		const customKeywords = await getWorkspaceIntroKeywords(workspaceId);
		if (hasIntroKeywords(sanitizedContent, customKeywords)) {
			try {
				const intros = await detectIntroductions(sanitizedContent);
				for (const intro of intros) {
					if (intro.confidence < 0.3) continue;

					// Resolve pseudonym names to contact IDs
					const [introducerCandidates, intro1Candidates, intro2Candidates] = await Promise.all([
						searchContactByName(workspaceId, intro.introducer_name, envelope).catch(() => []),
						searchContactByName(workspaceId, intro.introduced_name_1, envelope).catch(() => []),
						searchContactByName(workspaceId, intro.introduced_name_2, envelope).catch(() => []),
					]);

					const introducer = introducerCandidates[0];
					const person1 = intro1Candidates[0];
					const person2 = intro2Candidates[0];

					if (!introducer || !person1 || !person2) continue;
					if (new Set([introducer.id, person1.id, person2.id]).size < 3) continue;

					try {
						const autoConfirm = intro.confidence > 0.9;
						await createIntroduction(
							workspaceId,
							{
								introducerContactId: introducer.id,
								introducedContactId1: person1.id,
								introducedContactId2: person2.id,
								context: intro.context,
								confidence: intro.confidence,
								reasoning: intro.reasoning,
								sourceMessageIds,
								status: autoConfirm ? 'active' : 'triage',
								autoConfirmed: autoConfirm,
							},
							envelope,
						);
						console.log(
							`[relationship-extraction] Detected introduction by ${introducer.id.slice(0, 8)}`,
						);
					} catch (err) {
						console.error(
							`[relationship-extraction] Failed to create introduction: ${(err as Error).message}`,
						);
					}
				}
			} catch (err) {
				console.error(
					`[relationship-extraction] Introduction detection error: ${(err as Error).message}`,
				);
			}
		}

		// 6. New connection detection — post-step
		// Detects 2-person first-meeting signals (e.g., "great to meet you at ETHDenver")
		if (hasConnectionKeywords(sanitizedContent)) {
			try {
				const detected = await detectConnections(sanitizedContent);
				for (const conn of detected) {
					if (conn.confidence < 0.3) continue;

					// Try to resolve the masked name to a contact ID.
					// In DMs, entity masking makes this impossible — fall back to the job's contactId
					// since the conversation is between the user and this specific contact.
					let resolvedContactId = contactId;
					const candidates = await searchContactByName(
						workspaceId,
						conn.contact_name,
						envelope,
					).catch(() => []);
					if (candidates[0]) {
						resolvedContactId = candidates[0].id;
					}

					try {
						await createConnection(
							workspaceId,
							{
								contactId: resolvedContactId,
								event: conn.event,
								context: conn.context,
								confidence: conn.confidence,
								reasoning: conn.reasoning,
								sourceMessageIds,
							},
							envelope,
						);
						console.log(
							`[relationship-extraction] Detected new connection with ${resolvedContactId.slice(0, 8)}`,
						);
					} catch (err) {
						console.error(
							`[relationship-extraction] Failed to create connection: ${(err as Error).message}`,
						);
					}
				}
			} catch (err) {
				console.error(
					`[relationship-extraction] Connection detection error: ${(err as Error).message}`,
				);
			}
		}
	}),
	{
		connection,
		prefix: '{ai-flow}',
		concurrency: 1, // Low priority, not time-sensitive
	},
);
