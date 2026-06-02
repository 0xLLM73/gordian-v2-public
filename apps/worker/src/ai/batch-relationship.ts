/**
 * KG-4 — Batch API for Nightly Relationship Extraction
 *
 * Collects LLM relationship extraction requests during the nightly cron,
 * submits them as a single Anthropic Message Batch when cloud batch mode is active,
 * and routes results back to the correct workspace/contact.
 *
 * Security:
 * - SEC-073: Batch payloads contain ONLY ELM-masked text
 * - SEC-050: workspace_id preserved in custom_id for result routing
 * - Local KG LLM mode bypasses Anthropic Batch and uses sync local calls
 * - Batch errors fall back to sync inferWithCache() per-workspace
 */

import Anthropic from '@anthropic-ai/sdk';
import type { SealedEnvelope } from '@repo/crypto';
import { maskEntities } from '@repo/crypto';
import {
	createKnowledgeNode,
	findNodeByAlias,
	findNodeByNameAnyType,
	incrementNodeMentionCount,
	linkContactToKnowledge,
	searchKnowledgeNodes,
	upsertExtractionLog,
} from '@repo/db';
import {
	assertAiProcessingEnabled,
	getHeliconeApiKey,
	getKnowledgeEmbeddingFingerprint,
	getKnowledgeLlmRuntime,
	knowledgeEmbeddingFingerprintKey,
} from '@repo/shared';
import { generateEmbeddingCached } from './embeddings';
import type { KnowledgeExtractionMessage } from './knowledge-extraction';
import { evidenceSourceSelectionMetadata, selectEvidenceMessage } from './knowledge-extraction';
import { inferKnowledgeEntitiesJson, normalizeKnowledgeEntities } from './knowledge-llm';
import { prefilterEntities } from './prefilter';

// ─── Types ───────────────────────────────────────────────────────────────────

interface BatchExtractionRequest {
	workspaceId: string;
	contactId: string;
	maskedMessages: string[];
	sourceMessages: NormalizedKnowledgeMessage[];
	workspaceSalt: Buffer;
	envelope: SealedEnvelope;
}

interface BatchResultEntry {
	request: BatchExtractionRequest;
	entities: ExtractedEntity[];
	source?: string;
}

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
	aliases?: string[];
	sourceMention?: string;
	mentionSpan?: string;
	evidenceQuote?: string;
}

type KnowledgeExtractionInput = string | KnowledgeExtractionMessage;

interface NormalizedKnowledgeMessage {
	id?: string;
	text: string;
	occurredAt?: Date;
}

function normalizeKnowledgeMessages(
	messages: KnowledgeExtractionInput[],
): NormalizedKnowledgeMessage[] {
	return messages
		.map((message) => {
			if (typeof message === 'string') return { text: message };
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

// ─── Constants ───────────────────────────────────────────────────────────────

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const COSINE_DEDUP_THRESHOLD = 0.75;
const BATCH_POLL_INTERVAL_MS = 10_000; // 10 seconds
const BATCH_POLL_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes max wait
const fingerprintWarnings = new Set<string>();

const KNOWLEDGE_SYSTEM_PROMPT = `You are extracting structured knowledge entities from Telegram messages.
Identify topics, projects, organizations, technologies, market sectors, and concepts
that this contact is knowledgeable about, working on, or interested in.

IMPORTANT naming rules:
- Use short, canonical names that others would also use (e.g., "Solana" not "Solana ecosystem projects").
- Prefer the widely-recognized proper noun (e.g., "Ethereum", "Y Combinator", "React").
- For broader topics use 1-3 word labels (e.g., "DeFi", "AI infrastructure", "venture capital").
- Never add qualifiers like "ecosystem", "space", "industry", "community" unless they are part of the proper name.

Only extract entities with clear evidence in the messages.
Do not include personal names, phone numbers, Telegram usernames, or any contact-identifying information in entity names or descriptions.
When possible, include sourceMention as a short exact phrase from the message that supports the entity.`;

const KNOWLEDGE_JSON_SYSTEM_PROMPT = `${KNOWLEDGE_SYSTEM_PROMPT}

Respond with ONLY a JSON object containing an "entities" array. Each entity must have:
- type: one of "topic", "project", "organization", "technology", "sector", "concept"
- name: short canonical lowercase name for deduplication, e.g. "solana" or "defi"
- displayName: original casing for display
- description: 1-sentence description
- relationshipType: one of "knows_about", "works_on", "member_of", "expert_in", "uses", "invested_in", "interested_in"
- confidence: number from 0.0 to 1.0 based on evidence strength
- sourceMention: optional exact short phrase from the source message that supports the entity

Example: {"entities":[{"type":"technology","name":"solana","displayName":"Solana","description":"Layer 1 blockchain","relationshipType":"works_on","confidence":0.9,"sourceMention":"building on Solana"}]}`;

const EXTRACT_TOOL = {
	name: 'extract_knowledge_entities',
	description:
		'Extract knowledge entities that this contact is knowledgeable about or involved in.',
	input_schema: {
		type: 'object' as const,
		properties: {
			entities: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						type: {
							type: 'string',
							enum: ['topic', 'project', 'organization', 'technology', 'sector', 'concept'],
						},
						name: { type: 'string' },
						displayName: { type: 'string' },
						description: { type: 'string' },
						relationshipType: {
							type: 'string',
							enum: [
								'knows_about',
								'works_on',
								'member_of',
								'expert_in',
								'uses',
								'invested_in',
								'interested_in',
							],
						},
						confidence: { type: 'number' },
						sourceMention: { type: 'string' },
					},
					required: [
						'type',
						'name',
						'displayName',
						'description',
						'relationshipType',
						'confidence',
					],
				},
			},
		},
		required: ['entities'],
	},
};

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
		`[batch-relationship] Embedding fingerprint mismatch in ${source}: existing node ${node.id.slice(0, 8)} was embedded with "${previous}", active runtime is "${current}". Re-embed the knowledge graph before trusting semantic match quality.`,
	);
}

// ─── Lazy Anthropic client ───────────────────────────────────────────────────

let _client: Anthropic | null = null;
function getClient(): Anthropic {
	if (!_client) {
		const heliconeApiKey = getHeliconeApiKey();
		_client = new Anthropic({
			baseURL: heliconeApiKey ? 'https://anthropic.helicone.ai' : undefined,
			defaultHeaders: heliconeApiKey ? { 'Helicone-Auth': `Bearer ${heliconeApiKey}` } : undefined,
		});
	}
	return _client;
}

// ─── Batch Collector ─────────────────────────────────────────────────────────

/**
 * Collects extraction requests during the nightly cron loop.
 * Call `addRequest()` for each contact, then `submitAndProcess()` at the end.
 */
export class BatchRelationshipExtractor {
	private requests: BatchExtractionRequest[] = [];

	/**
	 * Prepare a contact's messages for batch extraction.
	 * SEC-073: Messages are ELM-masked before being stored.
	 */
	addRequest(
		workspaceId: string,
		contactId: string,
		messages: KnowledgeExtractionInput[],
		workspaceSalt: Buffer,
		envelope: SealedEnvelope,
	): void {
		const sourceMessages = normalizeKnowledgeMessages(messages).slice(-50);
		const maskedMessages = sourceMessages.map((m) => {
			const detected = prefilterEntities(m.text);
			return maskEntities(m.text, workspaceSalt, detected).maskedText;
		});

		this.requests.push({
			workspaceId,
			contactId,
			maskedMessages,
			sourceMessages,
			workspaceSalt,
			envelope,
		});
	}

	/** Number of pending requests. */
	get size(): number {
		return this.requests.length;
	}

	/**
	 * Submit all collected requests as a single Anthropic Message Batch,
	 * poll for completion, and process results.
	 *
	 * Returns the number of entities linked across all contacts.
	 * On batch failure, falls back to sync inferWithCache per request.
	 */
	async submitAndProcess(): Promise<{ totalLinked: number; batchUsed: boolean }> {
		if (this.requests.length === 0) return { totalLinked: 0, batchUsed: false };

		const requests = [...this.requests];
		this.requests = []; // Clear for reuse

		const llmRuntime = getKnowledgeLlmRuntime(process.env);
		if (llmRuntime.mode === 'disabled') {
			for (const req of requests) {
				await upsertExtractionLog(req.workspaceId, req.contactId, {
					messageHorizon: latestMessageHorizon(req.sourceMessages),
					entitiesExtracted: 0,
					llmCalled: false,
				});
			}
			return { totalLinked: 0, batchUsed: false };
		}

		if (llmRuntime.provider === 'local' || llmRuntime.provider === 'gemini') {
			return this.fallbackSync(requests);
		}

		try {
			const results = await this.submitBatch(requests);
			let totalLinked = 0;
			for (const result of results) {
				const linked = await this.processEntities(result);
				totalLinked += linked;
			}
			return { totalLinked, batchUsed: true };
		} catch (err) {
			console.error(
				'[batch-relationship] Batch failed, falling back to sync:',
				(err as Error).message,
			);
			return this.fallbackSync(requests);
		}
	}

	// ─── Private: Batch submission ─────────────────────────────────────────

	private async submitBatch(requests: BatchExtractionRequest[]): Promise<BatchResultEntry[]> {
		assertAiProcessingEnabled('Claude relationship batch extraction');
		const client = getClient();

		// Build batch request items
		// SEC-050: custom_id encodes workspace+contact for result routing
		const batchRequests = requests.map((req, idx) => ({
			custom_id: `${req.workspaceId}:${req.contactId}:${idx}`,
			params: {
				model: HAIKU_MODEL,
				max_tokens: 1024,
				temperature: 0.1,
				system: KNOWLEDGE_SYSTEM_PROMPT,
				messages: [
					{
						role: 'user' as const,
						content: `Extract knowledge entities from these messages:\n\n${req.maskedMessages.join('\n')}`,
					},
				],
				tools: [EXTRACT_TOOL],
				tool_choice: { type: 'tool' as const, name: 'extract_knowledge_entities' },
			},
		}));

		console.log(`[batch-relationship] Submitting batch of ${batchRequests.length} requests`);

		const batch = await client.messages.batches.create({ requests: batchRequests });
		console.log(`[batch-relationship] Batch created: ${batch.id}`);

		// Poll for completion
		const results = await this.pollBatch(client, batch.id, requests);
		return results;
	}

	private async pollBatch(
		client: Anthropic,
		batchId: string,
		requests: BatchExtractionRequest[],
	): Promise<BatchResultEntry[]> {
		const startTime = Date.now();

		while (Date.now() - startTime < BATCH_POLL_TIMEOUT_MS) {
			const batch = await client.messages.batches.retrieve(batchId);

			if (batch.processing_status === 'ended') {
				console.log(`[batch-relationship] Batch ${batchId} completed`);
				return this.collectResults(client, batchId, requests);
			}

			console.log(
				`[batch-relationship] Batch ${batchId} status: ${batch.processing_status}, ` +
					`counts: ${JSON.stringify(batch.request_counts)}`,
			);
			await sleep(BATCH_POLL_INTERVAL_MS);
		}

		throw new Error(`Batch ${batchId} timed out after ${BATCH_POLL_TIMEOUT_MS / 1000}s`);
	}

	private async collectResults(
		client: Anthropic,
		batchId: string,
		requests: BatchExtractionRequest[],
	): Promise<BatchResultEntry[]> {
		const results: BatchResultEntry[] = [];

		// Build lookup map from custom_id to request
		const requestMap = new Map<string, BatchExtractionRequest>();
		for (let i = 0; i < requests.length; i++) {
			const req = requests[i];
			requestMap.set(`${req.workspaceId}:${req.contactId}:${i}`, req);
		}

		// Stream results from the batch
		const decoder = await client.messages.batches.results(batchId);
		for await (const result of decoder) {
			const req = requestMap.get(result.custom_id);
			if (!req) {
				console.warn(`[batch-relationship] Unknown custom_id: ${result.custom_id}`);
				continue;
			}

			if (result.result.type !== 'succeeded') {
				console.error(
					`[batch-relationship] Request ${result.custom_id} failed: ${result.result.type}`,
				);
				continue;
			}

			const message = result.result.message;
			const toolUse = message.content.find((b: { type: string }) => b.type === 'tool_use');
			if (!toolUse || toolUse.type !== 'tool_use') continue;

			const input = toolUse.input as { entities?: unknown };
			const entities = normalizeKnowledgeEntities(input.entities);

			results.push({ request: req, entities, source: 'anthropic_batch' });
		}

		return results;
	}

	// ─── Private: Entity processing (shared by batch & fallback) ──────────

	private async processEntities(result: BatchResultEntry): Promise<number> {
		const { request, entities } = result;
		let linked = 0;

		for (const entity of entities) {
			try {
				const normalizedName = entity.name.toLowerCase();
				const evidenceSelection = selectEvidenceMessage(entity, request.sourceMessages);
				const evidenceMessage = evidenceSelection.message;
				const evidence = {
					messageId: evidenceMessage?.id,
					snippet: evidenceMessage?.text.slice(0, 1000),
					occurredAt: evidenceMessage?.occurredAt,
					evidenceKind: 'llm_extracted' as const,
					confidence: entity.confidence,
					metadata: {
						source: result.source ?? 'anthropic_batch',
						entityType: entity.type,
						sourceMessageSelection: evidenceSourceSelectionMetadata(evidenceSelection),
					},
					envelope: request.envelope,
				};

				// Cross-type dedup
				const existingAnyType = await findNodeByNameAnyType(
					request.workspaceId,
					normalizedName,
					request.envelope,
				);
				if (existingAnyType) {
					await incrementNodeMentionCount(request.workspaceId, existingAnyType.id);
					await linkContactToKnowledge(
						request.workspaceId,
						existingAnyType.id,
						request.contactId,
						entity.relationshipType,
						entity.confidence,
						evidence,
					);
					linked++;
					continue;
				}

				// Alias check
				const aliasMatch = await findNodeByAlias(
					request.workspaceId,
					normalizedName,
					request.envelope,
				);
				if (aliasMatch) {
					await incrementNodeMentionCount(request.workspaceId, aliasMatch.id);
					await linkContactToKnowledge(
						request.workspaceId,
						aliasMatch.id,
						request.contactId,
						entity.relationshipType,
						entity.confidence,
						evidence,
					);
					linked++;
					continue;
				}

				// Embedding dedup + create
				const rawEmbeddingInput = entity.description
					? `Type: ${entity.type} | Name: ${entity.displayName} | Context: ${entity.description}`
					: `Type: ${entity.type} | Name: ${entity.displayName}`;
				const embDetected = prefilterEntities(rawEmbeddingInput);
				const { maskedText: embeddingInput } = maskEntities(
					rawEmbeddingInput,
					request.workspaceSalt,
					embDetected,
				);
				const embedding = await generateEmbeddingCached(embeddingInput, { purpose: 'dedup' });
				const candidates = await searchKnowledgeNodes(
					request.workspaceId,
					normalizedName,
					embedding,
					request.envelope,
				);

				let nodeId: string;
				const closest = candidates[0];

				if (closest?.similarity !== undefined) {
					warnIfEmbeddingFingerprintChanged('batch_dedup', closest);
				}
				if (closest?.similarity !== undefined && closest.similarity > COSINE_DEDUP_THRESHOLD) {
					nodeId = closest.id;
					await incrementNodeMentionCount(request.workspaceId, nodeId);
				} else {
					const node = await createKnowledgeNode(
						request.workspaceId,
						{
							type: entity.type,
							name: normalizedName,
							displayName: entity.displayName,
							description: entity.description,
							embedding,
							metadata: currentEmbeddingMetadata(),
						},
						request.envelope,
					);
					nodeId = node.id;
				}

				await linkContactToKnowledge(
					request.workspaceId,
					nodeId,
					request.contactId,
					entity.relationshipType,
					entity.confidence,
					evidence,
				);
				linked++;
			} catch (err) {
				console.error(
					`[batch-relationship] Failed to process entity "${entity.name}":`,
					(err as Error).message,
				);
			}
		}

		// Record extraction log
		await upsertExtractionLog(request.workspaceId, request.contactId, {
			messageHorizon: latestMessageHorizon(request.sourceMessages),
			entitiesExtracted: linked,
			llmCalled: true,
		});

		return linked;
	}

	// ─── Private: Sync fallback ──────────────────────────────────────────

	private async fallbackSync(
		requests: BatchExtractionRequest[],
	): Promise<{ totalLinked: number; batchUsed: false }> {
		const { inferWithCache } = await import('./cached-inference');
		let totalLinked = 0;
		const llmRuntime = getKnowledgeLlmRuntime(process.env);

		for (const req of requests) {
			try {
				const userPrompt = `Extract knowledge entities from these messages:\n\n${req.maskedMessages.join('\n')}`;

				if (llmRuntime.provider === 'local' || llmRuntime.provider === 'gemini') {
					const inference = await inferKnowledgeEntitiesJson({
						systemPrompt: KNOWLEDGE_JSON_SYSTEM_PROMPT,
						userPrompt,
					});
					const linked = await this.processEntities({
						request: req,
						entities: inference.entities,
						source: inference.source,
					});
					totalLinked += linked;
					continue;
				}

				const response = await inferWithCache(
					KNOWLEDGE_SYSTEM_PROMPT,
					'',
					'',
					[{ role: 'user', content: userPrompt }],
					{
						model: HAIKU_MODEL,
						tools: [EXTRACT_TOOL],
						toolChoice: { type: 'tool', name: 'extract_knowledge_entities' },
						maxTokens: 1024,
						temperature: 0.1,
						helicone: { feature: 'knowledge-extraction-fallback' },
					},
				);

				const toolUse = response.content.find((b) => b.type === 'tool_use');
				if (!toolUse || toolUse.type !== 'tool_use') continue;

				const input = toolUse.input as { entities?: unknown };
				const entities = normalizeKnowledgeEntities(input.entities);

				const linked = await this.processEntities({
					request: req,
					entities,
					source: 'anthropic_fallback',
				});
				totalLinked += linked;
			} catch (err) {
				console.error(
					`[batch-relationship] Sync fallback failed for contact=${req.contactId.slice(0, 8)}:`,
					(err as Error).message,
				);
				// Record failed extraction
				await upsertExtractionLog(req.workspaceId, req.contactId, {
					messageHorizon: latestMessageHorizon(req.sourceMessages),
					entitiesExtracted: 0,
					llmCalled: true,
				});
			}
		}

		return { totalLinked, batchUsed: false };
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
