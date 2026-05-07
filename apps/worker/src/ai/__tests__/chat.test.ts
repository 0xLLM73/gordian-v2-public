import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInferWithCache = vi.hoisted(() => vi.fn());
const mockSearchContactByName = vi.hoisted(() => vi.fn());
const mockGetActiveCommitments = vi.hoisted(() => vi.fn());
const mockGetCommitmentsByContact = vi.hoisted(() => vi.fn());
const mockGetDealsByContact = vi.hoisted(() => vi.fn());
const mockListDeals = vi.hoisted(() => vi.fn());
const mockHybridSearch = vi.hoisted(() => vi.fn());
const mockGenerateEmbedding = vi.hoisted(() => vi.fn());

vi.mock('../cached-inference', () => ({
	inferWithCache: mockInferWithCache,
}));

vi.mock('@repo/db', () => ({
	searchContactByName: mockSearchContactByName,
	getCommitmentsByContact: mockGetCommitmentsByContact,
	getActiveCommitments: mockGetActiveCommitments,
	getDealsByContact: mockGetDealsByContact,
	listDeals: mockListDeals,
	hybridSearch: mockHybridSearch,
}));

vi.mock('../embeddings', () => ({
	generateEmbedding: mockGenerateEmbedding,
}));

import { chat } from '../chat';

const fakeEnvelope = {
	encryptedWrk: Buffer.from('fake'),
	kmsContext: {},
	wrkVersion: 1,
};

const textResponse = (text: string) => ({
	stop_reason: 'end_turn',
	content: [{ type: 'text', text }],
});

const toolUseResponse = (toolName: string, toolId: string, input: Record<string, unknown>) => ({
	stop_reason: 'tool_use',
	content: [{ type: 'tool_use', id: toolId, name: toolName, input }],
});

describe('chat', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns text response when model returns end_turn with no tool use', async () => {
		mockInferWithCache.mockResolvedValue(textResponse('Here are your contacts.'));

		const result = await chat('ws-1', fakeEnvelope, [
			{ role: 'user', content: 'Show me my contacts' },
		]);

		expect(result.response).toBe('Here are your contacts.');
		expect(result.toolsUsed).toEqual([]);
		expect(mockInferWithCache).toHaveBeenCalledTimes(1);
	});

	it('executes tool call when model returns tool_use, re-calls, returns final text', async () => {
		mockSearchContactByName.mockResolvedValue([{ id: 'c-1', firstName: 'Alice' }]);

		mockInferWithCache
			.mockResolvedValueOnce(toolUseResponse('search_contacts', 'tu-1', { name: 'Alice' }))
			.mockResolvedValueOnce(textResponse('I found Alice in your contacts.'));

		const result = await chat('ws-1', fakeEnvelope, [{ role: 'user', content: 'Find Alice' }]);

		expect(result.response).toBe('I found Alice in your contacts.');
		expect(result.toolsUsed).toContain('search_contacts');
		expect(mockInferWithCache).toHaveBeenCalledTimes(2);
		expect(mockSearchContactByName).toHaveBeenCalledWith('ws-1', 'Alice', fakeEnvelope);
	});

	it('returns fallback message when max iterations (5) are reached', async () => {
		// Always return tool_use — never resolves
		mockInferWithCache.mockResolvedValue(
			toolUseResponse('search_contacts', 'tu-loop', { name: 'X' }),
		);
		mockSearchContactByName.mockResolvedValue([]);

		const result = await chat('ws-1', fakeEnvelope, [{ role: 'user', content: 'Keep searching' }]);

		expect(result.response).toContain('maximum number of tool calls');
		expect(mockInferWithCache).toHaveBeenCalledTimes(5);
	});

	it('includes error result in tool_results when executor throws', async () => {
		mockInferWithCache
			.mockResolvedValueOnce(toolUseResponse('search_contacts', 'tu-err', { name: 'Alice' }))
			.mockResolvedValueOnce(textResponse('Sorry, I encountered an error.'));
		mockSearchContactByName.mockRejectedValue(new Error('DB connection failed'));

		const result = await chat('ws-1', fakeEnvelope, [{ role: 'user', content: 'Find Alice' }]);

		// Should still complete (error bubbles as tool_result with is_error)
		expect(result.response).toBe('Sorry, I encountered an error.');

		// Second inferWithCache call should have received a user message with tool_results
		const secondCall = mockInferWithCache.mock.calls[1][3];
		const toolResultMsg = secondCall[secondCall.length - 1];
		expect(toolResultMsg.role).toBe('user');
		const resultContent = toolResultMsg.content[0];
		expect(resultContent.is_error).toBe(true);
		expect(resultContent.content).toContain('Tool execution failed');
	});

	it('passes workspaceId to all tool executors', async () => {
		mockListDeals.mockResolvedValue([]);
		mockInferWithCache
			.mockResolvedValueOnce(toolUseResponse('get_deals', 'tu-d', {}))
			.mockResolvedValueOnce(textResponse('No deals found.'));

		await chat('ws-workspace-123', fakeEnvelope, [{ role: 'user', content: 'List my deals' }]);

		expect(mockListDeals).toHaveBeenCalledWith(
			'ws-workspace-123',
			fakeEnvelope,
			expect.objectContaining({ limit: 20 }),
		);
	});

	it('handles unknown tool name gracefully (returns is_error result)', async () => {
		mockInferWithCache
			.mockResolvedValueOnce(toolUseResponse('nonexistent_tool', 'tu-unknown', { foo: 'bar' }))
			.mockResolvedValueOnce(textResponse('Done.'));

		const result = await chat('ws-1', fakeEnvelope, [{ role: 'user', content: 'Do something' }]);

		expect(result.response).toBe('Done.');

		const secondCallMessages = mockInferWithCache.mock.calls[1][3];
		const toolResultMsg = secondCallMessages[secondCallMessages.length - 1];
		const resultContent = toolResultMsg.content[0];
		expect(resultContent.is_error).toBe(true);
		expect(resultContent.content).toContain('Unknown tool');
	});
});
