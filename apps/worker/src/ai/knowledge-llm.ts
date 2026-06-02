import { getKnowledgeLlmRuntime } from '@repo/shared';
import { inferWithGemini } from './gemini-inference';

type KnowledgeNodeType = 'topic' | 'project' | 'organization' | 'technology' | 'sector' | 'concept';
type KnowledgeRelType =
	| 'knows_about'
	| 'works_on'
	| 'member_of'
	| 'expert_in'
	| 'uses'
	| 'invested_in'
	| 'interested_in';

const KNOWLEDGE_NODE_TYPES = new Set<KnowledgeNodeType>([
	'topic',
	'project',
	'organization',
	'technology',
	'sector',
	'concept',
]);

const KNOWLEDGE_REL_TYPES = new Set<KnowledgeRelType>([
	'knows_about',
	'works_on',
	'member_of',
	'expert_in',
	'uses',
	'invested_in',
	'interested_in',
]);

export interface ExtractedKnowledgeEntity {
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

export interface KnowledgeEntityInferenceResult {
	entities: ExtractedKnowledgeEntity[];
	source: string;
}

function cleanJsonText(text: string): string {
	return text.replace(/```json\n?|\n?```/g, '').trim();
}

function isRecord(input: unknown): input is Record<string, unknown> {
	return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function normalizeToken(input: unknown): string | undefined {
	if (typeof input !== 'string') return undefined;
	const normalized = input
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, '_');
	return normalized.length > 0 ? normalized : undefined;
}

function getStringField(input: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = input[key];
		if (typeof value !== 'string') continue;
		const trimmed = value.trim();
		if (trimmed.length > 0) return trimmed;
	}
	return undefined;
}

function getEntityArray(input: unknown): unknown[] {
	if (Array.isArray(input)) return input;
	if (!isRecord(input)) return [];

	const arrayKeys = [
		'entities',
		'extractedEntities',
		'extracted_entities',
		'knowledgeEntities',
		'knowledge_entities',
		'results',
		'items',
	];
	for (const key of arrayKeys) {
		const value = input[key];
		if (Array.isArray(value)) return value;
	}

	const singleEntity = input.entity;
	if (isRecord(singleEntity)) return [singleEntity];

	for (const key of ['data', 'result', 'response', 'output']) {
		const nested = input[key];
		if (!isRecord(nested)) continue;
		const nestedEntities = getEntityArray(nested);
		if (nestedEntities.length > 0) return nestedEntities;
	}

	return [];
}

function parseConfidence(input: unknown): number | undefined {
	if (typeof input === 'number') return Number.isFinite(input) ? input : undefined;
	if (typeof input !== 'string') return undefined;
	const parsed = Number(input.trim());
	return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeEntity(input: unknown): ExtractedKnowledgeEntity | null {
	if (!isRecord(input)) return null;

	const type = normalizeToken(input.type ?? input.entityType ?? input.entity_type);
	const relationshipType = normalizeToken(
		input.relationshipType ??
			input.relationship_type ??
			input.relationType ??
			input.relation_type ??
			input.relationship ??
			input.relation,
	);
	const confidence = parseConfidence(input.confidence ?? input.score);
	if (
		!KNOWLEDGE_NODE_TYPES.has(type as KnowledgeNodeType) ||
		!KNOWLEDGE_REL_TYPES.has(relationshipType as KnowledgeRelType) ||
		confidence === undefined ||
		confidence < 0.7
	) {
		return null;
	}

	const displayName = getStringField(input, ['displayName', 'display_name', 'title', 'name']);
	const name =
		getStringField(input, ['name', 'canonicalName', 'canonical_name']) ??
		displayName?.toLowerCase();
	if (!name || !displayName) return null;

	const aliases = Array.isArray(input.aliases)
		? input.aliases.filter((alias): alias is string => typeof alias === 'string')
		: undefined;

	return {
		type: type as KnowledgeNodeType,
		name,
		displayName,
		description: getStringField(input, ['description', 'summary']) ?? '',
		relationshipType: relationshipType as KnowledgeRelType,
		confidence,
		aliases,
		sourceMention: getStringField(input, ['sourceMention', 'source_mention']),
		mentionSpan: getStringField(input, ['mentionSpan', 'mention_span']),
		evidenceQuote: getStringField(input, ['evidenceQuote', 'evidence_quote', 'quote']),
	};
}

export function normalizeKnowledgeEntities(input: unknown): ExtractedKnowledgeEntity[] {
	return getEntityArray(input)
		.map((entity) => normalizeEntity(entity))
		.filter((entity): entity is ExtractedKnowledgeEntity => entity !== null)
		.slice(0, 10);
}

export function parseKnowledgeEntityJson(responseText: string): ExtractedKnowledgeEntity[] {
	let input: unknown;
	try {
		input = JSON.parse(cleanJsonText(responseText));
	} catch {
		const jsonSlice = findJsonSlice(cleanJsonText(responseText));
		if (!jsonSlice) {
			console.log('[knowledge-llm] Failed to parse knowledge entity JSON response');
			return [];
		}
		try {
			input = JSON.parse(jsonSlice);
		} catch {
			console.log('[knowledge-llm] Failed to parse knowledge entity JSON response');
			return [];
		}
	}

	const entities = normalizeKnowledgeEntities(input);
	if (entities.length === 0) {
		console.log('[knowledge-llm] no schema-compatible entities found in response');
	}

	return entities;
}

function findJsonSlice(text: string): string | undefined {
	let inString = false;
	let escaped = false;
	const stack: string[] = [];
	let start = -1;

	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (char === '\\') {
				escaped = true;
			} else if (char === '"') {
				inString = false;
			}
			continue;
		}

		if (char === '"') {
			inString = true;
			continue;
		}

		if (char === '{' || char === '[') {
			if (stack.length === 0) start = i;
			stack.push(char === '{' ? '}' : ']');
			continue;
		}

		if ((char === '}' || char === ']') && stack.length > 0) {
			const expected = stack.pop();
			if (char !== expected) return undefined;
			if (stack.length === 0 && start >= 0) return text.slice(start, i + 1);
		}
	}

	return undefined;
}

async function inferWithLocalOpenAICompatible(params: {
	systemPrompt: string;
	userPrompt: string;
}): Promise<{ text: string; source: string }> {
	const runtime = getKnowledgeLlmRuntime(process.env);
	if (runtime.mode !== 'local' || !runtime.chatCompletionsUrl || !runtime.model) {
		throw new Error('Local knowledge LLM runtime is not configured');
	}

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
	};
	if (runtime.apiKey) headers.Authorization = `Bearer ${runtime.apiKey}`;

	const body: Record<string, unknown> = {
		model: runtime.model,
		messages: [
			{ role: 'system', content: params.systemPrompt },
			{ role: 'user', content: params.userPrompt },
		],
		temperature: 0.1,
		response_format: { type: 'json_object' },
	};

	const response = await fetch(runtime.chatCompletionsUrl, {
		method: 'POST',
		headers,
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Local knowledge LLM error (${response.status}): ${error}`);
	}

	const data = (await response.json()) as {
		choices?: Array<{ message?: { content?: string | null } }>;
	};
	const text = data.choices?.[0]?.message?.content?.trim();
	if (!text) throw new Error('Local knowledge LLM returned no message content');

	return { text, source: `local:${runtime.model}` };
}

export async function inferKnowledgeEntitiesJson(params: {
	systemPrompt: string;
	userPrompt: string;
}): Promise<KnowledgeEntityInferenceResult> {
	const runtime = getKnowledgeLlmRuntime(process.env);

	if (runtime.mode === 'disabled') {
		return { entities: [], source: 'disabled' };
	}

	if (runtime.mode === 'local') {
		const result = await inferWithLocalOpenAICompatible(params);
		return {
			entities: parseKnowledgeEntityJson(result.text),
			source: result.source,
		};
	}

	const text = await inferWithGemini({
		systemPrompt: params.systemPrompt,
		userPrompt: params.userPrompt,
	});
	return {
		entities: parseKnowledgeEntityJson(text),
		source: 'gemini_flash',
	};
}
