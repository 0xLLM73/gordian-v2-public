import {
	type ContactMaskEntity,
	type SealedEnvelope,
	decrypt,
	deriveKeys,
	maskContactAliases,
	unwrapWrk,
} from '@repo/crypto';
import {
	createConnection,
	createIntroduction,
	createRelationship,
	getMemoriesByContact,
	getWorkspaceIntroKeywords,
	hasUserAiAnalysisConsent,
	listContactMaskingAliases,
	searchContactByName,
} from '@repo/db';
import type { ContactMaskingAlias } from '@repo/db';
import { redactSensitive } from '@repo/shared';
import { Queue, Worker } from 'bullmq';
import { detectConnections, hasConnectionKeywords } from '../ai/connection-detection';
import {
	type DetectedIntroduction,
	detectIntroductions,
	hasIntroKeywords,
} from '../ai/introduction-detection';
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
	userId?: string;
	sourceAccountId?: string;
	contactId?: string;
	chatId?: string;
	chatType?: 'private' | 'group' | 'supergroup' | 'channel';
	messages?: Array<{
		role: string;
		content: string;
		timestamp: string;
		sourceMessageId?: string;
		chatId?: string;
		contactId?: string;
	}>;
	workspaceSalt?: string;
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
		removeOnComplete: true,
		removeOnFail: { count: 50, age: 3600 },
	},
});

type FreshBatchContext = {
	content: string;
	keywordContent: string;
	sourceMessageIds: string[];
	aliasToContactId: Map<string, string>;
};

function envelopeFromJob(data: RelationshipExtractionJobData): SealedEnvelope | null {
	if (!data.keyEnvelope) return null;
	return {
		encryptedWrk: Buffer.from(data.keyEnvelope.encryptedWrk, 'base64'),
		kmsContext: data.keyEnvelope.kmsContext,
		wrkVersion: data.keyEnvelope.wrkVersion,
	};
}

function short(value: string | undefined): string {
	return value ? value.slice(0, 8) : 'none';
}

function jobTargetLabel(data: RelationshipExtractionJobData): string {
	if (data.contactId) return `contact=${short(data.contactId)}`;
	if (data.chatId) return `chat=${short(data.chatId)}`;
	return 'batch=unknown';
}

function uniqueStrings(values: Array<string | undefined>): string[] {
	return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function normalizedName(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

const PERSON_STOP_WORDS = new Set([
	'Add',
	'Added',
	'Adding',
	'Also',
	'And',
	'Can',
	'Cc',
	'Connect',
	'Connected',
	'Connecting',
	'For',
	'Forwarded',
	'Forwarding',
	'General',
	'Hey',
	'I',
	'In',
	'Introduce',
	'Introduces',
	'Introducing',
	'Intro',
	'Let',
	'Loop',
	'Meet',
	'No',
	'Put',
	'Putting',
	'Reach',
	'The',
	'This',
	'Touch',
	'Yes',
]);

function shouldPreservePersonLikeToken(match: string, extraPhrases: string[]): boolean {
	const normalized = match.toLowerCase();
	if (extraPhrases.includes(normalized)) return true;
	return match.split(/\s+/).every((word) => PERSON_STOP_WORDS.has(word));
}

function maskUnresolvedPersonLikeTokens(text: string, extraPhrases: string[] = []): string {
	const replacements = new Map<string, string>();
	return text.replace(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g, (match) => {
		if (shouldPreservePersonLikeToken(match, extraPhrases)) return match;
		const replacement = replacements.get(match) ?? `PERSON_UNMAPPED_${replacements.size + 1}`;
		replacements.set(match, replacement);
		return replacement;
	});
}

function maskUnresolvedUsernames(text: string): string {
	const replacements = new Map<string, string>();
	return text.replace(/(?<![A-Za-z0-9_])@[A-Za-z][A-Za-z0-9_]{1,31}\b/g, (match) => {
		const replacement =
			replacements.get(match) ?? `PERSON_UNMAPPED_HANDLE_${replacements.size + 1}`;
		replacements.set(match, replacement);
		return replacement;
	});
}

function toContactMaskEntity(contact: ContactMaskingAlias): ContactMaskEntity {
	const firstName = normalizedName(contact.firstName);
	const lastName = normalizedName(contact.lastName);
	return {
		contactId: contact.id,
		firstName,
		lastName,
		fullName: firstName && lastName ? `${firstName} ${lastName}` : undefined,
		username: normalizedName(contact.username),
	};
}

async function buildFreshBatchContext(
	data: RelationshipExtractionJobData,
	workspaceId: string,
	envelope: SealedEnvelope | null,
	customIntroKeywords: string[],
): Promise<FreshBatchContext> {
	if (!data.messages?.length || !envelope || !data.workspaceSalt) {
		return { content: '', keywordContent: '', sourceMessageIds: [], aliasToContactId: new Map() };
	}

	const wrk = await unwrapWrk(envelope);
	const keys = await deriveKeys(wrk, workspaceId, envelope.wrkVersion);
	const salt = Buffer.from(data.workspaceSalt, 'hex');
	const customKeywordPhrases = customIntroKeywords.map((keyword) =>
		keyword.trim().toLowerCase().replace(/\s+/g, ' '),
	);
	const contacts = await listContactMaskingAliases(workspaceId, envelope, {
		limit: 5000,
		sourceAccountId: data.sourceAccountId,
		includeLegacy: Boolean(data.sourceAccountId),
	}).catch(() => []);
	const contactEntities = contacts.map(toContactMaskEntity);
	const aliasToContactId = new Map<string, string>();
	const sourceMessageIds: string[] = [];
	const lines: string[] = [];
	const keywordLines: string[] = [];

	for (const msg of data.messages) {
		if (!msg.sourceMessageId) continue;

		const plaintext = decrypt(msg.content, keys.dek).trim();
		if (!plaintext) continue;

		const { maskedText, aliasMap } = maskContactAliases(plaintext, salt, contactEntities, {
			maskFirstNames: true,
			maskLastNames: true,
		});
		for (const alias of aliasMap) {
			aliasToContactId.set(alias.pseudonym, alias.contactId);
		}
		const usernameMaskedText = maskUnresolvedUsernames(maskedText);
		const redactedText = maskUnresolvedPersonLikeTokens(usernameMaskedText, customKeywordPhrases);
		sourceMessageIds.push(msg.sourceMessageId);
		lines.push(`[source:${msg.sourceMessageId}] [${msg.role}] ${redactedText}`);
		keywordLines.push(`[source:${msg.sourceMessageId}] [${msg.role}] ${usernameMaskedText}`);
	}

	return {
		content: lines.join('\n'),
		keywordContent: keywordLines.join('\n'),
		sourceMessageIds: [...new Set(sourceMessageIds)],
		aliasToContactId,
	};
}

function selectIntroSourceMessageIds(
	intro: { source_message_ids?: string[] },
	freshSourceMessageIds: string[],
): string[] | undefined {
	if (freshSourceMessageIds.length === 0) return undefined;

	const allowed = new Set(freshSourceMessageIds);
	const requested = [...new Set(intro.source_message_ids ?? [])];
	const selected = requested.filter((id) => allowed.has(id));
	if (requested.length > 0) return selected.length > 0 ? selected : undefined;
	return undefined;
}

function sourceMessageIdsOrUndefined(sourceMessageIds: string[]): string[] | undefined {
	return sourceMessageIds.length > 0 ? sourceMessageIds : undefined;
}

function isPseudonymRef(value: string): boolean {
	return /^(?:CONTACT|PERSON|ORG|EMAIL|PHONE|MONEY|ADDRESS)_[A-Za-z0-9_]+$/.test(value);
}

function introParticipantRefs(
	intro: DetectedIntroduction,
	role: 'introducer' | 'introduced1' | 'introduced2',
): string[] {
	if (role === 'introducer') return uniqueStrings([intro.introducer_ref, intro.introducer_name]);
	if (role === 'introduced1')
		return uniqueStrings([intro.introduced_ref_1, intro.introduced_name_1]);
	return uniqueStrings([intro.introduced_ref_2, intro.introduced_name_2]);
}

async function resolveIntroContactId(
	workspaceId: string,
	intro: DetectedIntroduction,
	role: 'introducer' | 'introduced1' | 'introduced2',
	aliasToContactId: Map<string, string>,
	envelope: SealedEnvelope,
): Promise<string | undefined> {
	const refs = introParticipantRefs(intro, role);
	for (const ref of refs) {
		const contactId = aliasToContactId.get(ref);
		if (contactId) return contactId;
	}

	if (aliasToContactId.size > 0) return undefined;

	const legacyName = refs.find((ref) => !isPseudonymRef(ref));
	if (!legacyName) return undefined;

	const candidates = await searchContactByName(workspaceId, legacyName, envelope).catch(() => []);
	return candidates[0]?.id;
}

export const relationshipExtractionWorker = new Worker<RelationshipExtractionJobData>(
	'relationship-extraction',
	withRLS(async (job) => {
		const { workspaceId, contactId, userId } = job.data;
		const envelope = envelopeFromJob(job.data);
		const targetLabel = jobTargetLabel(job.data);

		if (!userId && job.data.messages?.length) {
			console.warn(
				`[relationship-extraction] Missing userId on fresh encrypted batch for ${targetLabel}, skipping`,
			);
			return { skipped: true, reason: 'missing_user_id' };
		}
		if (userId && !(await hasUserAiAnalysisConsent(userId, workspaceId))) {
			console.log(
				`[relationship-extraction] AI consent no longer persisted for workspace=${workspaceId.slice(0, 8)} user=${userId.slice(0, 8)}, skipping`,
			);
			return { skipped: true, reason: 'no_ai_consent' };
		}

		console.log(
			`[relationship-extraction] Processing ${targetLabel} workspace=${workspaceId.slice(0, 8)}`,
		);

		// 1. Fetch entity-masked memories for this contact
		// Use contentSanitized — already ELM-masked, safe to pass to LLM
		const memories =
			envelope && contactId
				? await getMemoriesByContact(workspaceId, contactId, envelope, { limit: 20 })
				: [];

		const sanitizedContent = memories
			.map((m) => m.contentSanitized)
			.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
			.join('\n\n');
		const customKeywords = await getWorkspaceIntroKeywords(workspaceId);
		const freshBatch = await buildFreshBatchContext(
			job.data,
			workspaceId,
			envelope,
			customKeywords,
		);

		// 2. Skip if no usable content
		if (!sanitizedContent && !freshBatch.content) {
			console.log(`[relationship-extraction] No sanitized content for ${targetLabel}, skipping`);
			return;
		}

		// 3. Extract relationships via AI
		const extracted = sanitizedContent ? await extractRelationships(sanitizedContent) : [];

		// 4. Resolve pseudonym names back to contact IDs via blind-index lookup
		// entity-masked names (e.g. PERSON_a1b2) won't match — we skip unresolvable names
		if (!envelope) {
			console.warn(`[relationship-extraction] No envelope for ${targetLabel}, skipping DB writes`);
			return;
		}

		if (extracted.length === 0) {
			console.log(`[relationship-extraction] No relationships found for ${targetLabel}`);
		} else {
			console.log(
				`[relationship-extraction] Found ${extracted.length} relationships for ${targetLabel}`,
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
						'[relationship-extraction] Failed to upsert relationship:',
						redactSensitive(err),
					);
				}
			}

			console.log(
				`[relationship-extraction] Upserted ${upserted}/${extracted.length} relationships for ${targetLabel}`,
			);
		}

		// 5. Introduction detection — post-step (Phase 16)
		// Keyword pre-filter: merge workspace-level custom keywords with built-in defaults
		const introductionContent = freshBatch.content || sanitizedContent;
		const keywordContent = freshBatch.keywordContent || introductionContent;
		if (hasIntroKeywords(keywordContent, customKeywords)) {
			try {
				const intros = await detectIntroductions(introductionContent);
				for (const intro of intros) {
					if (intro.confidence < 0.3) continue;

					const [introducerId, person1Id, person2Id] = await Promise.all([
						resolveIntroContactId(
							workspaceId,
							intro,
							'introducer',
							freshBatch.aliasToContactId,
							envelope,
						),
						resolveIntroContactId(
							workspaceId,
							intro,
							'introduced1',
							freshBatch.aliasToContactId,
							envelope,
						),
						resolveIntroContactId(
							workspaceId,
							intro,
							'introduced2',
							freshBatch.aliasToContactId,
							envelope,
						),
					]);

					if (!introducerId || !person1Id || !person2Id) continue;
					if (new Set([introducerId, person1Id, person2Id]).size < 3) continue;

					try {
						const autoConfirm = intro.confidence > 0.9;
						const sourceMessageIds = selectIntroSourceMessageIds(
							intro,
							freshBatch.sourceMessageIds,
						);
						await createIntroduction(
							workspaceId,
							{
								introducerContactId: introducerId,
								introducedContactId1: person1Id,
								introducedContactId2: person2Id,
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
							`[relationship-extraction] Detected introduction by ${introducerId.slice(0, 8)}`,
						);
					} catch (err) {
						console.error(
							'[relationship-extraction] Failed to create introduction:',
							redactSensitive(err),
						);
					}
				}
			} catch (err) {
				console.error(
					'[relationship-extraction] Introduction detection error:',
					redactSensitive(err),
				);
			}
		}

		// 6. New connection detection — post-step
		// Detects 2-person first-meeting signals (e.g., "great to meet you at ETHDenver")
		if (contactId && hasConnectionKeywords(sanitizedContent)) {
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
								sourceMessageIds: sourceMessageIdsOrUndefined(freshBatch.sourceMessageIds),
							},
							envelope,
						);
						console.log(
							`[relationship-extraction] Detected new connection with ${resolvedContactId.slice(0, 8)}`,
						);
					} catch (err) {
						console.error(
							'[relationship-extraction] Failed to create connection:',
							redactSensitive(err),
						);
					}
				}
			} catch (err) {
				console.error(
					'[relationship-extraction] Connection detection error:',
					redactSensitive(err),
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
