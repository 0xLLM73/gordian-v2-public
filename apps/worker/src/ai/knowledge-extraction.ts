import type { SealedEnvelope } from '@repo/crypto';
import { maskEntities } from '@repo/crypto';
import {
	createKnowledgeNode,
	findNodeByAlias,
	findNodeByNameAnyType,
	getExtractionLog,
	incrementNodeMentionCount,
	linkContactToKnowledge,
	searchKnowledgeNodes,
	upsertExtractionLog,
} from '@repo/db';
import {
	getKnowledgeEmbeddingFingerprint,
	isKnowledgeLlmEnabled,
	knowledgeEmbeddingFingerprintKey,
} from '@repo/shared';
import { generateEmbeddingCached, generateEmbeddingsCached } from './embeddings';
import { inferKnowledgeEntitiesJson } from './knowledge-llm';
import { prefilterEntities } from './prefilter';

// ─── Constants ────────────────────────────────────────────────────────────────
const EMBEDDING_MATCH_THRESHOLD = 0.8;
const COSINE_DEDUP_THRESHOLD = 0.75;
const fingerprintWarnings = new Set<string>();

export interface KnowledgeExtractionMessage {
	id?: string;
	text: string;
	timestamp?: string | Date;
}

type KnowledgeExtractionInput = string | KnowledgeExtractionMessage;

function currentEmbeddingMetadata(): Record<string, unknown> {
	const embeddingFingerprint = getKnowledgeEmbeddingFingerprint(process.env);
	return {
		embeddingFingerprint,
		embeddingFingerprintKey: knowledgeEmbeddingFingerprintKey(embeddingFingerprint),
	};
}

function warnIfEmbeddingFingerprintChanged(
	source: string,
	node: { id: string; metadata?: Record<string, unknown> | null },
): void {
	const previous = node.metadata?.embeddingFingerprintKey;
	if (typeof previous !== 'string') return;

	const current = knowledgeEmbeddingFingerprintKey(getKnowledgeEmbeddingFingerprint(process.env));
	if (previous === current) return;

	const warningKey = `${source}:${previous}:${current}`;
	if (fingerprintWarnings.has(warningKey)) return;
	fingerprintWarnings.add(warningKey);
	console.warn(
		`[knowledge-extraction] Embedding fingerprint mismatch in ${source}: existing node ${node.id.slice(0, 8)} was embedded with "${previous}", active runtime is "${current}". Re-embed the knowledge graph before trusting semantic match quality.`,
	);
}

export interface NormalizedKnowledgeMessage {
	id?: string;
	text: string;
	occurredAt?: Date;
}

function normalizeKnowledgeMessages(
	messages: KnowledgeExtractionInput[],
): NormalizedKnowledgeMessage[] {
	return messages
		.map((message) => {
			if (typeof message === 'string') {
				return { text: message };
			}
			const occurredAt =
				message.timestamp instanceof Date
					? message.timestamp
					: message.timestamp
						? new Date(message.timestamp)
						: undefined;
			return {
				id: message.id,
				text: message.text,
				occurredAt: occurredAt && !Number.isNaN(occurredAt.getTime()) ? occurredAt : undefined,
			};
		})
		.filter((message) => message.text.length > 0);
}

function latestMessageHorizon(messages: NormalizedKnowledgeMessage[]): Date | undefined {
	let latest: Date | undefined;
	for (const message of messages) {
		if (!message.occurredAt) continue;
		if (!latest || message.occurredAt > latest) latest = message.occurredAt;
	}
	return latest;
}

export interface EvidenceSelectableEntity {
	name: string;
	displayName: string;
	aliases?: string[];
	sourceMention?: string;
	mentionSpan?: string;
	evidenceQuote?: string;
}

export interface EvidenceSourceSelection {
	message?: NormalizedKnowledgeMessage;
	method:
		| 'exact_normalized_name'
		| 'exact_display_name'
		| 'alias_match'
		| 'mention_span'
		| 'heuristic_latest_mention'
		| 'fallback_latest';
	matchedTerm?: string;
}

export function evidenceSourceSelectionMetadata(selection: EvidenceSourceSelection): {
	method: EvidenceSourceSelection['method'];
	sourceBacked: boolean;
} {
	return { method: selection.method, sourceBacked: evidenceSelectionHasDirectSource(selection) };
}

export function evidenceSelectionHasDirectSource(selection: EvidenceSourceSelection): boolean {
	return selection.method !== 'fallback_latest' && !!selection.message;
}

export function buildKnowledgeEvidenceFromSelection(
	entity: EvidenceSelectableEntity & {
		type?: string;
		confidence?: number | null;
	},
	selection: EvidenceSourceSelection,
	source: string,
	envelope: SealedEnvelope,
) {
	const sourceBacked = evidenceSelectionHasDirectSource(selection);
	const evidenceMessage = sourceBacked ? selection.message : undefined;
	return {
		messageId: evidenceMessage?.id,
		snippet: evidenceMessage?.text.slice(0, 1000),
		occurredAt: evidenceMessage?.occurredAt,
		evidenceKind: sourceBacked ? ('llm_extracted' as const) : ('inferred_weak' as const),
		confidence: entity.confidence ?? null,
		metadata: {
			source,
			entityType: entity.type,
			sourceMessageSelection: evidenceSourceSelectionMetadata(selection),
		},
		envelope,
	};
}

function selectEvidenceForExistingNode(
	node: {
		name: string;
		displayName?: string | null;
		aliases?: string[] | null;
	},
	messages: NormalizedKnowledgeMessage[],
): EvidenceSourceSelection {
	return selectEvidenceMessage(
		{
			name: node.name,
			displayName: node.displayName ?? node.name,
			aliases: node.aliases ?? [],
		},
		messages,
	);
}

function normalizeForEvidenceMatch(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

function findLatestMessageContaining(
	messages: NormalizedKnowledgeMessage[],
	term: string,
): NormalizedKnowledgeMessage | undefined {
	const normalizedTerm = normalizeForEvidenceMatch(term);
	if (!normalizedTerm) return undefined;
	return messages
		.slice()
		.reverse()
		.find((message) => normalizeForEvidenceMatch(message.text).includes(normalizedTerm));
}

export function selectEvidenceMessage(
	entity: EvidenceSelectableEntity,
	messages: NormalizedKnowledgeMessage[],
): EvidenceSourceSelection {
	const normalizedName = entity.name.toLowerCase().trim();
	const nameMatch = findLatestMessageContaining(messages, normalizedName);
	if (nameMatch) {
		return { message: nameMatch, method: 'exact_normalized_name', matchedTerm: normalizedName };
	}

	const displayName = entity.displayName.trim();
	if (displayName && displayName.toLowerCase() !== normalizedName) {
		const displayMatch = findLatestMessageContaining(messages, displayName);
		if (displayMatch) {
			return { message: displayMatch, method: 'exact_display_name', matchedTerm: displayName };
		}
	}

	for (const alias of entity.aliases ?? []) {
		const aliasMatch = findLatestMessageContaining(messages, alias);
		if (aliasMatch) {
			return { message: aliasMatch, method: 'alias_match', matchedTerm: alias };
		}
	}

	for (const mention of [entity.sourceMention, entity.mentionSpan, entity.evidenceQuote]) {
		if (!mention) continue;
		const mentionMatch = findLatestMessageContaining(messages, mention);
		if (mentionMatch) {
			return { message: mentionMatch, method: 'mention_span', matchedTerm: mention };
		}
	}

	const heuristicTerms = [normalizedName, displayName, ...(entity.aliases ?? [])].filter(Boolean);
	const heuristicMatch =
		messages
			.slice()
			.reverse()
			.find((message) => {
				const text = normalizeForEvidenceMatch(message.text);
				return heuristicTerms.some((term) => {
					const normalizedTerm = normalizeForEvidenceMatch(term);
					return normalizedTerm.length >= 3 && text.includes(normalizedTerm);
				});
			}) ?? undefined;

	if (heuristicMatch) {
		return { message: heuristicMatch, method: 'heuristic_latest_mention' };
	}

	return { message: messages[messages.length - 1], method: 'fallback_latest' };
}

// ─── Keyword pre-filter ───────────────────────────────────────────────────────

const KNOWLEDGE_KEYWORDS = [
	// crypto / web3
	'invest',
	'fund',
	'raise',
	'token',
	'protocol',
	'chain',
	'defi',
	'nft',
	'dao',
	'seed',
	'portfolio',
	'allocate',
	'exchange',
	// general business / tech
	'project',
	'build',
	'launch',
	'partnership',
	'deal',
	'close',
	'round',
	'series',
	'thesis',
	'sector',
	'ecosystem',
	'technology',
	'platform',
	'company',
	'startup',
	'product',
	'software',
	'team',
	'hiring',
	'engineer',
	'design',
	'market',
	'strategy',
	'research',
	'conference',
	'event',
	'community',
	'network',
	'industry',
];

/**
 * Fast pre-filter before hitting the LLM.
 * Returns true (proceed) if messages contain at least 1 keyword match.
 * Avoids LLM calls on purely social chit-chat with zero domain signal.
 */
export function keywordPreFilter(messages: string[]): boolean {
	const combined = messages.join(' ').toLowerCase();
	for (const keyword of KNOWLEDGE_KEYWORDS) {
		if (combined.includes(keyword)) return true;
	}
	return false;
}

// ─── Embedding-first matcher ──────────────────────────────────────────────────

/**
 * Try to match a contact's messages against existing knowledge nodes
 * using per-message embedding similarity — no LLM needed.
 *
 * DESIGN: Embeds up to 10 individual messages (not a concatenated blob).
 * Short message ↔ short entity name produces aligned vectors.
 * A 30-message blob embedding is diluted across multiple topics and
 * will rarely exceed 0.80 similarity with a single-word entity.
 *
 * Deduplicates linked nodes within a single pass (prevents the same
 * node from being linked 10 times if mentioned in 10 messages).
 *
 * @returns Number of unique nodes linked.
 */
async function embeddingFirstMatch(
	messages: NormalizedKnowledgeMessage[],
	contactId: string,
	workspaceId: string,
	workspaceSalt: Buffer,
	envelope: SealedEnvelope,
): Promise<number> {
	// Take the last 10 messages that are long enough to be meaningful
	const candidates = messages
		.slice(-20)
		.filter((m) => m.text.length >= 30)
		.slice(-10);

	if (candidates.length === 0) return 0;

	// Track which nodes we've already linked in this pass
	const linkedNodeIds = new Set<string>();

	const maskedCandidates = candidates.map((message) => {
		const chunk = message.text.slice(0, 500);
		const detected = prefilterEntities(chunk);
		const { maskedText } = maskEntities(chunk, workspaceSalt, detected);
		return { message, chunk, maskedText };
	});

	const embeddings = await generateEmbeddingsCached(
		maskedCandidates.map((item) => item.maskedText),
		{ purpose: 'document' },
	);

	for (const embeddingResult of embeddings) {
		try {
			const candidate = maskedCandidates[embeddingResult.index];
			if (!candidate) continue;
			const matches = await searchKnowledgeNodes(
				workspaceId,
				'',
				embeddingResult.embedding,
				envelope,
			);

			for (const match of matches) {
				warnIfEmbeddingFingerprintChanged('embedding_first_match', match);
				if (linkedNodeIds.has(match.id)) continue;
				const sim = match.similarity ?? 0;
				if (sim >= EMBEDDING_MATCH_THRESHOLD) {
					await linkContactToKnowledge(workspaceId, match.id, contactId, 'knows_about', sim, {
						messageId: candidate.message.id,
						snippet: candidate.chunk,
						occurredAt: candidate.message.occurredAt,
						evidenceKind: 'embedding_match',
						confidence: sim,
						metadata: {
							source: 'embedding_first_match',
							similarity: sim,
							threshold: EMBEDDING_MATCH_THRESHOLD,
							sourceMessageSelection: {
								method: 'per_message_embedding_candidate',
							},
						},
						envelope,
					});
					await incrementNodeMentionCount(workspaceId, match.id);
					linkedNodeIds.add(match.id);
					console.log(
						`[knowledge-extraction] Embedding match: "${match.name}" (sim=${sim.toFixed(3)}) for contact=${contactId.slice(0, 8)}`,
					);
				}
			}
		} catch (err) {
			// Per-message error resilience — one failed embedding doesn't abort the pass
			console.error('[knowledge-extraction] Per-message embedding failed:', (err as Error).message);
		}
	}

	return linkedNodeIds.size;
}

// ─── LLM extraction (configured KG provider) ─────────────────────────────────

const KNOWLEDGE_SYSTEM_PROMPT = `You are extracting structured knowledge entities from Telegram messages.
Identify topics, projects, organizations, technologies, market sectors, and concepts
that this contact is knowledgeable about, working on, or interested in.

IMPORTANT naming rules:
- Use short, canonical names that others would also use (e.g., "Solana" not "Solana ecosystem projects").
- Prefer the widely-recognized proper noun (e.g., "Ethereum", "Y Combinator", "React").
- For broader topics use 1-3 word labels (e.g., "DeFi", "AI infrastructure", "venture capital").
- Never add qualifiers like "ecosystem", "space", "industry", "community" unless they are part of the proper name.

Only extract entities with clear evidence in the messages.
Do not include personal names, phone numbers, Telegram usernames, or any contact-identifying information in entity names or descriptions.`;

/** JSON extraction prompt — instructs the selected KG model to output structured JSON. */
const GEMINI_EXTRACTION_PROMPT = `${KNOWLEDGE_SYSTEM_PROMPT}

Respond with ONLY a JSON object containing an "entities" array. Each entity must have:
- type: one of "topic", "project", "organization", "technology", "sector", "concept"
- name: short canonical lowercase name for deduplication (e.g., "solana", "defi")
- displayName: original casing for display
- description: 1-sentence description
- relationshipType: one of "knows_about", "works_on", "member_of", "expert_in", "uses", "invested_in", "interested_in"
- confidence: number 0.0-1.0 based on evidence strength
- sourceMention: optional exact short phrase from the source message that supports the entity

Example: {"entities": [{"type": "technology", "name": "solana", "displayName": "Solana", "description": "Layer 1 blockchain", "relationshipType": "works_on", "confidence": 0.9}]}`;

/**
 * LLM-based entity extraction using the configured KG provider.
 * Returns the number of entities extracted and linked.
 */
async function llmExtractEntities(
	messages: NormalizedKnowledgeMessage[],
	contactId: string,
	workspaceId: string,
	workspaceSalt: Buffer,
	envelope: SealedEnvelope,
): Promise<number> {
	const maskedMessages = messages.slice(-50).map((m) => {
		const detected = prefilterEntities(m.text);
		return maskEntities(m.text, workspaceSalt, detected).maskedText;
	});
	const userPrompt = `Extract knowledge entities from these messages:\n\n${maskedMessages.join('\n')}`;

	const inference = await inferKnowledgeEntitiesJson({
		systemPrompt: GEMINI_EXTRACTION_PROMPT,
		userPrompt,
	});

	const entities = inference.entities;

	let linked = 0;

	for (const entity of entities) {
		try {
			const normalizedName = entity.name.toLowerCase();
			const evidenceSelection = selectEvidenceMessage(entity, messages);
			let evidence = buildKnowledgeEvidenceFromSelection(
				entity,
				evidenceSelection,
				inference.source,
				envelope,
			);

			// Cross-type dedup: check if this name exists under ANY type
			const existingAnyType = await findNodeByNameAnyType(workspaceId, normalizedName, envelope);

			if (existingAnyType) {
				// Reuse the existing node regardless of type mismatch
				await incrementNodeMentionCount(workspaceId, existingAnyType.id);
				await linkContactToKnowledge(
					workspaceId,
					existingAnyType.id,
					contactId,
					entity.relationshipType,
					entity.confidence,
					evidence,
				);
				linked++;
				console.log(
					`[knowledge-extraction] Cross-type reuse: "${existingAnyType.name}" (existing type=${existingAnyType.type}, proposed type=${entity.type})`,
				);
				continue; // Skip embedding dedup and creation
			}

			// Alias check: prevent re-creating nodes that were previously merged
			const aliasMatch = await findNodeByAlias(workspaceId, normalizedName, envelope);
			if (aliasMatch) {
				await incrementNodeMentionCount(workspaceId, aliasMatch.id);
				await linkContactToKnowledge(
					workspaceId,
					aliasMatch.id,
					contactId,
					entity.relationshipType,
					entity.confidence,
					evidence,
				);
				linked++;
				console.log(
					`[knowledge-extraction] Alias match: "${normalizedName}" → "${aliasMatch.name}" for contact=${contactId.slice(0, 8)}`,
				);
				continue;
			}

			// Composite embedding input (Upgrade 7)
			const rawEmbeddingInput = entity.description
				? `Type: ${entity.type} | Name: ${entity.displayName} | Context: ${entity.description}`
				: `Type: ${entity.type} | Name: ${entity.displayName}`;
			const embDetected = prefilterEntities(rawEmbeddingInput);
			const { maskedText: embeddingInput } = maskEntities(
				rawEmbeddingInput,
				workspaceSalt,
				embDetected,
			);
			const embedding = await generateEmbeddingCached(embeddingInput, { purpose: 'dedup' });
			const candidates = await searchKnowledgeNodes(
				workspaceId,
				normalizedName,
				embedding,
				envelope,
			);

			let nodeId: string;
			const closest = candidates[0];

			if (closest?.similarity !== undefined) {
				warnIfEmbeddingFingerprintChanged('llm_dedup', closest);
				const sim = closest.similarity;
				const matchedNodeEvidenceSelection = selectEvidenceForExistingNode(closest, messages);
				if (
					sim > COSINE_DEDUP_THRESHOLD &&
					evidenceSelectionHasDirectSource(matchedNodeEvidenceSelection)
				) {
					nodeId = closest.id;
					evidence = buildKnowledgeEvidenceFromSelection(
						{
							name: closest.name,
							displayName: closest.displayName,
							aliases: closest.aliases ?? [],
							type: closest.type,
							confidence: entity.confidence,
						},
						matchedNodeEvidenceSelection,
						inference.source,
						envelope,
					);
					await incrementNodeMentionCount(workspaceId, nodeId);
					console.log(
						`[knowledge-extraction] Reusing node "${closest.name}" (similarity=${sim.toFixed(3)})`,
					);
				} else {
					const node = await createKnowledgeNode(
						workspaceId,
						{
							type: entity.type,
							name: normalizedName,
							displayName: entity.displayName,
							description: entity.description,
							embedding,
							metadata: currentEmbeddingMetadata(),
						},
						envelope,
					);
					nodeId = node.id;
				}
			} else {
				const node = await createKnowledgeNode(
					workspaceId,
					{
						type: entity.type,
						name: normalizedName,
						displayName: entity.displayName,
						description: entity.description,
						embedding,
						metadata: currentEmbeddingMetadata(),
					},
					envelope,
				);
				nodeId = node.id;
			}

			await linkContactToKnowledge(
				workspaceId,
				nodeId,
				contactId,
				entity.relationshipType,
				entity.confidence,
				evidence,
			);
			linked++;
		} catch (err) {
			console.error(
				`[knowledge-extraction] Failed to process entity "${entity.name}":`,
				(err as Error).message,
			);
		}
	}

	return linked;
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

/**
 * Cost-optimized knowledge extraction pipeline:
 *
 * 1. Staleness check — skip if no new messages since last extraction
 * 2. Keyword pre-filter — skip if no domain signal
 * 3. Embedding-first match — link to existing nodes without LLM (free)
 * 4. LLM extraction via the configured KG model — discover new entities
 * 5. Record extraction in log for future staleness checks
 *
 * Cost hierarchy: skip (free) > embedding match > configured KG model
 */
export async function extractKnowledgeEntities(
	messages: KnowledgeExtractionInput[],
	contactId: string,
	workspaceId: string,
	workspaceSalt: Buffer,
	envelope: SealedEnvelope,
): Promise<void> {
	const normalizedMessages = normalizeKnowledgeMessages(messages);
	const messageTexts = normalizedMessages.map((message) => message.text);
	const messageHorizon = latestMessageHorizon(normalizedMessages);

	// 1. Staleness check — skip if already extracted with no new messages
	const log = await getExtractionLog(workspaceId, contactId);
	if (log?.messageHorizon && messageHorizon && log.messageHorizon >= messageHorizon) {
		console.log('[knowledge-extraction] Already processed this message horizon — skipping');
		return;
	}

	// 2. Keyword pre-filter
	if (!keywordPreFilter(messageTexts)) {
		console.log('[knowledge-extraction] Pre-filter rejected — skipping');
		await upsertExtractionLog(workspaceId, contactId, {
			messageHorizon,
			entitiesExtracted: 0,
			llmCalled: false,
		});
		return;
	}

	// 3. Embedding-first match — try to link without LLM
	let totalLinked = 0;
	try {
		const embeddingMatches = await embeddingFirstMatch(
			normalizedMessages,
			contactId,
			workspaceId,
			workspaceSalt,
			envelope,
		);
		totalLinked += embeddingMatches;
		if (embeddingMatches > 0) {
			console.log(
				`[knowledge-extraction] Embedding-only: ${embeddingMatches} nodes linked for contact=${contactId.slice(0, 8)}`,
			);
		}
	} catch (err) {
		console.error('[knowledge-extraction] Embedding match failed:', (err as Error).message);
	}

	const llmEnabled = isKnowledgeLlmEnabled(process.env);
	if (llmEnabled) {
		try {
			const llmEntities = await llmExtractEntities(
				normalizedMessages,
				contactId,
				workspaceId,
				workspaceSalt,
				envelope,
			);
			totalLinked += llmEntities;
			console.log(
				`[knowledge-extraction] LLM: ${llmEntities} entities for contact=${contactId.slice(0, 8)}`,
			);
		} catch (err) {
			console.error('[knowledge-extraction] LLM extraction failed:', (err as Error).message);
		}
	}

	try {
		await upsertExtractionLog(workspaceId, contactId, {
			messageHorizon,
			entitiesExtracted: totalLinked,
			llmCalled: llmEnabled,
		});
	} catch (err) {
		console.error(
			'[knowledge-extraction] Failed to record extraction log:',
			(err as Error).message,
		);
	}
}

/**
 * Cost-optimized extraction for the nightly cron — uses DB-level staleness
 * check and only calls LLM for contacts that actually need it.
 * Embedding-first matching is always attempted; LLM is gated by budget.
 */
export async function extractKnowledgeForContact(
	messages: KnowledgeExtractionInput[],
	contactId: string,
	workspaceId: string,
	opts: { skipLLM?: boolean; workspaceSalt: Buffer; envelope: SealedEnvelope },
): Promise<{ embeddingMatches: number; llmEntities: number }> {
	let embeddingMatches = 0;
	let llmEntities = 0;
	const normalizedMessages = normalizeKnowledgeMessages(messages);
	const messageTexts = normalizedMessages.map((message) => message.text);
	const messageHorizon = latestMessageHorizon(normalizedMessages);

	if (!keywordPreFilter(messageTexts)) {
		await upsertExtractionLog(workspaceId, contactId, {
			messageHorizon,
			entitiesExtracted: 0,
			llmCalled: false,
		});
		return { embeddingMatches: 0, llmEntities: 0 };
	}

	// Embedding-first match (always)
	try {
		embeddingMatches = await embeddingFirstMatch(
			normalizedMessages,
			contactId,
			workspaceId,
			opts.workspaceSalt,
			opts.envelope,
		);
	} catch (err) {
		console.error('[knowledge-extraction] Embedding match failed:', (err as Error).message);
	}

	// LLM extraction (budget-gated)
	const llmEnabled = isKnowledgeLlmEnabled(process.env);
	if (!opts.skipLLM && llmEnabled) {
		try {
			llmEntities = await llmExtractEntities(
				normalizedMessages,
				contactId,
				workspaceId,
				opts.workspaceSalt,
				opts.envelope,
			);
		} catch (err) {
			console.error('[knowledge-extraction] LLM failed:', (err as Error).message);
		}
	}

	await upsertExtractionLog(workspaceId, contactId, {
		messageHorizon,
		entitiesExtracted: embeddingMatches + llmEntities,
		llmCalled: !opts.skipLLM && llmEnabled,
	});

	return { embeddingMatches, llmEntities };
}
