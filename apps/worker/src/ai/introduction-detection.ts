import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import {
	BUILT_IN_INTRO_KEYWORDS,
	getCommitmentLlmRuntime,
	isAiProcessingEnabled,
} from '@repo/shared';
import { inferWithCache } from './cached-inference';

/**
 * Introduction Detection (Phase 16).
 * Uses Claude tool_use to detect when one person introduces two others.
 * Operates on entity-masked content only (contentSanitized) — NEVER raw PII.
 *
 * Keyword pre-filter gates the LLM call: ~95% of messages have no introductions,
 * so this runs at near-zero cost for most conversations.
 */

const DETECT_INTRODUCTIONS_TOOL: Tool = {
	name: 'detect_introductions',
	description: 'Detect introductions between people in conversations',
	input_schema: {
		type: 'object' as const,
		properties: {
			introductions: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						introducer_ref: {
							type: 'string',
							description: 'Alias/ref of who made the introduction, exactly as shown in input',
						},
						introduced_ref_1: {
							type: 'string',
							description:
								'Alias/ref of the first person being introduced, exactly as shown in input',
						},
						introduced_ref_2: {
							type: 'string',
							description:
								'Alias/ref of the second person being introduced, exactly as shown in input',
						},
						introducer_name: {
							type: 'string',
							description: 'Legacy alias/name of who made the introduction',
						},
						introduced_name_1: {
							type: 'string',
							description: 'Legacy alias/name of the first person being introduced',
						},
						introduced_name_2: {
							type: 'string',
							description: 'Legacy alias/name of the second person being introduced',
						},
						context: {
							type: 'string',
							enum: ['deal', 'hiring', 'knowledge', 'social', 'other'],
						},
						source_message_ids: {
							type: 'array',
							items: { type: 'string' },
							description:
								'Message source IDs from [source:<id>] tags that directly support this introduction',
						},
						confidence: { type: 'number', minimum: 0, maximum: 1 },
						reasoning: { type: 'string' },
					},
					required: [
						'introducer_ref',
						'introduced_ref_1',
						'introduced_ref_2',
						'context',
						'confidence',
						'reasoning',
					],
				},
			},
		},
		required: ['introductions'],
	},
};

const INTRODUCTION_DETECTION_KERNEL = `You are an introduction detection engine for a professional CRM.
Analyze conversation summaries or source-tagged message batches to identify when one person introduces two other people.

Rules:
- Only detect explicit introductions — "meet X", "let me introduce you to Y", "adding Z who..."
- People are shown as aliases/refs (e.g., PERSON_a1b2c3d4) — return those exact refs in introducer_ref, introduced_ref_1, and introduced_ref_2
- Source-tagged messages can include [speaker:PERSON_a1b2c3d4]; use the speaker as introducer when the message says "I", "me", "my", or otherwise implies the sender made the introduction
- Do not invent, expand, or return raw names; use only aliases/refs from the input
- If messages include [source:<id>] tags, include only the source_message_ids that directly support each introduction
- confidence: 0.9 = explicit "let me introduce", 0.5 = implied connection, 0.3 = weak/uncertain
- Context types: deal (business intro), hiring (job-related), knowledge (expertise sharing), social (personal), other
- Call detect_introductions with ALL detected introductions, or an empty array if none
- Be conservative — false negatives are better than false positives`;

export interface DetectedIntroduction {
	introducer_ref?: string;
	introduced_ref_1?: string;
	introduced_ref_2?: string;
	introducer_name?: string;
	introduced_name_1?: string;
	introduced_name_2?: string;
	context: string;
	confidence: number;
	reasoning: string;
	source_message_ids?: string[];
}

const LOCAL_INTRO_MAX_TOKENS = 1536;
const VALID_CONTEXTS = new Set(['deal', 'hiring', 'knowledge', 'social', 'other']);

const LOCAL_INTRODUCTION_JSON_KERNEL = `Return only valid JSON with this exact shape:
{
  "introductions": [
    {
      "introducer_ref": "PERSON_x",
      "introduced_ref_1": "PERSON_y",
      "introduced_ref_2": "PERSON_z",
      "context": "deal|hiring|knowledge|social|other",
      "confidence": 0.0,
      "reasoning": "brief masked explanation",
      "source_message_ids": ["message uuid"]
    }
  ]
}

Rules:
- Use only PERSON_* refs present in the transcript.
- If the source line has [speaker:PERSON_*] and the text uses first person, use that speaker as introducer.
- Include only source IDs that appear in [source:...] tags.
- Return {"introductions": []} if there is no explicit three-person introduction.`;

function localIntroductionResponseFormat(): Record<string, unknown> {
	return {
		type: 'object',
		properties: {
			introductions: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						introducer_ref: { type: 'string' },
						introduced_ref_1: { type: 'string' },
						introduced_ref_2: { type: 'string' },
						context: { type: 'string' },
						confidence: { type: 'number' },
						reasoning: { type: 'string' },
						source_message_ids: { type: 'array', items: { type: 'string' } },
					},
					required: [
						'introducer_ref',
						'introduced_ref_1',
						'introduced_ref_2',
						'context',
						'confidence',
						'reasoning',
					],
				},
			},
		},
		required: ['introductions'],
	};
}

function cleanJsonText(text: string): string {
	return text.replace(/```json\n?|\n?```/g, '').trim();
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

function parseJsonResponse(responseText: string): unknown | undefined {
	const cleaned = cleanJsonText(responseText);
	try {
		return JSON.parse(cleaned);
	} catch {
		const jsonSlice = findJsonSlice(cleaned);
		if (!jsonSlice) return undefined;
		try {
			return JSON.parse(jsonSlice);
		} catch {
			return undefined;
		}
	}
}

function stringField(input: Record<string, unknown>, key: string): string | undefined {
	const value = input[key];
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function stringArrayField(input: Record<string, unknown>, key: string): string[] | undefined {
	const value = input[key];
	if (!Array.isArray(value)) return undefined;
	const values = value
		.filter((item): item is string => typeof item === 'string')
		.map((item) => item.trim())
		.filter(Boolean);
	return values.length > 0 ? [...new Set(values)] : undefined;
}

function confidenceField(input: Record<string, unknown>): number | undefined {
	const value = input.confidence;
	const parsed =
		typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
	if (!Number.isFinite(parsed)) return undefined;
	return Math.max(0, Math.min(1, parsed));
}

function isPersonRef(value: string | undefined): value is string {
	return typeof value === 'string' && /^PERSON_[A-Za-z0-9_]+$/.test(value);
}

function allowedSourceIdsFromContent(content: string): Set<string> {
	const allowed = new Set<string>();
	for (const match of content.matchAll(/\[source:([^\]]+)\]/g)) {
		if (match[1]) allowed.add(match[1]);
	}
	return allowed;
}

function normalizeDetectedIntroduction(
	value: unknown,
	allowedSourceIds: Set<string>,
): DetectedIntroduction | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
	const input = value as Record<string, unknown>;
	const introducerRef = stringField(input, 'introducer_ref');
	const introducedRef1 = stringField(input, 'introduced_ref_1');
	const introducedRef2 = stringField(input, 'introduced_ref_2');
	const confidence = confidenceField(input);
	if (
		!isPersonRef(introducerRef) ||
		!isPersonRef(introducedRef1) ||
		!isPersonRef(introducedRef2) ||
		confidence === undefined
	) {
		return undefined;
	}
	if (new Set([introducerRef, introducedRef1, introducedRef2]).size !== 3) return undefined;

	const context = stringField(input, 'context') ?? 'other';
	const requestedSourceIds = stringArrayField(input, 'source_message_ids') ?? [];
	const sourceMessageIds = requestedSourceIds.filter((id) => allowedSourceIds.has(id));

	return {
		introducer_ref: introducerRef,
		introduced_ref_1: introducedRef1,
		introduced_ref_2: introducedRef2,
		context: VALID_CONTEXTS.has(context) ? context : 'other',
		confidence,
		reasoning: stringField(input, 'reasoning') ?? 'Local model detected an explicit introduction.',
		source_message_ids: sourceMessageIds.length > 0 ? sourceMessageIds : undefined,
	};
}

function parseLocalIntroductions(
	responseText: string,
	maskedContent: string,
): DetectedIntroduction[] {
	const parsed = parseJsonResponse(responseText);
	const rawIntroductions = Array.isArray(parsed)
		? parsed
		: parsed &&
				typeof parsed === 'object' &&
				Array.isArray((parsed as { introductions?: unknown }).introductions)
			? (parsed as { introductions: unknown[] }).introductions
			: [];
	const allowedSourceIds = allowedSourceIdsFromContent(maskedContent);
	return rawIntroductions
		.map((value) => normalizeDetectedIntroduction(value, allowedSourceIds))
		.filter((intro): intro is DetectedIntroduction => Boolean(intro));
}

async function detectIntroductionsLocal(maskedContent: string): Promise<DetectedIntroduction[]> {
	const runtime = getCommitmentLlmRuntime(process.env);
	if (runtime.mode !== 'local' || !runtime.model) return [];

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
	};
	if (runtime.apiKey) headers.Authorization = `Bearer ${runtime.apiKey}`;

	const messages = [
		{
			role: 'system',
			content: [INTRODUCTION_DETECTION_KERNEL, LOCAL_INTRODUCTION_JSON_KERNEL].join('\n\n'),
		},
		{
			role: 'user',
			content: `Conversation transcript:\n${maskedContent}\n\nReturn detected introductions as JSON.`,
		},
	];

	const response =
		runtime.api === 'ollama'
			? await fetch(runtime.ollamaChatUrl ?? '', {
					method: 'POST',
					headers,
					body: JSON.stringify({
						model: runtime.model,
						messages,
						stream: false,
						think: false,
						format: localIntroductionResponseFormat(),
						options: {
							temperature: 0.1,
							num_predict: LOCAL_INTRO_MAX_TOKENS,
						},
					}),
				})
			: await fetch(runtime.chatCompletionsUrl ?? '', {
					method: 'POST',
					headers,
					body: JSON.stringify({
						model: runtime.model,
						messages,
						temperature: 0.1,
						max_tokens: LOCAL_INTRO_MAX_TOKENS,
						response_format: { type: 'json_object' },
					}),
				});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Local introduction LLM error (${response.status}): ${error}`);
	}

	const data = (await response.json()) as {
		choices?: Array<{ message?: { content?: string | null } }>;
		message?: { content?: string | null };
	};
	const text =
		runtime.api === 'ollama'
			? data.message?.content?.trim()
			: data.choices?.[0]?.message?.content?.trim();
	if (!text) return [];

	return parseLocalIntroductions(text, maskedContent);
}

export function canRunIntroductionDetection(env: Record<string, string | undefined> = process.env) {
	try {
		if (getCommitmentLlmRuntime(env).mode === 'local') return true;
		return isAiProcessingEnabled(env);
	} catch {
		return false;
	}
}

/**
 * Pre-filter check — returns true if text likely contains an introduction.
 * Fast string scan, avoids LLM call for ~95% of messages.
 */
export function hasIntroKeywords(text: string, extraKeywords?: string[]): boolean {
	const lower = text.toLowerCase();
	const allKeywords = extraKeywords
		? [...BUILT_IN_INTRO_KEYWORDS, ...extraKeywords]
		: BUILT_IN_INTRO_KEYWORDS;
	return allKeywords.some((kw) => lower.includes(kw));
}

/**
 * Detect introductions from entity-masked content.
 * Input must be sanitized (contentSanitized) — NEVER raw PII.
 */
export async function detectIntroductions(maskedContent: string): Promise<DetectedIntroduction[]> {
	if (!maskedContent.trim()) return [];
	let localRuntimeEnabled = false;
	try {
		localRuntimeEnabled = getCommitmentLlmRuntime(process.env).mode === 'local';
	} catch {
		return [];
	}
	if (localRuntimeEnabled) {
		try {
			return await detectIntroductionsLocal(maskedContent);
		} catch {
			return [];
		}
	}
	if (!isAiProcessingEnabled()) return [];

	let response: Awaited<ReturnType<typeof inferWithCache>>;
	try {
		response = await inferWithCache(
			INTRODUCTION_DETECTION_KERNEL,
			'',
			'',
			[{ role: 'user', content: maskedContent }],
			{
				tools: [DETECT_INTRODUCTIONS_TOOL],
				helicone: { feature: 'introduction-detection' },
				maxTokens: 1024,
				temperature: 0.1,
			},
		);
	} catch {
		return [];
	}

	const toolBlock = response.content.find(
		(b) => b.type === 'tool_use' && b.name === 'detect_introductions',
	);
	if (!toolBlock || toolBlock.type !== 'tool_use') return [];

	const input = toolBlock.input as { introductions?: DetectedIntroduction[] };
	return Array.isArray(input.introductions) ? input.introductions : [];
}
