import type { Tool } from '@anthropic-ai/sdk/resources/messages';
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
- confidence: 0.9 = explicit "great to meet you", 0.6 = implied first meeting, 0.3 = weak/uncertain
- Do NOT flag ongoing conversations or people who clearly already know each other
- Call detect_new_connections with ALL detected connections, or an empty array if none
- Be conservative — false negatives are better than false positives`;

/** Keyword pre-filter — only a small % of conversations contain new-connection signals */
const CONNECTION_KEYWORDS = [
	'meet',
	'meeting',
	'met',
	'pleasure',
	'connect',
	'connecting',
	'connected',
	'conference',
	'event',
	'summit',
	'great to',
	'nice to',
	'first time',
	'glad we',
	'pleasure to',
	'lovely to',
	'just met',
	'new connection',
];

export interface DetectedConnection {
	contact_name: string;
	event: string | null;
	context: string;
	confidence: number;
	reasoning: string;
}

/**
 * Pre-filter check — returns true if text likely contains a new-connection signal.
 * Fast string scan, avoids LLM call for most messages.
 */
export function hasConnectionKeywords(text: string): boolean {
	const lower = text.toLowerCase();
	return CONNECTION_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Detect new connections from entity-masked content.
 * Input must be sanitized (contentSanitized) — NEVER raw PII.
 */
export async function detectConnections(maskedContent: string): Promise<DetectedConnection[]> {
	if (!maskedContent.trim()) return [];

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
