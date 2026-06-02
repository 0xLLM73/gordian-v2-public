import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSendChatMessageAction = vi.fn();

vi.mock('@/app/actions/chat', () => ({
	sendChatMessageAction: (...args: unknown[]) => mockSendChatMessageAction(...args),
}));

// Mock chat context — messages state lifted to provider
let messagesStore: unknown[] = [];
const mockSetMessages = vi.fn((updater: unknown) => {
	if (typeof updater === 'function') {
		messagesStore = (updater as (prev: unknown[]) => unknown[])(messagesStore);
	} else {
		messagesStore = updater as unknown[];
	}
});
const mockClearMessages = vi.fn(() => {
	messagesStore = [];
});

vi.mock('@/hooks/use-chat-context', () => ({
	useChatContext: () => ({ page: 'dashboard' }),
	useChatMessages: () => ({
		get messages() {
			return messagesStore;
		},
		setMessages: mockSetMessages,
		clearMessages: mockClearMessages,
	}),
}));

// Mock crypto.randomUUID for deterministic IDs
let uuidCounter = 0;
vi.stubGlobal('crypto', {
	randomUUID: () => `uuid-${++uuidCounter}`,
});

describe('useChatPanel', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		uuidCounter = 0;
		messagesStore = [];
	});

	afterEach(() => {
		cleanup();
	});

	it('initializes with empty messages and not pending', async () => {
		const { useChatPanel } = await import('@/hooks/use-chat');
		const { result } = renderHook(() => useChatPanel());

		expect(result.current.messages).toEqual([]);
		expect(result.current.isPending).toBe(false);
	});

	it('adds user message and assistant response on successful send', async () => {
		mockSendChatMessageAction.mockResolvedValue({
			data: { response: 'Here is Alice info.', toolsUsed: ['search_contacts'] },
		});

		const { useChatPanel } = await import('@/hooks/use-chat');
		const { result } = renderHook(() => useChatPanel());

		await act(async () => {
			await result.current.sendMessage('Who is Alice?');
		});

		expect(result.current.messages).toHaveLength(2);
		expect(result.current.messages[0].role).toBe('user');
		expect(result.current.messages[0].content).toBe('Who is Alice?');
		expect(result.current.messages[1].role).toBe('assistant');
		expect(result.current.messages[1].content).toBe('Here is Alice info.');
		expect(result.current.messages[1].toolsUsed).toEqual(['search_contacts']);
		expect(result.current.isPending).toBe(false);
	});

	it('shows error message on serverError', async () => {
		mockSendChatMessageAction.mockResolvedValue({
			serverError: 'Internal error',
		});

		const { useChatPanel } = await import('@/hooks/use-chat');
		const { result } = renderHook(() => useChatPanel());

		await act(async () => {
			await result.current.sendMessage('Hello');
		});

		expect(result.current.messages).toHaveLength(2);
		expect(result.current.messages[1].role).toBe('assistant');
		expect(result.current.messages[1].content).toContain('something went wrong');
	});

	it('shows actionable AI consent errors on serverError', async () => {
		mockSendChatMessageAction.mockResolvedValue({
			serverError: 'AI analysis consent is required.',
		});

		const { useChatPanel } = await import('@/hooks/use-chat');
		const { result } = renderHook(() => useChatPanel());

		await act(async () => {
			await result.current.sendMessage('Can you summarize my messages?');
		});

		expect(result.current.messages).toHaveLength(2);
		expect(result.current.messages[1].role).toBe('assistant');
		expect(result.current.messages[1].content).toContain('Enable AI analysis in Settings');
	});

	it('shows actionable AI consent errors directly from the stream response', async () => {
		mockSendChatMessageAction.mockResolvedValue({
			data: { response: 'fallback should not run' },
		});
		const mockFetch = vi
			.fn()
			.mockResolvedValue(
				Response.json({ error: 'AI analysis consent is required.' }, { status: 403 }),
			);
		vi.stubGlobal('fetch', mockFetch);

		const { useChatPanel } = await import('@/hooks/use-chat');
		const { result } = renderHook(() => useChatPanel());

		await act(async () => {
			await result.current.sendMessage('Can you summarize my messages?');
		});

		expect(mockFetch).toHaveBeenCalledWith('/api/chat/stream', expect.any(Object));
		expect(mockSendChatMessageAction).not.toHaveBeenCalled();
		expect(result.current.messages).toHaveLength(2);
		expect(result.current.messages[1].role).toBe('assistant');
		expect(result.current.messages[1].content).toContain('Enable AI analysis in Settings');
	});

	it('shows connection error on network failure', async () => {
		mockSendChatMessageAction.mockRejectedValue(new Error('Network error'));

		const { useChatPanel } = await import('@/hooks/use-chat');
		const { result } = renderHook(() => useChatPanel());

		await act(async () => {
			await result.current.sendMessage('Test');
		});

		expect(result.current.messages).toHaveLength(2);
		expect(result.current.messages[1].content).toContain('Connection error');
	});

	it('rejects empty or whitespace-only messages', async () => {
		const { useChatPanel } = await import('@/hooks/use-chat');
		const { result } = renderHook(() => useChatPanel());

		await act(async () => {
			await result.current.sendMessage('');
			await result.current.sendMessage('   ');
		});

		expect(result.current.messages).toHaveLength(0);
		expect(mockSendChatMessageAction).not.toHaveBeenCalled();
	});

	it('rejects messages over 4000 characters', async () => {
		const { useChatPanel } = await import('@/hooks/use-chat');
		const { result } = renderHook(() => useChatPanel());

		await act(async () => {
			await result.current.sendMessage('x'.repeat(4001));
		});

		expect(result.current.messages).toHaveLength(0);
		expect(mockSendChatMessageAction).not.toHaveBeenCalled();
	});

	it('clearHistory resets messages', async () => {
		mockSendChatMessageAction.mockResolvedValue({
			data: { response: 'Hi' },
		});

		const { useChatPanel } = await import('@/hooks/use-chat');
		const { result } = renderHook(() => useChatPanel());

		await act(async () => {
			await result.current.sendMessage('Hello');
		});

		expect(result.current.messages).toHaveLength(2);

		act(() => {
			result.current.clearHistory();
		});

		expect(mockClearMessages).toHaveBeenCalled();
		expect(result.current.messages).toHaveLength(0);
	});
});
