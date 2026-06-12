'use client';

import { Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
// Needs client boundary: event handlers (keydown, submit), controlled textarea state, auto-scroll effect
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useChatPanel } from '@/hooks/use-chat';
import { ChatMessage } from './chat-message';

const TOOL_LABELS: Record<string, string> = {
	search_contacts: 'Searching contacts...',
	get_commitments: 'Looking up commitments...',
	get_deals: 'Checking deals...',
	get_contact_health: 'Checking relationship health...',
	search_memories: 'Searching memories...',
	search_knowledge: 'Exploring knowledge graph...',
	search_precedents: 'Reviewing precedents...',
	trace_decision: 'Tracing decision history...',
	create_commitment: 'Creating commitment...',
	create_deal: 'Creating deal...',
	create_goal: 'Creating goal...',
	update_deal_stage: 'Updating deal stage...',
	draft_message: 'Drafting message...',
};

const MESSAGE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export function ChatPanel({ onClose }: { onClose: () => void }) {
	const { messages, sendMessage, isPending, clearHistory, retryLast, activeTools } = useChatPanel();
	const [input, setInput] = useState('');
	const scrollRef = useRef<HTMLDivElement>(null);

	// Auto-clear stale messages on panel open
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally run only on mount
	useEffect(() => {
		if (messages.length === 0) return;
		const lastMsg = messages[messages.length - 1];
		if (Date.now() - lastMsg.timestamp.getTime() > MESSAGE_TTL_MS) {
			clearHistory();
		}
	}, []);

	// Auto-scroll on new messages or streaming content
	// biome-ignore lint/correctness/useExhaustiveDependencies: messages + activeTools are trigger deps
	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [messages, activeTools]);

	const handleSubmit = (event?: React.FormEvent<HTMLFormElement>) => {
		event?.preventDefault();
		if (input.trim().length === 0 || input.length > 4000 || isPending) return;
		sendMessage(input.trim());
		setInput('');
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSubmit();
		}
	};

	// Determine what progress indicator to show
	const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
	const isStreaming =
		isPending && lastMessage?.role === 'assistant' && lastMessage.content.length > 0;
	const showToolProgress = isPending && activeTools.length > 0;
	const showThinking =
		isPending && !showToolProgress && !isStreaming && (!lastMessage || lastMessage.role === 'user');

	return (
		<div className="flex h-full flex-col border-l border-border bg-card">
			{/* Header */}
			<div className="flex items-center justify-between border-b border-border px-4 py-3">
				<h3 className="text-sm font-semibold text-foreground">Chat</h3>
				<div className="flex gap-2">
					<Button variant="ghost" size="sm" onClick={clearHistory} className="text-xs">
						Clear
					</Button>
					<Button variant="ghost" size="icon" onClick={onClose} aria-label="Close chat">
						<X className="h-4 w-4" />
					</Button>
				</div>
			</div>

			{/* Messages */}
			<div
				ref={scrollRef}
				className="flex-1 overflow-y-auto p-4"
				role="log"
				aria-live="polite"
				aria-label="Chat messages"
				aria-busy={isPending}
			>
				{messages.length === 0 ? (
					<div className="flex h-full flex-col items-center justify-center gap-4 px-2">
						<p className="text-center text-sm text-muted-foreground">
							Ask about your contacts, deals, or commitments.
						</p>
						<div className="flex flex-col gap-1.5">
							{[
								'How are my relationships doing?',
								'What commitments do I owe?',
								'Who should I reach out to?',
							].map((q) => (
								<button
									key={q}
									type="button"
									onClick={() => {
										setInput(q);
										sendMessage(q);
									}}
									disabled={isPending}
									className="rounded-md border border-border px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
								>
									{q}
								</button>
							))}
						</div>
					</div>
				) : (
					messages.map((msg) => (
						<ChatMessage key={msg.id} message={msg} onRetry={msg.isError ? retryLast : undefined} />
					))
				)}
				{showToolProgress ? (
					<div className="mb-3 flex justify-start">
						<div className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
							<span>{TOOL_LABELS[activeTools[0]] ?? `Running ${activeTools[0]}...`}</span>
						</div>
					</div>
				) : showThinking ? (
					<div className="mb-3 flex justify-start">
						<div className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
							<span>Thinking...</span>
						</div>
					</div>
				) : null}
			</div>

			{/* Input */}
			<div className="border-t border-border p-3">
				<form className="flex gap-2" aria-label="Send a message" onSubmit={handleSubmit}>
					<Textarea
						value={input}
						onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Ask a question..."
						className="flex-1 resize-none"
						rows={1}
						maxLength={4000}
						disabled={isPending}
						aria-label="Chat message input"
					/>
					<Button type="submit" disabled={isPending || input.trim().length === 0}>
						Send
					</Button>
				</form>
				{input.length > 0 ? (
					<p className="mt-1 text-right text-xs text-muted-foreground">{input.length}/4000</p>
				) : null}
			</div>
		</div>
	);
}
