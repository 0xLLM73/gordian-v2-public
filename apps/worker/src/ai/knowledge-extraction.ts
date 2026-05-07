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
import { generateEmbedding } from './embeddings';
import { inferWithGemini } from './gemini-inference';
import { prefilterEntities } from './prefilter';

// ─── Constants ────────────────────────────────────────────────────────────────
const EMBEDDING_MATCH_THRESHOLD = 0.8;
const COSINE_DEDUP_THRESHOLD = 0.75;

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
	messages: string[],
	contactId: string,
	workspaceId: string,
	workspaceSalt: Buffer,
	envelope: SealedEnvelope,
): Promise<number> {
	// Take the last 10 messages that are long enough to be meaningful
	const candidates = messages
		.slice(-20)
		.filter((m) => m.length >= 30)
		.slice(-10);

	if (candidates.length === 0) return 0;

	// Track which nodes we've already linked in this pass
	const linkedNodeIds = new Set<string>();

	for (const message of candidates) {
		try {
			// Truncate individual message to 500 chars (focused embedding)
			const chunk = message.slice(0, 500);
			const detected = prefilterEntities(chunk);
			const { maskedText } = maskEntities(chunk, workspaceSalt, detected);
			const embedding = await generateEmbedding(maskedText);
			const matches = await searchKnowledgeNodes(workspaceId, '', embedding, envelope);

			for (const candidate of matches) {
				if (linkedNodeIds.has(candidate.id)) continue;
				const sim = candidate.similarity ?? 0;
				if (sim >= EMBEDDING_MATCH_THRESHOLD) {
					await linkContactToKnowledge(workspaceId, candidate.id, contactId, 'knows_about', sim);
					await incrementNodeMentionCount(workspaceId, candidate.id);
					linkedNodeIds.add(candidate.id);
					console.log(
						`[knowledge-extraction] Embedding match: "${candidate.name}" (sim=${sim.toFixed(3)}) for contact=${contactId.slice(0, 8)}`,
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

// ─── LLM extraction (Gemini Flash — KG-3) ───────────────────────────────────

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

type KnowledgeNodeType = 'topic' | 'project' | 'organization' | 'technology' | 'sector' | 'concept';
type KnowledgeRelType =
	| 'knows_about'
	| 'works_on'
	| 'member_of'
	| 'expert_in'
	| 'uses'
	| 'invested_in'
	| 'interested_in';

interface ExtractedEntity {
	type: KnowledgeNodeType;
	name: string;
	displayName: string;
	description: string;
	relationshipType: KnowledgeRelType;
	confidence: number;
}

/** Gemini JSON extraction prompt — instructs model to output structured JSON instead of tool_use */
const GEMINI_EXTRACTION_PROMPT = `${KNOWLEDGE_SYSTEM_PROMPT}

Respond with ONLY a JSON object containing an "entities" array. Each entity must have:
- type: one of "topic", "project", "organization", "technology", "sector", "concept"
- name: short canonical lowercase name for deduplication (e.g., "solana", "defi")
- displayName: original casing for display
- description: 1-sentence description
- relationshipType: one of "knows_about", "works_on", "member_of", "expert_in", "uses", "invested_in", "interested_in"
- confidence: number 0.0-1.0 based on evidence strength

Example: {"entities": [{"type": "technology", "name": "solana", "displayName": "Solana", "description": "Layer 1 blockchain", "relationshipType": "works_on", "confidence": 0.9}]}`;

/**
 * LLM-based entity extraction using Gemini Flash for cost efficiency (KG-3).
 * Returns the number of entities extracted and linked.
 */
async function llmExtractEntities(
	messages: string[],
	contactId: string,
	workspaceId: string,
	workspaceSalt: Buffer,
	envelope: SealedEnvelope,
): Promise<number> {
	const maskedMessages = messages.slice(-50).map((m) => {
		const detected = prefilterEntities(m);
		return maskEntities(m, workspaceSalt, detected).maskedText;
	});
	const userPrompt = `Extract knowledge entities from these messages:\n\n${maskedMessages.join('\n')}`;

	const responseText = await inferWithGemini({
		systemPrompt: GEMINI_EXTRACTION_PROMPT,
		userPrompt,
	});

	let input: { entities?: unknown };
	try {
		const cleaned = responseText.replace(/```json\n?|\n?```/g, '').trim();
		input = JSON.parse(cleaned);
	} catch {
		console.log('[knowledge-extraction] Failed to parse Gemini JSON response');
		return 0;
	}

	if (!Array.isArray(input.entities)) {
		console.log('[knowledge-extraction] entities field missing or not an array');
		return 0;
	}

	const entities = (input.entities as ExtractedEntity[])
		.filter((e) => typeof e.confidence === 'number' && e.confidence >= 0.7)
		.slice(0, 10);

	let linked = 0;

	for (const entity of entities) {
		try {
			const normalizedName = entity.name.toLowerCase();

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
			const embedding = await generateEmbedding(embeddingInput);
			const candidates = await searchKnowledgeNodes(
				workspaceId,
				normalizedName,
				embedding,
				envelope,
			);

			let nodeId: string;
			const closest = candidates[0];

			if (closest?.similarity !== undefined) {
				const sim = closest.similarity;
				if (sim > COSINE_DEDUP_THRESHOLD) {
					nodeId = closest.id;
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
 * 4. LLM extraction via Haiku — discover new entities (cheap)
 * 5. Record extraction in log for future staleness checks
 *
 * Cost hierarchy: skip (free) > embedding match (~$0.0001) > Haiku (~$0.002)
 */
export async function extractKnowledgeEntities(
	messages: string[],
	contactId: string,
	workspaceId: string,
	workspaceSalt: Buffer,
	envelope: SealedEnvelope,
): Promise<void> {
	// 1. Staleness check — skip if already extracted with no new messages
	const log = await getExtractionLog(workspaceId, contactId);
	if (log?.messageHorizon) {
		// If all messages are older than what we already processed, skip
		const latestMessage = messages[messages.length - 1];
		if (latestMessage && log.messageHorizon >= new Date()) {
			// Can't reliably compare message timestamps from plain text.
			// Fall through — the nightly cron uses DB timestamps for accurate staleness.
		}
	}

	// 2. Keyword pre-filter
	if (!keywordPreFilter(messages)) {
		console.log('[knowledge-extraction] Pre-filter rejected — skipping');
		await upsertExtractionLog(workspaceId, contactId, {
			entitiesExtracted: 0,
			llmCalled: false,
		});
		return;
	}

	// 3. Embedding-first match — try to link without LLM
	let totalLinked = 0;
	try {
		const embeddingMatches = await embeddingFirstMatch(
			messages,
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

	// 4. LLM extraction via Haiku — discover new entities
	try {
		const llmEntities = await llmExtractEntities(
			messages,
			contactId,
			workspaceId,
			workspaceSalt,
			envelope,
		);
		totalLinked += llmEntities;
		console.log(
			`[knowledge-extraction] Haiku: ${llmEntities} entities for contact=${contactId.slice(0, 8)}`,
		);

		// 5. Record extraction
		await upsertExtractionLog(workspaceId, contactId, {
			entitiesExtracted: totalLinked,
			llmCalled: true,
		});
	} catch (err) {
		console.error('[knowledge-extraction] LLM extraction failed:', (err as Error).message);
		// Still record partial results
		await upsertExtractionLog(workspaceId, contactId, {
			entitiesExtracted: totalLinked,
			llmCalled: false,
		});
	}
}

/**
 * Cost-optimized extraction for the nightly cron — uses DB-level staleness
 * check and only calls LLM for contacts that actually need it.
 * Embedding-first matching is always attempted; LLM is gated by budget.
 */
export async function extractKnowledgeForContact(
	messages: string[],
	contactId: string,
	workspaceId: string,
	opts: { skipLLM?: boolean; workspaceSalt: Buffer; envelope: SealedEnvelope },
): Promise<{ embeddingMatches: number; llmEntities: number }> {
	let embeddingMatches = 0;
	let llmEntities = 0;

	if (!keywordPreFilter(messages)) {
		await upsertExtractionLog(workspaceId, contactId, {
			entitiesExtracted: 0,
			llmCalled: false,
		});
		return { embeddingMatches: 0, llmEntities: 0 };
	}

	// Embedding-first match (always)
	try {
		embeddingMatches = await embeddingFirstMatch(
			messages,
			contactId,
			workspaceId,
			opts.workspaceSalt,
			opts.envelope,
		);
	} catch (err) {
		console.error('[knowledge-extraction] Embedding match failed:', (err as Error).message);
	}

	// LLM extraction (budget-gated)
	if (!opts.skipLLM) {
		try {
			llmEntities = await llmExtractEntities(
				messages,
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
		entitiesExtracted: embeddingMatches + llmEntities,
		llmCalled: !opts.skipLLM && llmEntities > 0,
	});

	return { embeddingMatches, llmEntities };
}
