import type Anthropic from '@anthropic-ai/sdk';
import {
	deriveKeys,
	maskEntities,
	prefilterEntities,
	type SealedEnvelope,
	unwrapWrk,
} from '@repo/crypto';
import { getCommitmentsByContact, getDealsByContact } from '@repo/db';
import { redactSensitive } from '@repo/shared';
import { inferWithCache, streamInfer } from './cached-inference';
import type { ChatMessage } from './chat';
import { CHAT_SYSTEM_KERNEL } from './chat';
import { CHAT_TOOLS, TOOL_EXECUTORS } from './chat-tools';
import { runLocalChat, shouldUseLocalChat } from './local-chat';
import { MODEL_IDS, routeQuery } from './query-router';
import {
	checkSemanticCache,
	embedMaskedQuery,
	invalidateCacheForTool,
	storeSemanticCache,
} from './semantic-cache';

const MAX_ITERATIONS = 3;
const MAX_MESSAGES = 50;

export interface ChatContext {
	page: string;
	contactId?: string;
	contactName?: string;
	contactSummary?: string;
	dealId?: string;
	dealTitle?: string;
}

export interface StreamCallbacks {
	onToolStart: (toolName: string) => Promise<void>;
	onToolEnd: (toolName: string) => Promise<void>;
	onTextDelta: (text: string) => Promise<void>;
	onDone: (toolsUsed: string[]) => Promise<void>;
	onError: (error: string) => Promise<void>;
	onProposal?: (proposal: unknown) => Promise<void>;
}

/**
 * Build a context-aware system prompt by extending CHAT_SYSTEM_KERNEL
 * with page-specific context when available.
 */
export function buildSystemPrompt(context?: ChatContext): string {
	if (!context?.contactId) return CHAT_SYSTEM_KERNEL;

	const contactName = context.contactName || 'this contact';
	let prompt = `${CHAT_SYSTEM_KERNEL}\n\nThe user is currently viewing the contact page for ${contactName} (ID: ${context.contactId}).`;
	prompt += `\nWhen the user asks about "this contact", "them", or "they", they mean ${contactName}.`;

	if (context.contactSummary) {
		prompt += `\n\nContact Summary: ${context.contactSummary}`;
	}

	return prompt;
}

/**
 * Pre-fetch contact data (deals + commitments) for injection as Layer 3
 * domain knowledge. Eliminates unnecessary tool calls for data the user
 * is already looking at on the contact page.
 */
async function prefetchContactContext(
	workspaceId: string,
	contactId: string,
	envelope: SealedEnvelope,
): Promise<string> {
	const parts: string[] = [];

	try {
		const [deals, commitments] = await Promise.all([
			getDealsByContact(workspaceId, contactId, envelope),
			getCommitmentsByContact(workspaceId, contactId, envelope, { limit: 10 }),
		]);

		if (deals.length > 0) {
			parts.push(`Contact's Deals:\n${JSON.stringify(deals.slice(0, 10), null, 2)}`);
		}
		if (commitments.length > 0) {
			parts.push(`Contact's Commitments:\n${JSON.stringify(commitments.slice(0, 10), null, 2)}`);
		}
	} catch (err) {
		console.error('[chat-stream] Failed to prefetch contact context:', redactSensitive(err));
	}

	return parts.join('\n\n');
}

/**
 * Streaming chat engine. Runs the agentic tool-use loop with non-streaming
 * inferWithCache() calls, emitting tool callbacks. When the model produces
 * a final text response (stop_reason: 'end_turn'), re-runs the final call
 * with streamInfer() to stream text deltas token-by-token.
 *
 * @param workspaceId - Workspace scope for DAL calls
 * @param envelope    - SealedEnvelope for encrypted DAL access
 * @param messages    - Conversation history
 * @param systemPrompt - System prompt override (defaults to CHAT_SYSTEM_KERNEL)
 * @param callbacks   - SSE event callbacks
 * @param context     - Optional page context for context-aware prompts
 */
export async function chatStream(
	workspaceId: string,
	envelope: SealedEnvelope,
	messages: ChatMessage[],
	systemPrompt: string,
	callbacks: StreamCallbacks,
	context?: ChatContext,
): Promise<void> {
	try {
		const trimmed =
			messages.length > MAX_MESSAGES ? messages.slice(messages.length - MAX_MESSAGES) : messages;

		const anthropicMessages: Anthropic.Messages.MessageParam[] = trimmed.map((m) => ({
			role: m.role,
			content: m.content,
		}));

		// Verify context contactId server-side: resolve name from DB, not client
		let verifiedContext = context;
		if (context?.contactId) {
			try {
				const { getContact } = await import('@repo/db');
				const contact = await getContact(workspaceId, context.contactId, envelope);
				if (contact) {
					verifiedContext = {
						...context,
						contactName: contact.firstName ?? context.contactName,
					};
				} else {
					// contactId doesn't exist in this workspace — strip it
					verifiedContext = { page: context.page };
				}
			} catch {
				// DB error — fall through with client context
			}
		}

		// Build context-aware system prompt
		const effectivePrompt = systemPrompt || buildSystemPrompt(verifiedContext);

		// Pre-fetch contact data as Layer 3 domain knowledge
		let domainKnowledge = '';
		if (verifiedContext?.contactId) {
			domainKnowledge = await prefetchContactContext(
				workspaceId,
				verifiedContext.contactId,
				envelope,
			);
		}

		const toolsUsed: string[] = [];
		let hasDraftedThisRequest = false;

		// P2: Semantic cache — ELM mask last user query, check cache before LLM
		const WRITE_TOOLS = new Set([
			'create_commitment',
			'create_deal',
			'create_goal',
			'update_deal_stage',
		]);
		let maskedQuery = '';
		let queryEmbedding: number[] = [];
		const lastUserMsg = [...trimmed].reverse().find((m) => m.role === 'user');
		const lastUserText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';

		if (lastUserText) {
			try {
				const wrk = await unwrapWrk(envelope);
				const keys = await deriveKeys(wrk, workspaceId, envelope.wrkVersion);
				const salt = keys.bik;
				const detected = prefilterEntities(lastUserText);
				maskedQuery = maskEntities(lastUserText, salt, detected).maskedText;
				queryEmbedding = await embedMaskedQuery(maskedQuery);

				const cached = await checkSemanticCache(workspaceId, maskedQuery, queryEmbedding, envelope);
				if (cached) {
					await callbacks.onTextDelta(cached);
					await callbacks.onDone([]);
					return;
				}
			} catch (err) {
				console.error(
					'[chat-stream] Semantic cache check failed, proceeding without cache:',
					redactSensitive(err),
				);
			}
		}

		if (shouldUseLocalChat()) {
			const localResult = await runLocalChat({
				workspaceId,
				envelope,
				messages: trimmed,
				systemPrompt: effectivePrompt,
				domainKnowledge,
				maxIterations: MAX_ITERATIONS,
				onToolStart: callbacks.onToolStart,
				onToolEnd: callbacks.onToolEnd,
				onProposal: callbacks.onProposal,
				onWriteToolUse: async (toolName) => {
					if (WRITE_TOOLS.has(toolName)) {
						await invalidateCacheForTool(workspaceId, toolName);
					}
				},
				limitDraftMessages: true,
			});

			await callbacks.onTextDelta(localResult.response);
			await callbacks.onDone(localResult.toolsUsed);

			if (maskedQuery && queryEmbedding.length > 0) {
				storeSemanticCache(
					workspaceId,
					maskedQuery,
					queryEmbedding,
					localResult.response,
					localResult.toolsUsed,
					envelope,
				).catch((err) => {
					console.error('[chat-stream] Failed to store semantic cache:', redactSensitive(err));
				});
			}
			return;
		}

		// P4: Smart model routing — route based on last user message
		const modelTier = routeQuery(lastUserText);
		const routedModel = MODEL_IDS[modelTier];

		for (let i = 0; i < MAX_ITERATIONS; i++) {
			const response = await inferWithCache(
				effectivePrompt,
				'',
				domainKnowledge,
				anthropicMessages,
				{
					tools: CHAT_TOOLS,
					model: routedModel,
					maxTokens: 2048,
					temperature: 0.3,
					helicone: { feature: 'ai-chat-stream', modelTier },
				},
			);

			// Final text response — re-run with streaming
			if (response.stop_reason === 'end_turn') {
				const streamedChunks: string[] = [];
				const stream = streamInfer(effectivePrompt, '', domainKnowledge, anthropicMessages, {
					model: routedModel,
					maxTokens: 2048,
					temperature: 0.3,
				});

				stream.on('text', async (text) => {
					streamedChunks.push(text);
					await callbacks.onTextDelta(text);
				});

				await stream.finalMessage();
				await callbacks.onDone(toolsUsed);

				// P2: Store response in semantic cache (non-blocking)
				if (maskedQuery && queryEmbedding.length > 0) {
					const fullResponse = streamedChunks.join('');
					storeSemanticCache(
						workspaceId,
						maskedQuery,
						queryEmbedding,
						fullResponse,
						toolsUsed,
						envelope,
					).catch((err) => {
						console.error('[chat-stream] Failed to store semantic cache:', redactSensitive(err));
					});
				}
				return;
			}

			// Tool-use iteration — execute tools with callbacks
			if (response.stop_reason === 'tool_use') {
				anthropicMessages.push({ role: 'assistant', content: response.content });

				const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
				for (const block of response.content) {
					if (block.type === 'tool_use') {
						toolsUsed.push(block.name);
						await callbacks.onToolStart(block.name);
						try {
							// Single-draft guard: only one draft_message per request
							if (block.name === 'draft_message' && hasDraftedThisRequest) {
								toolResults.push({
									type: 'tool_result',
									tool_use_id: block.id,
									content:
										'Only one draft per request. Ask the user to confirm or discard the current draft first.',
									is_error: true,
								});
								await callbacks.onToolEnd(block.name);
								continue;
							}
							const executor = TOOL_EXECUTORS[block.name];
							if (!executor) {
								toolResults.push({
									type: 'tool_result',
									tool_use_id: block.id,
									content: `Unknown tool: ${block.name}`,
									is_error: true,
								});
								await callbacks.onToolEnd(block.name);
								continue;
							}
							const result = await executor(
								block.input as Record<string, unknown>,
								workspaceId,
								envelope,
							);
							// Emit proposal event when tool returns a proposal JSON
							// SEC: Allowlist check prevents prompt-injected fabricated proposals
							if (callbacks.onProposal) {
								try {
									const ALLOWED_ACTIONS = new Set([
										'create_commitment',
										'create_deal',
										'create_goal',
										'update_deal_stage',
										'draft_message',
									]);
									const parsed = JSON.parse(result);
									if (parsed.type === 'proposal' && ALLOWED_ACTIONS.has(parsed.action)) {
										await callbacks.onProposal(parsed);
										if (parsed.action === 'draft_message') {
											hasDraftedThisRequest = true;
										}
									}
								} catch {
									// Not JSON, ignore
								}
							}
							// P2: Invalidate semantic cache on write tool execution
							if (WRITE_TOOLS.has(block.name)) {
								await invalidateCacheForTool(workspaceId, block.name);
							}
							toolResults.push({
								type: 'tool_result',
								tool_use_id: block.id,
								content: result,
							});
						} catch (err) {
							console.error(`[chat-stream] Tool ${block.name} error:`, redactSensitive(err));
							toolResults.push({
								type: 'tool_result',
								tool_use_id: block.id,
								content: 'Tool execution failed. Please try a different approach.',
								is_error: true,
							});
						}
						await callbacks.onToolEnd(block.name);
					}
				}

				anthropicMessages.push({ role: 'user', content: toolResults });
				continue;
			}

			// Unexpected stop reason — emit whatever text exists and finish
			const fallbackText = response.content
				.filter((block) => block.type === 'text')
				.map((block) => (block.type === 'text' ? block.text : ''))
				.join('\n');
			await callbacks.onTextDelta(fallbackText || 'I was unable to complete the request.');
			await callbacks.onDone(toolsUsed);
			return;
		}

		// Hit max iterations
		await callbacks.onTextDelta(
			'I reached the maximum number of tool calls. Here is what I found so far. Please try a more specific question.',
		);
		await callbacks.onDone(toolsUsed);
	} catch (err) {
		await callbacks.onError(redactSensitive(err));
	}
}
