'use client';

// Fallback for when SSE streaming is unavailable
import { sendChatMessageAction } from '@/app/actions/chat';
import type { ActionProposal } from '@/components/chat/action-card';
import { useCallback, useRef, useState } from 'react';
import { type ChatMessage, useChatContext, useChatMessages } from './use-chat-context';

export type { ChatMessage } from './use-chat-context';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;

/** Parse a raw SSE chunk into event/data pairs. */
function parseSSEChunk(chunk: string): Array<{ event: string; data: string }> {
	const events: Array<{ event: string; data: string }> = [];
	const blocks = chunk.split('\n\n');
	for (const block of blocks) {
		if (!block.trim()) continue;
		let event = 'message';
		let data = '';
		for (const line of block.split('\n')) {
			if (line.startsWith('event:')) {
				event = line.slice(6).trim();
			} else if (line.startsWith('data:')) {
				data = line.slice(5).trim();
			}
		}
		if (data) {
			events.push({ event, data });
		}
	}
	return events;
}

export function useChatPanel() {
	const { messages, setMessages, clearMessages } = useChatMessages();
	const [isPending, setIsPending] = useState(false);
	const [activeTools, setActiveTools] = useState<string[]>([]);
	const recentSends = useRef<number[]>([]);
	const context = useChatContext();

	/** Send via SSE streaming, falling back to non-streaming action on failure. */
	const sendMessage = useCallback(
		async (text: string) => {
			if (isPending) return;
			if (text.trim().length === 0 || text.length > 4000) return;

			// Client-side rate limit
			const now = Date.now();
			recentSends.current = recentSends.current.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
			if (recentSends.current.length >= RATE_LIMIT_MAX) return;
			recentSends.current.push(now);

			const userMessage: ChatMessage = {
				id: crypto.randomUUID(),
				role: 'user',
				content: text,
				timestamp: new Date(),
			};

			const updatedMessages = [...messages, userMessage];
			setMessages(updatedMessages);
			setIsPending(true);
			setActiveTools([]);

			const assistantId = crypto.randomUUID();

			try {
				const response = await fetch('/api/chat/stream', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						messages: updatedMessages.map((m) => ({
							role: m.role,
							content: m.content,
						})),
						context,
					}),
				});

				if (!response.ok || !response.body) {
					throw new Error('SSE unavailable');
				}

				// Create a pending assistant message with empty content
				const pendingMessage: ChatMessage = {
					id: assistantId,
					role: 'assistant',
					content: '',
					timestamp: new Date(),
				};
				setMessages((prev) => [...prev, pendingMessage]);

				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffer = '';
				const pendingProposals: ActionProposal[] = [];

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					buffer += decoder.decode(value, { stream: true });

					// Only process complete SSE blocks (ending with \n\n)
					const lastDoubleNewline = buffer.lastIndexOf('\n\n');
					if (lastDoubleNewline === -1) continue;

					const complete = buffer.slice(0, lastDoubleNewline + 2);
					buffer = buffer.slice(lastDoubleNewline + 2);

					const events = parseSSEChunk(complete);

					for (const sse of events) {
						const parsed = JSON.parse(sse.data);

						switch (sse.event) {
							case 'text_delta':
								setMessages((prev) =>
									prev.map((m) =>
										m.id === assistantId ? { ...m, content: m.content + parsed.text } : m,
									),
								);
								break;

							case 'tool_start':
								setActiveTools((prev) => [...prev, parsed.tool]);
								break;

							case 'tool_end':
								setActiveTools((prev) => prev.filter((t) => t !== parsed.tool));
								break;

							case 'proposal':
								pendingProposals.push({ ...parsed, status: 'pending' } as ActionProposal);
								break;

							case 'done':
								setMessages((prev) =>
									prev.map((m) =>
										m.id === assistantId
											? {
													...m,
													toolsUsed: parsed.toolsUsed,
													...(pendingProposals.length > 0 && { proposals: [...pendingProposals] }),
												}
											: m,
									),
								);
								setActiveTools([]);
								break;

							case 'error':
								setMessages((prev) =>
									prev.map((m) =>
										m.id === assistantId
											? {
													...m,
													content: 'Sorry, something went wrong. Please try again.',
													isError: true,
												}
											: m,
									),
								);
								setActiveTools([]);
								break;
						}
					}
				}
			} catch {
				// Fallback to non-streaming action
				// Remove the empty pending message if it was added
				setMessages((prev) => prev.filter((m) => m.id !== assistantId));
				setActiveTools([]);

				try {
					const result = await sendChatMessageAction({
						messages: updatedMessages.map((m) => ({
							role: m.role,
							content: m.content,
						})),
					});

					if (result?.data) {
						const assistantMessage: ChatMessage = {
							id: crypto.randomUUID(),
							role: 'assistant',
							content: result.data.response,
							toolsUsed: result.data.toolsUsed,
							timestamp: new Date(),
						};
						setMessages((prev) => [...prev, assistantMessage]);
					} else if (result?.serverError) {
						const errorMessage: ChatMessage = {
							id: crypto.randomUUID(),
							role: 'assistant',
							content: 'Sorry, something went wrong. Please try again.',
							timestamp: new Date(),
							isError: true,
						};
						setMessages((prev) => [...prev, errorMessage]);
					}
				} catch {
					const errorMessage: ChatMessage = {
						id: crypto.randomUUID(),
						role: 'assistant',
						content: 'Connection error. Please try again.',
						timestamp: new Date(),
						isError: true,
					};
					setMessages((prev) => [...prev, errorMessage]);
				}
			} finally {
				setIsPending(false);
				setActiveTools([]);
			}
		},
		[messages, isPending, context, setMessages],
	);

	const clearHistory = useCallback(() => {
		clearMessages();
		setActiveTools([]);
	}, [clearMessages]);

	/** Remove the last error message and re-send the preceding user message. */
	const retryLast = useCallback(async () => {
		if (isPending) return;

		// Find the last error message
		let lastErrorIdx = -1;
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].isError) {
				lastErrorIdx = i;
				break;
			}
		}
		if (lastErrorIdx === -1) return;

		// Find the user message that preceded the error
		let lastUserContent: string | null = null;
		for (let i = lastErrorIdx - 1; i >= 0; i--) {
			if (messages[i].role === 'user') {
				lastUserContent = messages[i].content;
				break;
			}
		}
		if (!lastUserContent) return;

		// Remove the error message, keep the original user message
		const withoutError = messages.filter((_, idx) => idx !== lastErrorIdx);
		setMessages(withoutError);
		setIsPending(true);
		setActiveTools([]);

		const assistantId = crypto.randomUUID();

		try {
			const response = await fetch('/api/chat/stream', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					messages: withoutError.map((m) => ({
						role: m.role,
						content: m.content,
					})),
					context,
				}),
			});

			if (!response.ok || !response.body) {
				throw new Error('SSE unavailable');
			}

			const pendingMessage: ChatMessage = {
				id: assistantId,
				role: 'assistant',
				content: '',
				timestamp: new Date(),
			};
			setMessages((prev) => [...prev, pendingMessage]);

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lastDoubleNewline = buffer.lastIndexOf('\n\n');
				if (lastDoubleNewline === -1) continue;

				const complete = buffer.slice(0, lastDoubleNewline + 2);
				buffer = buffer.slice(lastDoubleNewline + 2);
				const events = parseSSEChunk(complete);

				for (const sse of events) {
					const parsed = JSON.parse(sse.data);
					switch (sse.event) {
						case 'text_delta':
							setMessages((prev) =>
								prev.map((m) =>
									m.id === assistantId ? { ...m, content: m.content + parsed.text } : m,
								),
							);
							break;
						case 'tool_start':
							setActiveTools((prev) => [...prev, parsed.tool]);
							break;
						case 'tool_end':
							setActiveTools((prev) => prev.filter((t) => t !== parsed.tool));
							break;
						case 'done':
							setMessages((prev) =>
								prev.map((m) => (m.id === assistantId ? { ...m, toolsUsed: parsed.toolsUsed } : m)),
							);
							setActiveTools([]);
							break;
						case 'error':
							setMessages((prev) =>
								prev.map((m) =>
									m.id === assistantId
										? {
												...m,
												content: 'Sorry, something went wrong. Please try again.',
												isError: true,
											}
										: m,
								),
							);
							setActiveTools([]);
							break;
					}
				}
			}
		} catch {
			// Fallback to non-streaming
			setMessages((prev) => prev.filter((m) => m.id !== assistantId));
			setActiveTools([]);

			try {
				const result = await sendChatMessageAction({
					messages: withoutError.map((m) => ({
						role: m.role,
						content: m.content,
					})),
				});

				if (result?.data) {
					const assistantMessage: ChatMessage = {
						id: crypto.randomUUID(),
						role: 'assistant',
						content: result.data.response,
						toolsUsed: result.data.toolsUsed,
						timestamp: new Date(),
					};
					setMessages((prev) => [...prev, assistantMessage]);
				} else if (result?.serverError) {
					const errorMessage: ChatMessage = {
						id: crypto.randomUUID(),
						role: 'assistant',
						content: 'Sorry, something went wrong. Please try again.',
						timestamp: new Date(),
						isError: true,
					};
					setMessages((prev) => [...prev, errorMessage]);
				}
			} catch {
				const errorMessage: ChatMessage = {
					id: crypto.randomUUID(),
					role: 'assistant',
					content: 'Connection error. Please try again.',
					timestamp: new Date(),
					isError: true,
				};
				setMessages((prev) => [...prev, errorMessage]);
			}
		} finally {
			setIsPending(false);
			setActiveTools([]);
		}
	}, [messages, isPending, context, setMessages]);

	return { messages, sendMessage, isPending, clearHistory, retryLast, activeTools };
}
