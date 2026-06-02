import type Anthropic from '@anthropic-ai/sdk';
import type { SealedEnvelope } from '@repo/crypto';
import { redactSensitive } from '@repo/shared';
import { inferWithCache } from './cached-inference';
import { CHAT_TOOLS, TOOL_EXECUTORS } from './chat-tools';
import { runLocalChat, shouldUseLocalChat } from './local-chat';

const MAX_ITERATIONS = 5;
const MAX_MESSAGES = 50;

export const CHAT_SYSTEM_KERNEL = `You are Gordian, an AI assistant for a Telegram-based CRM.
You help the user understand their contacts, deals, commitments, and relationship history.

Rules:
- Answer questions using the available tools to look up real data
- Never fabricate contacts, deals, or commitments — only reference what tools return
- If a search returns no results, say so honestly
- Keep responses concise and actionable
- When referencing contacts, always use contactFirstName/contactLastName from tool results — never guess a name from context
- For commitment questions, note the contact name, status (active/draft/completed), assignee, and due dates
- For deal questions, note the contact name, stage, and value
- Tool results contain only user-relevant fields. Do not show raw IDs to the user — use names instead.
- When search results include 'rationale' or 'decision' type nodes, synthesize a provenance narrative: what decisions were made, what rationales were cited, and what outcomes resulted. Highlight patterns like "you've cited this rationale N times with X% positive outcomes."
- When proposing a write action (create_commitment, update_deal_stage, draft_message), present it as a confirmation request with key details. Do NOT claim the action is done — the user must confirm it first.`;

export interface ChatMessage {
	role: 'user' | 'assistant';
	content: string;
}

export interface ChatResult {
	response: string;
	toolsUsed: string[];
}

export async function chat(
	workspaceId: string,
	envelope: SealedEnvelope,
	messages: ChatMessage[],
): Promise<ChatResult> {
	// Trim to most recent messages if over limit
	const trimmed =
		messages.length > MAX_MESSAGES ? messages.slice(messages.length - MAX_MESSAGES) : messages;

	if (shouldUseLocalChat()) {
		return runLocalChat({
			workspaceId,
			envelope,
			messages: trimmed,
			systemPrompt: CHAT_SYSTEM_KERNEL,
			maxIterations: MAX_ITERATIONS,
		});
	}

	// Build Anthropic message format
	const anthropicMessages: Anthropic.Messages.MessageParam[] = trimmed.map((m) => ({
		role: m.role,
		content: m.content,
	}));

	const toolsUsed: string[] = [];

	// Agentic tool-use loop
	for (let i = 0; i < MAX_ITERATIONS; i++) {
		const response = await inferWithCache(CHAT_SYSTEM_KERNEL, '', '', anthropicMessages, {
			tools: CHAT_TOOLS,
			maxTokens: 2048,
			temperature: 0.3,
			helicone: { feature: 'ai-chat' },
		});

		// If the model returned text (end_turn), extract and return
		if (response.stop_reason === 'end_turn') {
			const text = response.content
				.filter((block) => block.type === 'text')
				.map((block) => (block.type === 'text' ? block.text : ''))
				.join('\n');
			return { response: text, toolsUsed };
		}

		// If the model wants to use tools, execute them
		if (response.stop_reason === 'tool_use') {
			// Add assistant message with tool_use blocks
			anthropicMessages.push({ role: 'assistant', content: response.content });

			// Execute each tool call and build tool_result messages
			const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
			for (const block of response.content) {
				if (block.type === 'tool_use') {
					toolsUsed.push(block.name);
					try {
						const executor = TOOL_EXECUTORS[block.name];
						if (!executor) {
							toolResults.push({
								type: 'tool_result',
								tool_use_id: block.id,
								content: `Unknown tool: ${block.name}`,
								is_error: true,
							});
							continue;
						}
						const result = await executor(
							block.input as Record<string, unknown>,
							workspaceId,
							envelope,
						);
						toolResults.push({
							type: 'tool_result',
							tool_use_id: block.id,
							content: result,
						});
					} catch (err) {
						console.error(`[chat] Tool ${block.name} error:`, redactSensitive(err));
						toolResults.push({
							type: 'tool_result',
							tool_use_id: block.id,
							content: 'Tool execution failed. Please try a different approach.',
							is_error: true,
						});
					}
				}
			}

			anthropicMessages.push({ role: 'user', content: toolResults });
			continue;
		}

		// Unexpected stop reason — extract any text and return
		const fallbackText = response.content
			.filter((block) => block.type === 'text')
			.map((block) => (block.type === 'text' ? block.text : ''))
			.join('\n');
		return {
			response: fallbackText || 'I was unable to complete the request.',
			toolsUsed,
		};
	}

	// Hit max iterations — return whatever the last response had
	return {
		response:
			'I reached the maximum number of tool calls. Here is what I found so far. Please try a more specific question.',
		toolsUsed,
	};
}
