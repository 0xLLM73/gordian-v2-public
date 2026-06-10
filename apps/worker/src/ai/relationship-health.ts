import { getChatLlmRuntime, redactSensitive } from '@repo/shared';

type LocalRelationshipRole = 'assistant' | 'system' | 'user';

interface LocalRelationshipMessage {
	role: LocalRelationshipRole;
	content: string;
}

export interface RelationshipHealthMessage {
	content: string;
	isOutgoing: boolean;
	sentAt: Date | string;
}

export type RelationshipHealthTopic =
	| 'community'
	| 'finance'
	| 'health'
	| 'personal'
	| 'planning'
	| 'technical'
	| 'travel'
	| 'work'
	| 'other';

export interface RelationshipHealthAiSignals {
	directAsk: {
		confidence: number;
		detected: boolean;
		userOwesReply: boolean;
	};
	draftCheckIn: {
		autoSend: false;
		available: boolean;
		reviewRequired: true;
	};
	meaningfulExchange: {
		confidence: number;
		label: 'meaningful' | 'trivial' | 'unclear';
	};
	runtime: {
		mode: 'local';
		model: string;
		source: string;
	};
	topicLabels: RelationshipHealthTopic[];
	version: 1;
}

const MAX_MESSAGES = 12;
const MAX_CHARS_PER_MESSAGE = 500;
const MAX_TOKENS = 600;
const MIN_CONFIDENCE = 0.55;
const TOPICS = new Set<RelationshipHealthTopic>([
	'community',
	'finance',
	'health',
	'personal',
	'planning',
	'technical',
	'travel',
	'work',
	'other',
]);

const RELATIONSHIP_HEALTH_KERNEL = `You are a local-only relationship health classifier.
Return exactly one JSON object and no prose.

Classify only these bounded fields:
- meaningful_exchange.label: meaningful, trivial, or unclear
- meaningful_exchange.confidence: 0..1
- direct_ask.detected: whether the contact appears to have asked the user for something
- direct_ask.user_owes_reply: whether the latest context suggests the user still owes a reply
- direct_ask.confidence: 0..1
- topic_labels: up to 3 broad categories only: work, personal, planning, finance, health, travel, technical, community, other

Rules:
- Do not quote or summarize private message text.
- Do not include names, exact asks, dates, URLs, or sensitive topics.
- If unsure, use unclear or other with low confidence.
- Drafts are never auto-sent; set draft_check_in.available true only when a light user-reviewed check-in could be helpful.`;

function responseFormat(): Record<string, unknown> {
	return {
		type: 'object',
		additionalProperties: false,
		properties: {
			meaningful_exchange: {
				type: 'object',
				additionalProperties: false,
				properties: {
					label: { type: 'string', enum: ['meaningful', 'trivial', 'unclear'] },
					confidence: { type: 'number' },
				},
				required: ['label', 'confidence'],
			},
			direct_ask: {
				type: 'object',
				additionalProperties: false,
				properties: {
					detected: { type: 'boolean' },
					user_owes_reply: { type: 'boolean' },
					confidence: { type: 'number' },
				},
				required: ['detected', 'user_owes_reply', 'confidence'],
			},
			topic_labels: {
				type: 'array',
				items: {
					type: 'string',
					enum: [...TOPICS],
				},
			},
			draft_check_in: {
				type: 'object',
				additionalProperties: false,
				properties: {
					available: { type: 'boolean' },
				},
				required: ['available'],
			},
		},
		required: ['meaningful_exchange', 'direct_ask', 'topic_labels', 'draft_check_in'],
	};
}

function clamp01(value: unknown): number {
	const num = Number(value);
	if (!Number.isFinite(num)) return 0;
	return Math.max(0, Math.min(1, num));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonObject(text: string): Record<string, unknown> | null {
	const stripped = text
		.trim()
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/\s*```$/i, '')
		.trim();
	const firstBrace = stripped.indexOf('{');
	const lastBrace = stripped.lastIndexOf('}');
	if (firstBrace < 0 || lastBrace <= firstBrace) return null;
	try {
		const parsed = JSON.parse(stripped.slice(firstBrace, lastBrace + 1));
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function normalizeTopic(value: unknown): RelationshipHealthTopic | null {
	if (typeof value !== 'string') return null;
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, '_');
	return TOPICS.has(normalized as RelationshipHealthTopic)
		? (normalized as RelationshipHealthTopic)
		: null;
}

function normalizeSignals(
	parsed: Record<string, unknown>,
	runtime: { model: string; source: string },
): RelationshipHealthAiSignals | undefined {
	const meaningful = parsed.meaningful_exchange;
	const directAsk = parsed.direct_ask;
	const draft = parsed.draft_check_in;
	if (!isRecord(meaningful) || !isRecord(directAsk) || !isRecord(draft)) return undefined;

	const label =
		meaningful.label === 'meaningful' ||
		meaningful.label === 'trivial' ||
		meaningful.label === 'unclear'
			? meaningful.label
			: 'unclear';
	const meaningfulConfidence = clamp01(meaningful.confidence);
	const askConfidence = clamp01(directAsk.confidence);
	const detected = directAsk.detected === true;
	const userOwesReply = directAsk.user_owes_reply === true;

	if (Math.max(meaningfulConfidence, askConfidence) < MIN_CONFIDENCE) return undefined;

	const topics = Array.isArray(parsed.topic_labels)
		? [
				...new Set(
					parsed.topic_labels
						.map((topic) => normalizeTopic(topic))
						.filter((topic): topic is RelationshipHealthTopic => Boolean(topic)),
				),
			].slice(0, 3)
		: [];

	return {
		version: 1,
		meaningfulExchange: {
			label,
			confidence: meaningfulConfidence,
		},
		directAsk: {
			detected,
			userOwesReply,
			confidence: askConfidence,
		},
		topicLabels: topics.length > 0 ? topics : ['other'],
		draftCheckIn: {
			available: draft.available === true,
			reviewRequired: true,
			autoSend: false,
		},
		runtime: {
			mode: 'local',
			model: runtime.model,
			source: runtime.source,
		},
	};
}

function trimMessageContent(content: string): string {
	const normalized = content.replace(/\s+/g, ' ').trim();
	return normalized.length > MAX_CHARS_PER_MESSAGE
		? `${normalized.slice(0, MAX_CHARS_PER_MESSAGE)}...`
		: normalized;
}

function buildTranscript(messages: RelationshipHealthMessage[]): string {
	return messages
		.slice(0, MAX_MESSAGES)
		.reverse()
		.map((message, index) => {
			const sentAt =
				message.sentAt instanceof Date
					? message.sentAt.toISOString()
					: new Date(message.sentAt).toISOString();
			const role = message.isOutgoing ? 'user' : 'contact';
			return `[${index + 1}] ${sentAt} ${role}: ${trimMessageContent(message.content)}`;
		})
		.join('\n');
}

export function canRunLocalRelationshipHealthAnalysis(
	env: Record<string, string | undefined> = process.env,
): boolean {
	try {
		return getChatLlmRuntime(env).mode === 'local';
	} catch {
		return false;
	}
}

export async function analyzeRelationshipHealthLocal(
	messages: RelationshipHealthMessage[],
): Promise<RelationshipHealthAiSignals | undefined> {
	const runtime = getChatLlmRuntime(process.env);
	if (runtime.mode !== 'local' || !runtime.model) return undefined;

	const transcript = buildTranscript(messages.filter((message) => message.content.trim()));
	if (!transcript.trim()) return undefined;

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
	};
	if (runtime.apiKey) headers.Authorization = `Bearer ${runtime.apiKey}`;

	const requestMessages: LocalRelationshipMessage[] = [
		{ role: 'system', content: RELATIONSHIP_HEALTH_KERNEL },
		{
			role: 'user',
			content: `Recent direct-message transcript:\n${transcript}\n\nReturn only bounded relationship health JSON.`,
		},
	];

	try {
		const response =
			runtime.api === 'ollama'
				? await fetch(runtime.ollamaChatUrl ?? '', {
						method: 'POST',
						headers,
						body: JSON.stringify({
							model: runtime.model,
							messages: requestMessages,
							stream: false,
							think: false,
							format: responseFormat(),
							options: {
								temperature: 0.1,
								num_predict: MAX_TOKENS,
							},
						}),
					})
				: await fetch(runtime.chatCompletionsUrl ?? '', {
						method: 'POST',
						headers,
						body: JSON.stringify({
							model: runtime.model,
							messages: requestMessages,
							temperature: 0.1,
							max_tokens: MAX_TOKENS,
							response_format: { type: 'json_object' },
						}),
					});

		if (!response.ok) return undefined;

		const data = (await response.json()) as {
			choices?: Array<{ message?: { content?: string | null } }>;
			message?: { content?: string | null };
		};
		const text =
			runtime.api === 'ollama'
				? data.message?.content?.trim()
				: data.choices?.[0]?.message?.content?.trim();
		if (!text) return undefined;
		return normalizeSignals(parseJsonObject(text) ?? {}, {
			model: runtime.model,
			source: runtime.source,
		});
	} catch (err) {
		console.warn('[relationship-health] Local classifier skipped:', redactSensitive(err));
		return undefined;
	}
}
