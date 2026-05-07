import { maskEntities } from '@repo/crypto';
import { selectPromptVariant } from './bandit';
import { inferWithCache } from './cached-inference';
import { prefilterEntities } from './prefilter';

const SUMMARY_SYSTEM_KERNEL = `You are a relationship intelligence engine for a Telegram-based CRM.
Generate a concise, actionable summary of the user's relationship with a contact.

Structure your summary with these sections:
- OVERVIEW: 2-3 sentence relationship characterization
- KEY TOPICS: Recurring themes in conversations
- RECENT CONTEXT: What has been discussed lately
- OPEN LOOPS: Unresolved items, pending follow-ups
- RELATIONSHIP SIGNALS: Strength indicators, red flags, opportunities

Rules:
- Keep total output under 1500 tokens
- Use bullet points within sections
- Reference specific topics but use pseudonyms (they are already masked)
- If data is sparse, note it honestly rather than fabricating
- Never invent conversations or topics not present in the input`;

const STYLE_VARIANTS = ['summary_formal', 'summary_casual'];
const STYLE_MODIFIERS: Record<string, string> = {
	summary_formal:
		'\n\nUse professional, analytical language. Structure like an executive briefing.',
	summary_casual: '\n\nUse conversational, direct language. Structure like a quick catch-up note.',
};

export interface ContactSummaryInput {
	contactId: string;
	contactName: string;
	workspaceId: string;
	messages: Array<{ role: string; content: string; timestamp: string }>;
	commitmentsSummary: string;
	workspaceSalt: Buffer;
}

export interface ContactSummaryResult {
	summary: string;
	model: string;
	messageCount: number;
	traceId: string;
	variant: string;
}

export async function generateContactSummary(
	input: ContactSummaryInput,
	userId?: string,
): Promise<ContactSummaryResult> {
	// 1. Select style variant via Thompson Sampling
	const { variant, traceId } = await selectPromptVariant('contact_summary', STYLE_VARIANTS, userId);

	// 2. Mask entities in message content before sending to AI
	const maskedMessages = input.messages.map((m) => {
		const { maskedText } = maskEntities(
			m.content,
			input.workspaceSalt,
			prefilterEntities(m.content),
		);
		return { ...m, content: maskedText };
	});

	// 3. Truncate to last 200 messages for context window management
	const truncated = maskedMessages.slice(-200);

	// 4. Build user context
	const conversationHistory = truncated
		.map((m) => `[${m.timestamp}] ${m.role}: ${m.content}`)
		.join('\n');

	const userPrompt = `Contact: ${input.contactName}
Messages analyzed: ${truncated.length} (of ${input.messages.length} total)

Conversation History:
${conversationHistory}

Active Commitments:
${input.commitmentsSummary || 'None'}

Generate a relationship summary for this contact.`;

	// 5. Build modified system kernel with variant
	const modifier = STYLE_MODIFIERS[variant] ?? '';
	const systemKernel = SUMMARY_SYSTEM_KERNEL + modifier;

	// 6. Call Claude via cached inference
	const response = await inferWithCache(
		systemKernel,
		'', // Golden library can be populated later
		'',
		[{ role: 'user', content: userPrompt }],
		{
			maxTokens: 2048,
			temperature: 0.3,
			helicone: { feature: 'contact-summary', banditArm: variant },
		},
	);

	const summary = response.content
		.filter((block) => block.type === 'text')
		.map((block) => (block.type === 'text' ? block.text : ''))
		.join('\n');

	return {
		summary,
		model: 'claude-sonnet-4-6',
		messageCount: truncated.length,
		traceId,
		variant,
	};
}
