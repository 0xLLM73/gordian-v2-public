import { getKnowledgeLlmRuntime } from '@repo/shared';
import { inferWithGemini } from './gemini-inference';
import { fetchLocalModel } from './local-model-request';

type KnowledgeNodeType = 'topic' | 'project' | 'organization' | 'technology' | 'sector' | 'concept';
type KnowledgeRelType =
	| 'knows_about'
	| 'works_on'
	| 'member_of'
	| 'expert_in'
	| 'uses'
	| 'invested_in'
	| 'interested_in';
type KnowledgeLinkRelType =
	| 'affiliated_with'
	| 'alternative_to'
	| 'works_on'
	| 'owns_or_responsible_for'
	| 'interested_in'
	| 'requested'
	| 'part_of'
	| 'depends_on'
	| 'related_to'
	| 'competes_with'
	| 'builds_on'
	| 'funds'
	| 'uses'
	| 'cites'
	| 'led_to'
	| 'preceded_by'
	| 'contradicts';
type KnowledgeRelationDirection = 'head_to_tail' | 'tail_to_head' | 'undirected';
type KnowledgeRelationTemporalStatus = 'current' | 'past' | 'future' | 'unknown';

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

const KNOWLEDGE_LINK_REL_TYPES = new Set<KnowledgeLinkRelType>([
	'affiliated_with',
	'alternative_to',
	'works_on',
	'owns_or_responsible_for',
	'interested_in',
	'requested',
	'part_of',
	'depends_on',
	'related_to',
	'competes_with',
	'builds_on',
	'funds',
	'uses',
	'cites',
	'led_to',
	'preceded_by',
	'contradicts',
]);

const RELATION_TYPE_ALIASES = new Map<string, KnowledgeLinkRelType>([
	['affiliated_with', 'affiliated_with'],
	['affiliated', 'affiliated_with'],
	['member_of', 'affiliated_with'],
	['works_on', 'works_on'],
	['working_on', 'works_on'],
	['works_with', 'affiliated_with'],
	['working_with', 'affiliated_with'],
	['owns_or_responsible_for', 'owns_or_responsible_for'],
	['owns', 'owns_or_responsible_for'],
	['responsible_for', 'owns_or_responsible_for'],
	['interested_in', 'interested_in'],
	['requested', 'requested'],
	['asks_for', 'requested'],
	['use', 'uses'],
	['uses', 'uses'],
	['using', 'uses'],
	['used_to_use', 'uses'],
	['part_of', 'part_of'],
	['depends_on', 'depends_on'],
	['depends', 'depends_on'],
	['alternative_to', 'alternative_to'],
	['competes_with', 'competes_with'],
	['builds_on', 'builds_on'],
	['funds', 'funds'],
	['related_to', 'related_to'],
	['cites', 'cites'],
	['led_to', 'led_to'],
	['preceded_by', 'preceded_by'],
	['contradicts', 'contradicts'],
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

export interface ExtractedKnowledgeRelation {
	headName: string;
	headMention: string;
	relationType: KnowledgeLinkRelType;
	tailName: string;
	tailMention: string;
	direction: KnowledgeRelationDirection;
	sourceMessageId?: string;
	quote?: string;
	charStart?: number;
	charEnd?: number;
	isExplicit: boolean;
	negated: boolean;
	temporalStatus: KnowledgeRelationTemporalStatus;
	confirmedEligible: boolean;
	confidence?: number;
	rationale?: string;
}

export interface KnowledgeEntityInferenceResult {
	entities: ExtractedKnowledgeEntity[];
	relations: ExtractedKnowledgeRelation[];
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

function normalizeRelationToken(input: unknown): KnowledgeLinkRelType | undefined {
	const token = normalizeToken(input);
	if (!token) return undefined;
	const fromAlias = RELATION_TYPE_ALIASES.get(token);
	if (fromAlias) return fromAlias;
	if (KNOWLEDGE_LINK_REL_TYPES.has(token as KnowledgeLinkRelType)) {
		return token as KnowledgeLinkRelType;
	}
	return undefined;
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

function getRelationArray(input: unknown): unknown[] {
	if (!isRecord(input)) return [];

	const arrayKeys = [
		'relations',
		'relationships',
		'knowledgeRelations',
		'knowledge_relations',
		'knowledgeRelationships',
		'knowledge_relationships',
		'edges',
		'links',
	];
	for (const key of arrayKeys) {
		const value = input[key];
		if (Array.isArray(value)) return value;
	}

	for (const key of ['data', 'result', 'response', 'output']) {
		const nested = input[key];
		if (!isRecord(nested)) continue;
		const nestedRelations = getRelationArray(nested);
		if (nestedRelations.length > 0) return nestedRelations;
	}

	return [];
}

function parseConfidence(input: unknown): number | undefined {
	if (typeof input === 'number') return Number.isFinite(input) ? input : undefined;
	if (typeof input !== 'string') return undefined;
	const parsed = Number(input.trim());
	return Number.isFinite(parsed) ? parsed : undefined;
}

function parseBoolean(input: unknown): boolean | undefined {
	if (typeof input === 'boolean') return input;
	if (typeof input !== 'string') return undefined;
	const normalized = input.trim().toLowerCase();
	if (['true', 'yes', '1'].includes(normalized)) return true;
	if (['false', 'no', '0'].includes(normalized)) return false;
	return undefined;
}

function parseNumberField(input: unknown): number | undefined {
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

function normalizeRelationDirection(input: unknown): KnowledgeRelationDirection {
	const token = normalizeToken(input);
	if (token === 'tail_to_head' || token === 'undirected') return token;
	return 'head_to_tail';
}

function normalizeTemporalStatus(input: unknown): KnowledgeRelationTemporalStatus {
	const token = normalizeToken(input);
	if (token === 'current' || token === 'past' || token === 'future') return token;
	if (
		token?.includes('past') ||
		token?.includes('stale') ||
		token?.includes('historical') ||
		token?.includes('superseded') ||
		token?.includes('used_to') ||
		token?.includes('former') ||
		token?.includes('no_longer')
	) {
		return 'past';
	}
	if (token?.includes('future') || token?.includes('planned') || token?.includes('upcoming')) {
		return 'future';
	}
	if (token?.includes('current') || token?.includes('active')) return 'current';
	return 'unknown';
}

function normalizeRelation(input: unknown): ExtractedKnowledgeRelation | null {
	if (!isRecord(input)) return null;

	const relationType = normalizeRelationToken(
		input.relationType ??
			input.relation_type ??
			input.linkType ??
			input.link_type ??
			input.relationshipType ??
			input.relationship_type ??
			input.predicate ??
			input.type,
	);
	if (!relationType) return null;

	const headMention = getStringField(input, [
		'headMention',
		'head_mention',
		'sourceMention',
		'source_mention',
		'subjectNode',
		'subject_node',
		'subject',
		'head',
		'source',
	]);
	const tailMention = getStringField(input, [
		'tailMention',
		'tail_mention',
		'targetMention',
		'target_mention',
		'objectNode',
		'object_node',
		'object',
		'tail',
		'target',
	]);
	const headName =
		getStringField(input, [
			'headName',
			'head_name',
			'headNodeId',
			'head_node_id',
			'subjectNode',
			'subject_node',
			'subject',
		]) ?? headMention;
	const tailName =
		getStringField(input, [
			'tailName',
			'tail_name',
			'tailNodeId',
			'tail_node_id',
			'objectNode',
			'object_node',
			'object',
		]) ?? tailMention;
	if (!headName || !tailName || !headMention || !tailMention) return null;

	const confidence = parseConfidence(input.confidence ?? input.score);
	if (confidence !== undefined && confidence < 0.45) return null;

	return {
		headName,
		headMention,
		relationType,
		tailName,
		tailMention,
		direction: normalizeRelationDirection(input.direction),
		sourceMessageId: getStringField(input, [
			'sourceMessageId',
			'source_message_id',
			'messageId',
			'message_id',
		]),
		quote: getStringField(input, ['quote', 'evidenceQuote', 'evidence_quote', 'snippet']),
		charStart: parseNumberField(input.charStart ?? input.char_start),
		charEnd: parseNumberField(input.charEnd ?? input.char_end),
		isExplicit: parseBoolean(input.isExplicit ?? input.is_explicit) ?? false,
		negated: parseBoolean(input.negated) ?? false,
		temporalStatus: normalizeTemporalStatus(input.temporalStatus ?? input.temporal_status),
		confirmedEligible:
			parseBoolean(input.confirmedEligible ?? input.confirmed_eligible ?? input.promotable) ??
			false,
		confidence,
		rationale: getStringField(input, ['rationale', 'reason']),
	};
}

export function normalizeKnowledgeEntities(input: unknown): ExtractedKnowledgeEntity[] {
	return getEntityArray(input)
		.map((entity) => normalizeEntity(entity))
		.filter((entity): entity is ExtractedKnowledgeEntity => entity !== null)
		.slice(0, 10);
}

export function normalizeKnowledgeRelations(input: unknown): ExtractedKnowledgeRelation[] {
	return getRelationArray(input)
		.map((relation) => normalizeRelation(relation))
		.filter((relation): relation is ExtractedKnowledgeRelation => relation !== null)
		.slice(0, 20);
}

export function parseKnowledgeInferenceJson(responseText: string): {
	entities: ExtractedKnowledgeEntity[];
	relations: ExtractedKnowledgeRelation[];
} {
	let input: unknown;
	try {
		input = JSON.parse(cleanJsonText(responseText));
	} catch {
		const jsonSlice = findJsonSlice(cleanJsonText(responseText));
		if (!jsonSlice) {
			console.log('[knowledge-llm] Failed to parse knowledge entity JSON response');
			return { entities: [], relations: [] };
		}
		try {
			input = JSON.parse(jsonSlice);
		} catch {
			console.log('[knowledge-llm] Failed to parse knowledge entity JSON response');
			return { entities: [], relations: [] };
		}
	}

	const entities = normalizeKnowledgeEntities(input);
	if (entities.length === 0) {
		console.log('[knowledge-llm] no schema-compatible entities found in response');
	}

	return { entities, relations: normalizeKnowledgeRelations(input) };
}

export function parseKnowledgeEntityJson(responseText: string): ExtractedKnowledgeEntity[] {
	return parseKnowledgeInferenceJson(responseText).entities;
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

	const response = await fetchLocalModel(
		runtime.chatCompletionsUrl,
		{
			method: 'POST',
			headers,
			body: JSON.stringify(body),
		},
		{ label: 'Local knowledge LLM' },
	);

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
		return { entities: [], relations: [], source: 'disabled' };
	}

	if (runtime.mode === 'local') {
		const result = await inferWithLocalOpenAICompatible(params);
		const parsed = parseKnowledgeInferenceJson(result.text);
		return {
			...parsed,
			source: result.source,
		};
	}

	const text = await inferWithGemini({
		systemPrompt: params.systemPrompt,
		userPrompt: params.userPrompt,
	});
	const parsed = parseKnowledgeInferenceJson(text);
	return {
		...parsed,
		source: 'gemini_flash',
	};
}
