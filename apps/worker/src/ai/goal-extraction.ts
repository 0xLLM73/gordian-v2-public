import Anthropic from '@anthropic-ai/sdk';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { getHeliconeHeaders } from './cached-inference';

/**
 * Goal Extraction Pipeline (GI4):
 *
 * Detects goals/objectives from Telegram messages and proposes them for user confirmation.
 * Uses Haiku for extraction — mirrors the commitment extraction pattern.
 *
 * Detection patterns:
 * - "I want to [X] by [Y]" — explicit goal with deadline
 * - "My goal is to [Z]" — explicit goal declaration
 * - "We need to [X] this quarter" — implicit goal with timeframe
 * - "I'm trying to [X]" — intent signal
 * - "Planning to [X] by [date]" — plan with deadline
 */

// ─── Lazy-initialized Haiku client ───────────────────────────────────────────

let _haiku: Anthropic | null = null;
function getHaikuClient(): Anthropic {
	if (!_haiku) {
		_haiku = new Anthropic({
			baseURL: process.env.HELICONE_API_KEY ? 'https://anthropic.helicone.ai' : undefined,
			defaultHeaders: process.env.HELICONE_API_KEY
				? { 'Helicone-Auth': `Bearer ${process.env.HELICONE_API_KEY}` }
				: undefined,
		});
	}
	return _haiku;
}

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// ─── Tool schema ─────────────────────────────────────────────────────────────

const EXTRACT_GOAL_TOOL: Tool = {
	name: 'extract_goal',
	description:
		'Extracts a goal or objective from the conversation. Call ONLY if the speaker expresses a clear goal, ambition, target, or plan they want to achieve.',
	input_schema: {
		type: 'object' as const,
		properties: {
			title: {
				type: 'string',
				description:
					'Concise goal statement (e.g., "Close 3 DeFi deals this quarter", "Meet 10 new LPs by June")',
			},
			type: {
				type: 'string',
				enum: ['network', 'relationship', 'habit', 'business', 'strategic'],
				description:
					'Goal category: network (grow connections), relationship (deepen existing), habit (recurring behavior), business (deals/revenue), strategic (high-level objectives)',
			},
			target_date: {
				type: 'string',
				description: 'ISO8601 date if a deadline is mentioned, or null if no timeframe',
			},
			confidence: {
				type: 'number',
				description:
					'Score 0.0-1.0. How confident this is a real goal vs. casual mention. >0.7 = clear goal, 0.4-0.7 = possible intent, <0.4 = unlikely',
			},
			quote: {
				type: 'string',
				description: 'Exact substring from the message that triggered extraction',
			},
			reasoning: {
				type: 'string',
				description: 'Brief explanation of why this is a goal (for debugging)',
			},
		},
		required: ['title', 'type', 'confidence', 'quote'],
	},
};

// ─── System kernel ───────────────────────────────────────────────────────────

const GOAL_EXTRACTION_KERNEL = `You are a goal/objective extraction engine for a Telegram CRM used by VC professionals and crypto investors.
Detect when the CRM owner expresses goals, targets, ambitions, or plans they want to track.

Detection patterns:
- "I want to [X] by [Y]" — explicit goal with deadline
- "My goal is to [Z]" — explicit goal declaration
- "We need to [X] this quarter" — implicit goal with timeframe
- "I'm trying to [X]" — intent signal
- "Planning to [X] by [date]" — plan with deadline
- "I need to [X]" — when expressing personal objective (not delegating to contact)
- "Targeting [X] by [Y]" — quantified target

Rules:
- ONLY extract goals expressed by the CRM Owner (role="user"), NOT by contacts
- Ignore social pleasantries ("We should raise a fund sometime" = NOT a goal unless concrete)
- "Ape in" or "WAGMI" = NOT goals (crypto slang, not actionable targets)
- Map vague aspirations ("I kinda want to...") to confidence 0.3-0.5
- Map clear goals with deadlines to confidence 0.8-0.95
- Map clear goals without deadlines to confidence 0.6-0.8
- Do NOT extract tasks or commitments — those are handled separately
- A goal is a sustained objective, NOT a one-off action ("Send report" = task, "Grow portfolio to $10M" = goal)
- Call extract_goal for EACH distinct goal you find`;

export interface ExtractedGoal {
	title: string;
	type: 'network' | 'relationship' | 'habit' | 'business' | 'strategic';
	target_date?: string;
	confidence: number;
	quote: string;
	reasoning?: string;
}

export interface GoalExtractionResult {
	goals: ExtractedGoal[];
}

/**
 * Extract goals/objectives from a conversation transcript.
 * Uses Haiku for cost-effective extraction.
 */
export async function extractGoals(
	messages: Array<{ role: string; content: string; timestamp: string }>,
	referenceTime: string,
): Promise<GoalExtractionResult> {
	const transcript = messages
		.map((m) => `[${m.timestamp}] ${m.role === 'user' ? 'CRM Owner' : 'Contact'}: ${m.content}`)
		.join('\n');

	const heliconeHeaders = getHeliconeHeaders({
		feature: 'goal-extraction',
	});

	const response = await getHaikuClient().messages.create(
		{
			model: HAIKU_MODEL,
			max_tokens: 2048,
			temperature: 0.3,
			system: GOAL_EXTRACTION_KERNEL,
			messages: [
				{
					role: 'user',
					content: `Reference time: ${referenceTime}\n\nConversation transcript:\n${transcript}\n\nAnalyze this conversation for goals and objectives expressed by the CRM Owner.`,
				},
			],
			tools: [EXTRACT_GOAL_TOOL],
		},
		{ headers: heliconeHeaders },
	);

	const goals = response.content
		.filter((block) => block.type === 'tool_use')
		.map((block) => (block.type === 'tool_use' ? (block.input as ExtractedGoal) : null))
		.filter((item): item is ExtractedGoal => item !== null);

	console.log(`[goal-extraction] Extracted ${goals.length} goals from ${messages.length} messages`);

	return { goals };
}
