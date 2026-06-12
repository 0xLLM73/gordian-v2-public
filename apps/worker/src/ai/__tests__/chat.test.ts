import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInferWithCache = vi.hoisted(() => vi.fn());
const mockSearchContactByName = vi.hoisted(() => vi.fn());
const mockGetActiveCommitments = vi.hoisted(() => vi.fn());
const mockGetCommitmentsByContact = vi.hoisted(() => vi.fn());
const mockGetDealsByContact = vi.hoisted(() => vi.fn());
const mockListDeals = vi.hoisted(() => vi.fn());
const mockHybridSearch = vi.hoisted(() => vi.fn());
const mockGetDashboardStats = vi.hoisted(() => vi.fn());
const mockGetHealthScoresByWorkspace = vi.hoisted(() => vi.fn());
const mockGetMessageContactCoverageReport = vi.hoisted(() => vi.fn());
const mockGetMessagesByTimeRange = vi.hoisted(() => vi.fn());
const mockListContacts = vi.hoisted(() => vi.fn());
const mockListKnowledgeNodes = vi.hoisted(() => vi.fn());
const mockGenerateEmbedding = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

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
	getDashboardStats: mockGetDashboardStats,
	getHealthScoresByWorkspace: mockGetHealthScoresByWorkspace,
	getMessageContactCoverageReport: mockGetMessageContactCoverageReport,
	getMessagesByTimeRange: mockGetMessagesByTimeRange,
	listContacts: mockListContacts,
	listKnowledgeNodes: mockListKnowledgeNodes,
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

const localModelResponse = (payload: Record<string, unknown>) => ({
	ok: true,
	json: () =>
		Promise.resolve({
			message: {
				content: JSON.stringify(payload),
			},
		}),
	text: () => Promise.resolve(''),
});

const localModelTextResponse = (content: string) => ({
	ok: true,
	json: () =>
		Promise.resolve({
			message: { content },
		}),
	text: () => Promise.resolve(''),
});

function enableLocalQwenChat() {
	vi.stubEnv('CHAT_LLM_PROVIDER', 'local');
	vi.stubEnv('CHAT_LLM_BASE_URL', 'http://localhost:11434/v1');
	vi.stubEnv('CHAT_LLM_MODEL', 'qwen3:4b-instruct');
}

describe('chat', () => {
	beforeEach(() => {
		vi.unstubAllEnvs();
		vi.stubEnv('COMMITMENT_LLM_PROVIDER', 'cloud');
		vi.stubGlobal('fetch', fetchMock);
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

	it('routes local Qwen chat through Ollama tools without calling cloud inference', async () => {
		enableLocalQwenChat();
		mockSearchContactByName.mockResolvedValue([{ id: 'c-1', firstName: 'Alice' }]);
		fetchMock
			.mockResolvedValueOnce(
				localModelResponse({
					type: 'tool_use',
					tools: [{ id: 'tool_1', name: 'search_contacts', input: { name: 'Alice' } }],
				}),
			)
			.mockResolvedValueOnce(
				localModelResponse({
					type: 'answer',
					response: 'I found Alice in your contacts.',
				}),
			);

		const result = await chat('ws-1', fakeEnvelope, [{ role: 'user', content: 'Find Alice' }]);

		expect(result.response).toBe('I found Alice in your contacts.');
		expect(result.toolsUsed).toEqual(['search_contacts']);
		expect(mockInferWithCache).not.toHaveBeenCalled();
		expect(mockSearchContactByName).toHaveBeenCalledWith('ws-1', 'Alice', fakeEnvelope);
		expect(fetchMock).toHaveBeenCalledWith(
			'http://localhost:11434/api/chat',
			expect.objectContaining({
				headers: expect.not.objectContaining({
					Authorization: expect.any(String),
				}),
			}),
		);

		const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
			model: string;
			stream: boolean;
			think: boolean;
			format: { properties: Record<string, unknown> };
			options: { temperature: number; num_predict: number };
		};
		expect(body.model).toBe('qwen3:4b-instruct');
		expect(body.stream).toBe(false);
		expect(body.think).toBe(false);
		expect(body.format.properties).toHaveProperty('tools');
		expect(body.options.temperature).toBe(0.2);
		expect(body.options.num_predict).toBeGreaterThan(0);
	});

	it('accepts plain-text final answers from local Qwen', async () => {
		enableLocalQwenChat();
		fetchMock.mockResolvedValueOnce(
			localModelTextResponse(
				'Your local context points to a small set of active relationship themes.',
			),
		);

		const result = await chat('ws-1', fakeEnvelope, [{ role: 'user', content: 'Hi' }]);

		expect(result.response).toBe(
			'Your local context points to a small set of active relationship themes.',
		);
		expect(result.toolsUsed).toEqual([]);
		expect(mockInferWithCache).not.toHaveBeenCalled();
	});

	it('prefetches safe workspace context for broad local Qwen prompts', async () => {
		enableLocalQwenChat();
		mockGetDashboardStats.mockResolvedValue({
			contactCount: 1,
			activeCommitmentCount: 0,
			openDealCount: 0,
			totalDealValue: 0,
			activeGoalCount: 0,
		});
		mockListContacts.mockResolvedValue([]);
		mockListDeals.mockResolvedValue([]);
		mockGetActiveCommitments.mockResolvedValue([]);
		mockGetHealthScoresByWorkspace.mockResolvedValue([]);
		mockGetMessageContactCoverageReport.mockResolvedValue({
			totalMessages: 42,
			linkedContactMessages: 30,
			messagesWithSenderMetadata: 35,
			chatsWithNullContactMessages: 1,
			byChatType: [],
		});
		mockListKnowledgeNodes.mockResolvedValue([
			{
				displayName: 'Solana',
				type: 'technology',
				description: 'Layer 1 blockchain',
				mentionCount: 5,
			},
		]);
		fetchMock.mockResolvedValueOnce(
			localModelResponse({
				type: 'answer',
				response: 'Your current local themes include Solana and blockchain infrastructure.',
			}),
		);

		const result = await chat('ws-1', fakeEnvelope, [
			{ role: 'user', content: 'What high-level themes do you see?' },
		]);

		expect(result.toolsUsed).toEqual([]);
		expect(result.response).toContain('Solana');
		expect(mockListKnowledgeNodes).toHaveBeenCalledWith('ws-1', { limit: 12 }, fakeEnvelope);
		expect(mockInferWithCache).not.toHaveBeenCalled();
		const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
			messages: Array<{ role: string; content: string }>;
		};
		expect(body.messages[0]?.content).toContain('Safe workspace overview');
		expect(body.messages[0]?.content).toContain('Solana');
	});

	it('preserves local chat fallback from commitment Qwen config', async () => {
		vi.stubEnv('COMMITMENT_LLM_PROVIDER', 'local');
		vi.stubEnv('COMMITMENT_LLM_BASE_URL', 'http://localhost:11434/v1');
		vi.stubEnv('COMMITMENT_LLM_MODEL', 'qwen3.5:9b');
		fetchMock.mockResolvedValueOnce(
			localModelResponse({
				type: 'answer',
				response: 'Commitment fallback is local chat.',
			}),
		);

		const result = await chat('ws-1', fakeEnvelope, [{ role: 'user', content: 'Hi' }]);

		expect(result.response).toBe('Commitment fallback is local chat.');
		expect(mockInferWithCache).not.toHaveBeenCalled();
		const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { model: string };
		expect(body.model).toBe('qwen3.5:9b');
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
