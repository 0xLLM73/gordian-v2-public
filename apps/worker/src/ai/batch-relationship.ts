/**
 * KG-4 — Batch API for Nightly Relationship Extraction
 *
 * Collects LLM relationship extraction requests during the nightly cron,
 * submits them as a single Anthropic Message Batch (50% cost discount),
 * and routes results back to the correct workspace/contact.
 *
 * Security:
 * - SEC-073: Batch payloads contain ONLY ELM-masked text
 * - SEC-050: workspace_id preserved in custom_id for result routing
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
import { generateEmbedding } from './embeddings';
import { prefilterEntities } from './prefilter';

// ─── Types ───────────────────────────────────────────────────────────────────

interface BatchExtractionRequest {
	workspaceId: string;
	contactId: string;
	maskedMessages: string[];
	workspaceSalt: Buffer;
	envelope: SealedEnvelope;
}

interface BatchResultEntry {
	request: BatchExtractionRequest;
	entities: ExtractedEntity[];
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
}

// ─── Constants ───────────────────────────────────────────────────────────────

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const COSINE_DEDUP_THRESHOLD = 0.75;
const BATCH_POLL_INTERVAL_MS = 10_000; // 10 seconds
const BATCH_POLL_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes max wait

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

// ─── Lazy Anthropic client ───────────────────────────────────────────────────

let _client: Anthropic | null = null;
function getClient(): Anthropic {
	if (!_client) {
		_client = new Anthropic({
			baseURL: process.env.HELICONE_API_KEY ? 'https://anthropic.helicone.ai' : undefined,
			defaultHeaders: process.env.HELICONE_API_KEY
				? { 'Helicone-Auth': `Bearer ${process.env.HELICONE_API_KEY}` }
				: undefined,
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
		messages: string[],
		workspaceSalt: Buffer,
		envelope: SealedEnvelope,
	): void {
		const maskedMessages = messages.slice(-50).map((m) => {
			const detected = prefilterEntities(m);
			return maskEntities(m, workspaceSalt, detected).maskedText;
		});

		this.requests.push({
			workspaceId,
			contactId,
			maskedMessages,
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
			if (!Array.isArray(input.entities)) continue;

			const entities = (input.entities as ExtractedEntity[])
				.filter((e) => typeof e.confidence === 'number' && e.confidence >= 0.7)
				.slice(0, 10);

			results.push({ request: req, entities });
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
				const embedding = await generateEmbedding(embeddingInput);
				const candidates = await searchKnowledgeNodes(
					request.workspaceId,
					normalizedName,
					embedding,
					request.envelope,
				);

				let nodeId: string;
				const closest = candidates[0];

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

		for (const req of requests) {
			try {
				const userPrompt = `Extract knowledge entities from these messages:\n\n${req.maskedMessages.join('\n')}`;

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
				if (!Array.isArray(input.entities)) continue;

				const entities = (input.entities as ExtractedEntity[])
					.filter((e) => typeof e.confidence === 'number' && e.confidence >= 0.7)
					.slice(0, 10);

				const linked = await this.processEntities({ request: req, entities });
				totalLinked += linked;
			} catch (err) {
				console.error(
					`[batch-relationship] Sync fallback failed for contact=${req.contactId.slice(0, 8)}:`,
					(err as Error).message,
				);
				// Record failed extraction
				await upsertExtractionLog(req.workspaceId, req.contactId, {
					entitiesExtracted: 0,
					llmCalled: false,
				});
			}
		}

		return { totalLinked, batchUsed: false };
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
