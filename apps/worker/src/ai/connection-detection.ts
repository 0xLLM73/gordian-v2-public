import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import {
	BUILT_IN_CONNECTION_KEYWORDS,
	getCommitmentLlmRuntime,
	isAiProcessingEnabled,
} from '@repo/shared';
import { inferWithCache } from './cached-inference';

/**
 * New Connection Detection.
 * Uses Claude tool_use to detect first-meeting signals between two people.
 * Captures event/conference name when mentioned.
 * Operates on entity-masked content only (contentSanitized) — NEVER raw PII.
 *
 * Keyword pre-filter gates the LLM call: most messages have no new connection signals,
 * so this runs at near-zero cost for most conversations.
 */

const DETECT_CONNECTIONS_TOOL: Tool = {
	name: 'detect_new_connections',
	description: 'Detect first-meeting signals between people in conversations',
	input_schema: {
		type: 'object' as const,
		properties: {
			connections: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						contact_name: {
							type: 'string',
							description: 'Pseudonymized name of the person the user met',
						},
						event: {
							type: ['string', 'null'],
							description: 'Event or conference name if mentioned (e.g., "ETHDenver", "Token2049")',
						},
						context: {
							type: 'string',
							description: 'Brief AI description of the meeting context',
						},
						confidence: { type: 'number', minimum: 0, maximum: 1 },
						reasoning: { type: 'string' },
						source_message_ids: {
							type: 'array',
							items: { type: 'string' },
							description:
								'Message source IDs from [source:<id>] tags that directly support this connection',
						},
					},
					required: ['contact_name', 'event', 'context', 'confidence', 'reasoning'],
				},
			},
		},
		required: ['connections'],
	},
};

const CONNECTION_DETECTION_KERNEL = `You are a new-connection detection engine for a professional CRM.
Analyze conversation content to identify first-meeting signals between the user and another person.

Rules:
- Only detect first-meeting signals — "great to meet you", "pleasure connecting", "nice meeting you at X"
- This is a 2-person pattern (user + contact), NOT 3-person introductions
- Extract event/conference name into the event field when mentioned (e.g., "ETHDenver", "Token2049", "hackathon")
- Entity names are pseudonymized (e.g., PERSON_a1b2) — preserve them exactly as given
- If messages include [source:<id>] tags, include only the source_message_ids that directly support each connection
- confidence: 0.9 = explicit "great to meet you", 0.6 = implied first meeting, 0.3 = weak/uncertain
- Do NOT flag ongoing conversations or people who clearly already know each other
- Call detect_new_connections with ALL detected connections, or an empty array if none
- Be conservative — false negatives are better than false positives`;

export interface DetectedConnection {
	contact_name: string;
	event: string | null;
	context: string;
	confidence: number;
	reasoning: string;
	source_message_ids?: string[];
}

const LOCAL_CONNECTION_MAX_TOKENS = 1024;

const LOCAL_CONNECTION_JSON_KERNEL = `Return only valid JSON with this exact shape:
{
  "connections": [
    {
      "contact_name": "PERSON_x",
      "event": "event name or null",
      "context": "brief masked context",
      "confidence": 0.0,
      "reasoning": "brief masked explanation",
      "source_message_ids": ["message uuid"]
    }
  ]
}

Rules:
- Use only PERSON_* refs present in the transcript when a contact ref is available.
- If the transcript does not include a contact ref, use "CONTACT" for contact_name.
- Include only source IDs that appear in [source:...] tags.
- Return {"connections": []} if there is no explicit first-meeting signal.`;

function localConnectionResponseFormat(): Record<string, unknown> {
	return {
		type: 'object',
		properties: {
			connections: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						contact_name: { type: 'string' },
						event: { type: ['string', 'null'] },
						context: { type: 'string' },
						confidence: { type: 'number' },
						reasoning: { type: 'string' },
						source_message_ids: { type: 'array', items: { type: 'string' } },
					},
					required: ['contact_name', 'event', 'context', 'confidence', 'reasoning'],
				},
			},
		},
		required: ['connections'],
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

function nullableStringField(input: Record<string, unknown>, key: string): string | null {
	const value = input[key];
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
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

function allowedSourceIdsFromContent(content: string): Set<string> {
	const allowed = new Set<string>();
	for (const match of content.matchAll(/\[source:([^\]]+)\]/g)) {
		if (match[1]) allowed.add(match[1]);
	}
	return allowed;
}

function normalizeDetectedConnection(
	value: unknown,
	allowedSourceIds: Set<string>,
): DetectedConnection | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
	const input = value as Record<string, unknown>;
	const contactName = stringField(input, 'contact_name');
	const confidence = confidenceField(input);
	if (!contactName || confidence === undefined) return undefined;

	const requestedSourceIds = stringArrayField(input, 'source_message_ids') ?? [];
	const sourceMessageIds = requestedSourceIds.filter((id) => allowedSourceIds.has(id));

	return {
		contact_name: contactName,
		event: nullableStringField(input, 'event'),
		context: stringField(input, 'context') ?? 'First-meeting signal detected.',
		confidence,
		reasoning: stringField(input, 'reasoning') ?? 'Local model detected a first-meeting signal.',
		source_message_ids: sourceMessageIds.length > 0 ? sourceMessageIds : undefined,
	};
}

function parseLocalConnections(responseText: string, maskedContent: string): DetectedConnection[] {
	const parsed = parseJsonResponse(responseText);
	const rawConnections = Array.isArray(parsed)
		? parsed
		: parsed &&
				typeof parsed === 'object' &&
				Array.isArray((parsed as { connections?: unknown }).connections)
			? (parsed as { connections: unknown[] }).connections
			: [];
	const allowedSourceIds = allowedSourceIdsFromContent(maskedContent);
	return rawConnections
		.map((value) => normalizeDetectedConnection(value, allowedSourceIds))
		.filter((connection): connection is DetectedConnection => Boolean(connection));
}

async function detectConnectionsLocal(maskedContent: string): Promise<DetectedConnection[]> {
	const runtime = getCommitmentLlmRuntime(process.env);
	if (runtime.mode !== 'local' || !runtime.model) return [];

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
	};
	if (runtime.apiKey) headers.Authorization = `Bearer ${runtime.apiKey}`;

	const messages = [
		{
			role: 'system',
			content: [CONNECTION_DETECTION_KERNEL, LOCAL_CONNECTION_JSON_KERNEL].join('\n\n'),
		},
		{
			role: 'user',
			content: `Conversation transcript:\n${maskedContent}\n\nReturn detected new connections as JSON.`,
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
						format: localConnectionResponseFormat(),
						options: {
							temperature: 0.1,
							num_predict: LOCAL_CONNECTION_MAX_TOKENS,
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
						max_tokens: LOCAL_CONNECTION_MAX_TOKENS,
						response_format: { type: 'json_object' },
					}),
				});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Local connection LLM error (${response.status}): ${error}`);
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

	return parseLocalConnections(text, maskedContent);
}

export function canRunConnectionDetection(env: Record<string, string | undefined> = process.env) {
	try {
		if (getCommitmentLlmRuntime(env).mode === 'local') return true;
		return isAiProcessingEnabled(env);
	} catch {
		return false;
	}
}

/**
 * Pre-filter check — returns true if text likely contains a new-connection signal.
 * Fast string scan, avoids LLM call for most messages.
 */
export function hasConnectionKeywords(text: string, extraKeywords?: string[]): boolean {
	const lower = text.toLowerCase();
	const allKeywords = extraKeywords
		? [...BUILT_IN_CONNECTION_KEYWORDS, ...extraKeywords]
		: BUILT_IN_CONNECTION_KEYWORDS;
	return allKeywords.some((kw) => lower.includes(kw));
}

/**
 * Detect new connections from entity-masked content.
 * Input must be sanitized (contentSanitized) — NEVER raw PII.
 */
export async function detectConnections(maskedContent: string): Promise<DetectedConnection[]> {
	if (!maskedContent.trim()) return [];
	let localRuntimeEnabled = false;
	try {
		localRuntimeEnabled = getCommitmentLlmRuntime(process.env).mode === 'local';
	} catch {
		return [];
	}
	if (localRuntimeEnabled) {
		try {
			return await detectConnectionsLocal(maskedContent);
		} catch {
			return [];
		}
	}
	if (!isAiProcessingEnabled()) return [];

	let response: Awaited<ReturnType<typeof inferWithCache>>;
	try {
		response = await inferWithCache(
			CONNECTION_DETECTION_KERNEL,
			'',
			'',
			[{ role: 'user', content: maskedContent }],
			{
				tools: [DETECT_CONNECTIONS_TOOL],
				helicone: { feature: 'connection-detection' },
				maxTokens: 1024,
				temperature: 0.1,
			},
		);
	} catch {
		return [];
	}

	const toolBlock = response.content.find(
		(b) => b.type === 'tool_use' && b.name === 'detect_new_connections',
	);
	if (!toolBlock || toolBlock.type !== 'tool_use') return [];

	const input = toolBlock.input as { connections?: DetectedConnection[] };
	return Array.isArray(input.connections) ? input.connections : [];
}
