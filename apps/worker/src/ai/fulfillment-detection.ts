import Anthropic from '@anthropic-ai/sdk';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { maskEntities } from '@repo/crypto';
import { selectPromptVariant } from './bandit';
import { getHeliconeHeaders } from './cached-inference';
import { prefilterEntities } from './prefilter';

/**
 * Fulfillment Detection — uses Haiku for cost-efficient classification.
 * This is a binary classification task (fulfilled vs not) with evidence
 * extraction, not a generation task. Haiku is 10x cheaper and fast enough.
 */
// Lazy-initialized client — avoids ESM hoisting issue in dev.
let _anthropic: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
	if (!_anthropic) {
		_anthropic = new Anthropic({
			baseURL: process.env.HELICONE_API_KEY ? 'https://anthropic.helicone.ai' : undefined,
			defaultHeaders: process.env.HELICONE_API_KEY
				? { 'Helicone-Auth': `Bearer ${process.env.HELICONE_API_KEY}` }
				: undefined,
		});
	}
	return _anthropic;
}

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

const FULFILLMENT_TOOL: Tool = {
	name: 'report_fulfillment',
	description: 'Report evidence of commitment fulfillment found in messages.',
	input_schema: {
		type: 'object' as const,
		properties: {
			commitment_id: {
				type: 'string',
				description: 'ID of the commitment that was fulfilled',
			},
			fulfilled: {
				type: 'boolean',
				description: 'Whether clear evidence of fulfillment was found',
			},
			evidence: {
				type: 'string',
				description: 'The message excerpt that demonstrates fulfillment',
			},
			confidence: {
				type: 'number',
				description: 'Confidence score 0.0-1.0 that this is genuine fulfillment',
			},
		},
		required: ['commitment_id', 'fulfilled', 'evidence', 'confidence'],
	},
};

const DETECTION_SYSTEM_PROMPT = `You are a commitment fulfillment detector for a CRM system.
You will be given a list of open commitments and recent messages.
Your job is to determine if any commitments have been fulfilled based on message evidence.

Rules:
- Only report fulfillment if there is CLEAR evidence in the messages
- A commitment is fulfilled when the promised action was completed, not just acknowledged
- "I'll send it" is NOT fulfillment. "Here's the document" IS fulfillment.
- Meeting commitments are fulfilled when the meeting actually happened (confirmed, not just scheduled)
- Financial commitments need explicit confirmation of transfer/payment
- If ambiguous, do NOT report as fulfilled
- Call report_fulfillment for EACH commitment that has evidence, with fulfilled=true
- For commitments with no evidence, do NOT call the tool`;

const DETECTION_VARIANTS = ['detection_default', 'detection_strict', 'detection_permissive'];
const DETECTION_MODIFIERS: Record<string, string> = {
	detection_default: '',
	detection_strict:
		'\n\nBe VERY STRICT. Only report fulfillment with unambiguous, direct evidence. Partial completion is NOT fulfillment.',
	detection_permissive:
		'\n\nBe somewhat permissive. If there is reasonable evidence of completion (even indirect), report it with an appropriate confidence score (0.6-0.8).',
};

export interface FulfillmentResult {
	commitmentId: string;
	fulfilled: boolean;
	evidence: string;
	confidence: number;
}

export interface FulfillmentDetectionOutput {
	results: FulfillmentResult[];
	traceId: string;
	variant: string;
}

export async function detectFulfillment(
	activeCommitments: Array<{ id: string; title: string; commitmentType: string; dueDate?: Date }>,
	recentMessages: Array<{ role: string; content: string; timestamp: string }>,
	workspaceSalt: Buffer,
	userId?: string,
): Promise<FulfillmentDetectionOutput> {
	if (activeCommitments.length === 0 || recentMessages.length === 0) {
		return { results: [], traceId: '', variant: 'skipped' };
	}

	// 1. Select variant via Thompson Sampling
	const { variant, traceId } = await selectPromptVariant(
		'fulfillment_detection',
		DETECTION_VARIANTS,
		userId,
	);

	// 2. Mask entities in message content (prefilter + mask)
	const maskedMessages = recentMessages.map((m) => {
		const detected = prefilterEntities(m.content);
		const { maskedText } = maskEntities(m.content, workspaceSalt, detected);
		return { ...m, content: maskedText };
	});

	// 3. Build the prompt
	const commitmentList = activeCommitments
		.map((c) => {
			const dueStr = c.dueDate ? ` (due: ${c.dueDate.toISOString()})` : '';
			return `- ID: ${c.id} | ${c.commitmentType}: "${c.title}"${dueStr}`;
		})
		.join('\n');

	const messageHistory = maskedMessages
		.slice(-100) // Last 100 messages for context
		.map((m) => `[${m.timestamp}] ${m.role}: ${m.content}`)
		.join('\n');

	const modifier = DETECTION_MODIFIERS[variant] ?? '';
	const systemPrompt = DETECTION_SYSTEM_PROMPT + modifier;

	const userPrompt = `Open Commitments:
${commitmentList}

Recent Messages:
${messageHistory}

Check each commitment against the messages and report any that have been fulfilled.`;

	// 4. Call Haiku
	const heliconeHeaders = getHeliconeHeaders({
		feature: 'fulfillment-detection',
		banditArm: variant,
	});

	const response = await getAnthropicClient().messages.create(
		{
			model: HAIKU_MODEL,
			max_tokens: 1024,
			temperature: 0.1, // Low temperature for classification
			system: systemPrompt,
			messages: [{ role: 'user', content: userPrompt }],
			tools: [FULFILLMENT_TOOL],
		},
		{ headers: heliconeHeaders },
	);

	// 5. Parse results — filter to fulfilled=true with confidence >= 0.7
	const results = response.content
		.filter((block) => block.type === 'tool_use')
		.map((block) => {
			if (block.type !== 'tool_use') return null;
			const input = block.input as {
				commitment_id: string;
				fulfilled: boolean;
				evidence: string;
				confidence: number;
			};
			return {
				commitmentId: input.commitment_id,
				fulfilled: input.fulfilled,
				evidence: input.evidence,
				confidence: input.confidence,
			};
		})
		// biome-ignore lint/complexity/useOptionalChain: r != null guard required for TS type narrowing
		.filter((r): r is FulfillmentResult => r != null && r.fulfilled && r.confidence >= 0.7);

	console.log(
		`[fulfillment] variant=${variant} checked=${activeCommitments.length} fulfilled=${results.length}`,
	);

	return { results, traceId, variant };
}
