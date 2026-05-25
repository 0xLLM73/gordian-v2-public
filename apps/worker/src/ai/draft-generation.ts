import { selectPromptVariant } from './bandit';
import { inferWithCache } from './cached-inference';

const DRAFT_SYSTEM_KERNEL = `You are a message drafting assistant for a Telegram CRM called Gordian.
Generate a natural, contextual message draft the user can send to their contact.

Rules:
- Keep drafts concise (2-4 sentences max)
- Match the tone specified by the style instructions below
- Reference specific details from the contact summary and recent messages
- Never fabricate facts — only reference what's provided
- End with a clear call to action or question when appropriate`;

const ARM_INSTRUCTIONS: Record<string, string> = {
	casual_nudge:
		'\n\nStyle: Casual and friendly. Use informal language. Keep it light — like texting a friend. Include a small personal touch.',
	professional_value:
		'\n\nStyle: Professional and value-driven. Lead with something useful (insight, resource, update). Formal but warm tone.',
	direct_ask:
		'\n\nStyle: Direct and to-the-point. State what you need clearly. No preamble. Respectful but efficient.',
	soft_memory:
		'\n\nStyle: Warm and memory-driven. Reference a shared experience or past conversation. Build rapport through recall.',
};

const DRAFT_VARIANTS = Object.keys(ARM_INSTRUCTIONS);

export interface DraftResult {
	text: string;
	armType: string;
	traceId: string;
}

export async function generateDraft(
	contactSummary: string,
	recentMessages: string,
	armType: string,
	voiceModifier?: string,
): Promise<string> {
	// Callers must pass masked/pseudonymized context; this helper talks to external AI.
	const modifier = ARM_INSTRUCTIONS[armType] ?? '';
	const systemKernel = DRAFT_SYSTEM_KERNEL + (voiceModifier || '') + modifier;

	const userPrompt = `Contact Summary:\n${contactSummary}\n\nRecent Messages:\n${recentMessages}\n\nGenerate a message draft for this contact.`;

	const response = await inferWithCache(
		systemKernel,
		'',
		'',
		[{ role: 'user', content: userPrompt }],
		{
			maxTokens: 512,
			temperature: 0.7,
			helicone: { feature: 'draft-generation', banditArm: armType },
		},
	);

	return response.content
		.filter((block) => block.type === 'text')
		.map((block) => (block.type === 'text' ? block.text : ''))
		.join('\n');
}

export async function generateDraftWithBandit(
	contactSummary: string,
	recentMessages: string,
	userId: string,
	voiceModifier?: string,
): Promise<DraftResult> {
	const { variant, traceId } = await selectPromptVariant(
		'draft_generation',
		DRAFT_VARIANTS,
		userId,
	);

	const text = await generateDraft(contactSummary, recentMessages, variant, voiceModifier);

	console.log(`[draft-bandit] arm=${variant} traceId=${traceId} userId=${userId.slice(0, 8)}`);

	return { text, armType: variant, traceId };
}
