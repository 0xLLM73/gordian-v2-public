import { getChatLlmRuntime } from '@repo/shared';
import { selectPromptVariant } from './bandit';

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
const LOCAL_DRAFT_MAX_TOKENS = 512;
const LOCAL_DRAFT_TEMPERATURE = 0.7;

export interface DraftResult {
	text: string;
	armType: string;
	traceId: string;
}

function cleanLocalDraftText(value: string): string {
	return value
		.replace(/<think>[\s\S]*?<\/think>/gi, '')
		.replace(/^```(?:text|markdown)?\s*/i, '')
		.replace(/\s*```$/i, '')
		.trim();
}

async function callLocalDraftLlm(systemPrompt: string, userPrompt: string): Promise<string> {
	const runtime = getChatLlmRuntime(process.env);
	if (runtime.mode !== 'local' || !runtime.model) {
		throw new Error(
			'Local follow-up draft AI is not configured. Use template-only or reminder-only mode, or configure CHAT_LLM_PROVIDER=local.',
		);
	}

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
	};
	if (runtime.apiKey) headers.Authorization = `Bearer ${runtime.apiKey}`;

	const messages = [
		{ role: 'system', content: systemPrompt },
		{ role: 'user', content: userPrompt },
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
						options: {
							temperature: LOCAL_DRAFT_TEMPERATURE,
							num_predict: LOCAL_DRAFT_MAX_TOKENS,
						},
					}),
				})
			: await fetch(runtime.chatCompletionsUrl ?? '', {
					method: 'POST',
					headers,
					body: JSON.stringify({
						model: runtime.model,
						messages,
						temperature: LOCAL_DRAFT_TEMPERATURE,
						max_tokens: LOCAL_DRAFT_MAX_TOKENS,
					}),
				});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Local follow-up draft AI error (${response.status}): ${error}`);
	}

	const data = (await response.json()) as {
		choices?: Array<{ message?: { content?: string | null } }>;
		message?: { content?: string | null };
	};
	const text =
		runtime.api === 'ollama'
			? data.message?.content?.trim()
			: data.choices?.[0]?.message?.content?.trim();
	const draft = cleanLocalDraftText(text ?? '');
	if (!draft) throw new Error('Local follow-up draft AI returned no message content');
	return draft;
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

	return callLocalDraftLlm(systemKernel, userPrompt);
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
