import type { Tool } from '@anthropic-ai/sdk/resources/messages';
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
- Do not invent, expand, or return raw names; use only aliases/refs from the input
- If messages include [source:<id>] tags, include only the source_message_ids that directly support each introduction
- confidence: 0.9 = explicit "let me introduce", 0.5 = implied connection, 0.3 = weak/uncertain
- Context types: deal (business intro), hiring (job-related), knowledge (expertise sharing), social (personal), other
- Call detect_introductions with ALL detected introductions, or an empty array if none
- Be conservative — false negatives are better than false positives`;

/** Keyword pre-filter — only ~5% of conversations contain introductions */
const INTRO_KEYWORDS = [
	'introduce',
	'meet',
	'connect',
	'adding',
	'cc',
	'forwarded',
	'reach out',
	'in touch',
	'put you in',
	'loop in',
];

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

/**
 * Pre-filter check — returns true if text likely contains an introduction.
 * Fast string scan, avoids LLM call for ~95% of messages.
 */
export function hasIntroKeywords(text: string, extraKeywords?: string[]): boolean {
	const lower = text.toLowerCase();
	const allKeywords = extraKeywords ? [...INTRO_KEYWORDS, ...extraKeywords] : INTRO_KEYWORDS;
	return allKeywords.some((kw) => lower.includes(kw));
}

/**
 * Detect introductions from entity-masked content.
 * Input must be sanitized (contentSanitized) — NEVER raw PII.
 */
export async function detectIntroductions(maskedContent: string): Promise<DetectedIntroduction[]> {
	if (!maskedContent.trim()) return [];

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
