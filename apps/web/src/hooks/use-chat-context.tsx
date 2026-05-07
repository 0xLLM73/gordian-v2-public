'use client';

// Needs client boundary: React context + state for chat page awareness
import type { ActionProposal } from '@/components/chat/action-card';
import { createContext, useCallback, useContext, useState } from 'react';

export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	toolsUsed?: string[];
	timestamp: Date;
	isError?: boolean;
	proposals?: ActionProposal[];
}

export interface ChatContext {
	page: string;
	contactId?: string;
	contactName?: string;
	contactSummary?: string;
	dealId?: string;
	dealTitle?: string;
}

const DEFAULT_CONTEXT: ChatContext = { page: 'dashboard' };

interface ChatContextState {
	context: ChatContext;
	setContext: (ctx: ChatContext) => void;
	resetContext: () => void;
	messages: ChatMessage[];
	setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
	clearMessages: () => void;
}

const ChatCtx = createContext<ChatContextState>({
	context: DEFAULT_CONTEXT,
	setContext: () => {},
	resetContext: () => {},
	messages: [],
	setMessages: () => {},
	clearMessages: () => {},
});

export function ChatContextProvider({ children }: { children: React.ReactNode }) {
	const [context, setContextState] = useState<ChatContext>(DEFAULT_CONTEXT);
	const [messages, setMessages] = useState<ChatMessage[]>([]);

	const setContext = useCallback((ctx: ChatContext) => {
		setContextState(ctx);
	}, []);

	const resetContext = useCallback(() => {
		setContextState(DEFAULT_CONTEXT);
	}, []);

	const clearMessages = useCallback(() => {
		setMessages([]);
	}, []);

	return (
		<ChatCtx.Provider
			value={{ context, setContext, resetContext, messages, setMessages, clearMessages }}
		>
			{children}
		</ChatCtx.Provider>
	);
}

/** Read the current chat context. */
export function useChatContext(): ChatContext {
	return useContext(ChatCtx).context;
}

/** Set or reset chat context. */
export function useSetChatContext() {
	const { setContext, resetContext } = useContext(ChatCtx);
	return { setContext, resetContext };
}

/** Access chat messages state (persists across panel open/close). */
export function useChatMessages() {
	const { messages, setMessages, clearMessages } = useContext(ChatCtx);
	return { messages, setMessages, clearMessages };
}
