import type { SealedEnvelope } from '@repo/crypto';
import { getChatLlmRuntime, redactSensitive } from '@repo/shared';
import { CHAT_TOOLS, TOOL_EXECUTORS } from './chat-tools';

type LocalChatRole = 'system' | 'user' | 'assistant';

interface LocalChatMessage {
	role: LocalChatRole;
	content: string;
}

interface ChatMessage {
	role: 'user' | 'assistant';
	content: string;
}

interface LocalToolCall {
	id?: string;
	name: string;
	input: Record<string, unknown>;
}

interface LocalToolResult {
	tool_use_id: string;
	name: string;
	content: string;
	is_error?: boolean;
}

export interface LocalChatOptions {
	workspaceId: string;
	envelope: SealedEnvelope;
	messages: ChatMessage[];
	systemPrompt: string;
	domainKnowledge?: string;
	maxIterations: number;
	onToolStart?: (toolName: string) => Promise<void>;
	onToolEnd?: (toolName: string) => Promise<void>;
	onProposal?: (proposal: unknown) => Promise<void>;
	onWriteToolUse?: (toolName: string) => Promise<void>;
	limitDraftMessages?: boolean;
}

export interface LocalChatResult {
	response: string;
	toolsUsed: string[];
}

const LOCAL_CHAT_MAX_TOKENS = 2048;
const ALLOWED_PROPOSAL_ACTIONS = new Set([
	'create_commitment',
	'create_deal',
	'create_goal',
	'update_deal_stage',
	'draft_message',
]);
const WRITE_TOOLS = new Set([
	'create_commitment',
	'create_deal',
	'create_goal',
	'update_deal_stage',
]);

const LOCAL_CHAT_JSON_KERNEL = `You are running in local-only chat mode.
You must return exactly one JSON object and no surrounding prose.

Return an answer when you have enough information:
{"type":"answer","response":"concise answer for the user"}

Request tools when you need application data:
{"type":"tool_use","tools":[{"id":"tool_1","name":"search_contacts","input":{"name":"Alice"}}]}

Rules:
- Use only the listed tools and their JSON input schemas.
- Do not invent contacts, deals, commitments, or knowledge graph facts.
- If a tool returns no results, say that plainly in the final answer.
- Never expose raw internal IDs in the final answer unless the user explicitly asks for identifiers.
- For write-like tools, present the returned proposal for user confirmation. Do not say the action is complete.`;

function localChatResponseFormat(): Record<string, unknown> {
	return {
		type: 'object',
		additionalProperties: true,
		properties: {
			type: { type: 'string', enum: ['answer', 'tool_use'] },
			response: { type: 'string' },
			tools: {
				type: 'array',
				items: {
					type: 'object',
					additionalProperties: true,
					properties: {
						id: { type: 'string' },
						name: { type: 'string' },
						input: { type: 'object' },
					},
					required: ['name'],
				},
			},
		},
		required: ['type'],
	};
}

export function shouldUseLocalChat(env: NodeJS.ProcessEnv = process.env): boolean {
	return getChatLlmRuntime(env).mode === 'local';
}

function toolSpecs(): Array<Record<string, unknown>> {
	return CHAT_TOOLS.map((tool) => ({
		name: tool.name,
		description: tool.description,
		input_schema: tool.input_schema,
	}));
}

function buildSystemMessage(systemPrompt: string, domainKnowledge?: string): string {
	const parts = [
		systemPrompt,
		LOCAL_CHAT_JSON_KERNEL,
		`Available tools:\n${JSON.stringify(toolSpecs(), null, 2)}`,
	];
	if (domainKnowledge?.trim()) {
		parts.push(`Context already available on the current page:\n${domainKnowledge.trim()}`);
	}
	return parts.join('\n\n');
}

function stripJsonFence(text: string): string {
	return text
		.trim()
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/\s*```$/i, '')
		.trim();
}

function parseLocalChatJson(text: string): Record<string, unknown> {
	const stripped = stripJsonFence(text);
	const firstBrace = stripped.indexOf('{');
	const lastBrace = stripped.lastIndexOf('}');
	if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
		throw new Error('Local chat returned non-JSON content');
	}
	return JSON.parse(stripped.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
}

function normalizeToolInput(input: unknown): Record<string, unknown> {
	return typeof input === 'object' && input !== null && !Array.isArray(input)
		? (input as Record<string, unknown>)
		: {};
}

function normalizeToolCalls(parsed: Record<string, unknown>): LocalToolCall[] {
	const type = typeof parsed.type === 'string' ? parsed.type : '';
	if (type !== 'tool_use' && !Array.isArray(parsed.tools) && !parsed.tool) return [];

	const rawTools = Array.isArray(parsed.tools) ? parsed.tools : parsed.tool ? [parsed.tool] : [];
	const calls: LocalToolCall[] = [];
	for (const raw of rawTools) {
		if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
		const candidate = raw as Record<string, unknown>;
		const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
		if (!name) continue;
		calls.push({
			id: typeof candidate.id === 'string' && candidate.id ? candidate.id : undefined,
			name,
			input: normalizeToolInput(candidate.input),
		});
	}
	return calls;
}

function normalizeAnswer(parsed: Record<string, unknown>): string {
	for (const key of ['response', 'answer', 'content', 'text']) {
		const value = parsed[key];
		if (typeof value === 'string' && value.trim()) return value.trim();
	}
	return '';
}

function formatToolResults(results: LocalToolResult[]): string {
	return `Tool results:\n${JSON.stringify(results, null, 2)}\n\nUse these results to either request another tool as JSON or return a final JSON answer.`;
}

async function callLocalChat(messages: LocalChatMessage[]): Promise<string> {
	const runtime = getChatLlmRuntime(process.env);
	if (runtime.mode !== 'local' || !runtime.model) {
		throw new Error('Local chat LLM runtime is not configured');
	}

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
	};
	if (runtime.apiKey) headers.Authorization = `Bearer ${runtime.apiKey}`;

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
						format: localChatResponseFormat(),
						options: {
							temperature: 0.2,
							num_predict: LOCAL_CHAT_MAX_TOKENS,
						},
					}),
				})
			: await fetch(runtime.chatCompletionsUrl ?? '', {
					method: 'POST',
					headers,
					body: JSON.stringify({
						model: runtime.model,
						messages,
						temperature: 0.2,
						max_tokens: LOCAL_CHAT_MAX_TOKENS,
						response_format: { type: 'json_object' },
					}),
				});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Local chat LLM error (${response.status}): ${error}`);
	}

	const data = (await response.json()) as {
		choices?: Array<{ message?: { content?: string | null } }>;
		message?: { content?: string | null };
	};
	const text =
		runtime.api === 'ollama'
			? data.message?.content?.trim()
			: data.choices?.[0]?.message?.content?.trim();
	if (!text) throw new Error('Local chat LLM returned no message content');
	return text;
}

function emitProposalIfAllowed(
	result: string,
	onProposal?: (proposal: unknown) => Promise<void>,
): {
	action?: string;
} {
	if (!onProposal) return {};
	try {
		const parsed = JSON.parse(result) as { type?: string; action?: string };
		if (
			parsed.type === 'proposal' &&
			parsed.action &&
			ALLOWED_PROPOSAL_ACTIONS.has(parsed.action)
		) {
			return { action: parsed.action };
		}
	} catch {
		// Tool did not return JSON. Nothing to emit.
	}
	return {};
}

async function executeToolCalls(
	toolCalls: LocalToolCall[],
	options: LocalChatOptions,
	toolsUsed: string[],
	state: { hasDraftedThisRequest: boolean },
): Promise<LocalToolResult[]> {
	const results: LocalToolResult[] = [];

	for (const [index, call] of toolCalls.entries()) {
		const toolUseId = call.id ?? `local_tool_${index + 1}`;
		toolsUsed.push(call.name);
		await options.onToolStart?.(call.name);

		try {
			if (
				options.limitDraftMessages &&
				call.name === 'draft_message' &&
				state.hasDraftedThisRequest
			) {
				results.push({
					tool_use_id: toolUseId,
					name: call.name,
					content:
						'Only one draft per request. Ask the user to confirm or discard the current draft first.',
					is_error: true,
				});
				continue;
			}

			const executor = TOOL_EXECUTORS[call.name];
			if (!executor) {
				results.push({
					tool_use_id: toolUseId,
					name: call.name,
					content: `Unknown tool: ${call.name}`,
					is_error: true,
				});
				continue;
			}

			const result = await executor(call.input, options.workspaceId, options.envelope);
			const proposal = emitProposalIfAllowed(result, options.onProposal);
			if (proposal.action) {
				await options.onProposal?.(JSON.parse(result));
				if (proposal.action === 'draft_message') state.hasDraftedThisRequest = true;
			}
			if (WRITE_TOOLS.has(call.name)) {
				await options.onWriteToolUse?.(call.name);
			}
			results.push({
				tool_use_id: toolUseId,
				name: call.name,
				content: result,
			});
		} catch (err) {
			console.error(`[local-chat] Tool ${call.name} error:`, redactSensitive(err));
			results.push({
				tool_use_id: toolUseId,
				name: call.name,
				content: 'Tool execution failed. Please try a different approach.',
				is_error: true,
			});
		} finally {
			await options.onToolEnd?.(call.name);
		}
	}

	return results;
}

export async function runLocalChat(options: LocalChatOptions): Promise<LocalChatResult> {
	const localMessages: LocalChatMessage[] = [
		{ role: 'system', content: buildSystemMessage(options.systemPrompt, options.domainKnowledge) },
		...options.messages.map((message) => ({
			role: message.role,
			content: message.content,
		})),
	];
	const toolsUsed: string[] = [];
	const state = { hasDraftedThisRequest: false };

	for (let iteration = 0; iteration < options.maxIterations; iteration++) {
		const modelText = await callLocalChat(localMessages);
		let parsed: Record<string, unknown>;
		try {
			parsed = parseLocalChatJson(modelText);
		} catch (err) {
			console.error('[local-chat] Failed to parse local chat response:', redactSensitive(err));
			return {
				response:
					'I could not complete the local chat request because the local model returned an invalid response. Try a more specific question.',
				toolsUsed,
			};
		}

		const toolCalls = normalizeToolCalls(parsed);
		if (toolCalls.length > 0) {
			localMessages.push({ role: 'assistant', content: JSON.stringify(parsed) });
			const toolResults = await executeToolCalls(toolCalls, options, toolsUsed, state);
			localMessages.push({ role: 'user', content: formatToolResults(toolResults) });
			continue;
		}

		const answer = normalizeAnswer(parsed);
		return {
			response: answer || 'I was unable to complete the local chat request.',
			toolsUsed,
		};
	}

	return {
		response:
			'I reached the maximum number of local tool calls. Here is what I found so far. Please try a more specific question.',
		toolsUsed,
	};
}
