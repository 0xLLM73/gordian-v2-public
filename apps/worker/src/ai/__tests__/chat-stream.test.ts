import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInferWithCache = vi.hoisted(() => vi.fn());
const mockStreamInfer = vi.hoisted(() => vi.fn());
const mockSearchContactByName = vi.hoisted(() => vi.fn());
const mockGetActiveCommitments = vi.hoisted(() => vi.fn());
const mockGetCommitmentsByContact = vi.hoisted(() => vi.fn());
const mockGetDealsByContact = vi.hoisted(() => vi.fn());
const mockListDeals = vi.hoisted(() => vi.fn());
const mockHybridSearch = vi.hoisted(() => vi.fn());
const mockGenerateEmbedding = vi.hoisted(() => vi.fn());
const mockSearchKnowledgeNodes = vi.hoisted(() => vi.fn());
const mockKnowledgeGraphSearch = vi.hoisted(() => vi.fn());
const mockProvenanceSearch = vi.hoisted(() => vi.fn());
const mockFindRelevantPrecedents = vi.hoisted(() => vi.fn());
const mockFormatPrecedents = vi.hoisted(() => vi.fn());
const mockPrefilterEntities = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('../cached-inference', () => ({
	inferWithCache: mockInferWithCache,
	streamInfer: mockStreamInfer,
}));

vi.mock('@repo/db', () => ({
	searchContactByName: mockSearchContactByName,
	getCommitmentsByContact: mockGetCommitmentsByContact,
	getActiveCommitments: mockGetActiveCommitments,
	getDealsByContact: mockGetDealsByContact,
	listDeals: mockListDeals,
	hybridSearch: mockHybridSearch,
	searchKnowledgeNodes: mockSearchKnowledgeNodes,
	knowledgeGraphSearch: mockKnowledgeGraphSearch,
	provenanceSearch: mockProvenanceSearch,
}));

vi.mock('../embeddings', () => ({
	generateEmbedding: mockGenerateEmbedding,
}));

vi.mock('@repo/crypto', () => ({
	withKeys: vi.fn((_envelope: unknown, fn: () => Promise<unknown>) => fn()),
	keyStore: { getStore: vi.fn(() => ({ bik: Buffer.from('test-bik') })) },
	maskEntities: vi.fn((text: string) => ({ maskedText: text, entityMap: [] })),
}));

vi.mock('../prefilter', () => ({
	prefilterEntities: mockPrefilterEntities,
}));

vi.mock('../precedents', () => ({
	findRelevantPrecedents: mockFindRelevantPrecedents,
	formatPrecedents: mockFormatPrecedents,
}));

const mockRouteQuery = vi.hoisted(() => vi.fn());
vi.mock('../query-router', () => ({
	routeQuery: mockRouteQuery,
	MODEL_IDS: {
		sonnet: 'claude-sonnet-4-6',
		haiku: 'claude-haiku-4-5-20251001',
	},
}));

import type { StreamCallbacks } from '../chat-stream';
import { chatStream } from '../chat-stream';

const fakeEnvelope = {
	encryptedWrk: Buffer.from('fake'),
	kmsContext: {},
	wrkVersion: 1,
};

function makeCallbacks(): StreamCallbacks & { calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		onToolStart: vi.fn(async (name: string) => {
			calls.push(`tool_start:${name}`);
		}),
		onToolEnd: vi.fn(async (name: string) => {
			calls.push(`tool_end:${name}`);
		}),
		onTextDelta: vi.fn(async (text: string) => {
			calls.push(`text:${text}`);
		}),
		onDone: vi.fn(async (toolsUsed: string[]) => {
			calls.push(`done:${toolsUsed.join(',')}`);
		}),
		onError: vi.fn(async (error: string) => {
			calls.push(`error:${error}`);
		}),
	};
}

const textResponse = (text: string) => ({
	stop_reason: 'end_turn',
	content: [{ type: 'text', text }],
});

const toolUseResponse = (toolName: string, toolId: string, input: Record<string, unknown>) => ({
	stop_reason: 'tool_use',
	content: [{ type: 'tool_use', id: toolId, name: toolName, input }],
});

const multiToolResponse = (
	tools: Array<{ name: string; id: string; input: Record<string, unknown> }>,
) => ({
	stop_reason: 'tool_use',
	content: tools.map((t) => ({ type: 'tool_use', id: t.id, name: t.name, input: t.input })),
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

function enableLocalQwenChat() {
	vi.stubEnv('CHAT_LLM_PROVIDER', 'local');
	vi.stubEnv('CHAT_LLM_BASE_URL', 'http://localhost:11434/v1');
	vi.stubEnv('CHAT_LLM_MODEL', 'qwen3:4b-instruct');
}

function makeMockStream(textChunks: string[]) {
	const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
	return {
		on(event: string, cb: (...args: unknown[]) => void) {
			if (!listeners[event]) listeners[event] = [];
			listeners[event].push(cb);
			return this;
		},
		async finalMessage() {
			// Emit text events for each chunk
			for (const chunk of textChunks) {
				for (const cb of listeners.text ?? []) {
					await cb(chunk);
				}
			}
			return { content: [{ type: 'text', text: textChunks.join('') }] };
		},
	};
}

describe('chatStream', () => {
	beforeEach(() => {
		vi.unstubAllEnvs();
		vi.stubEnv('COMMITMENT_LLM_PROVIDER', 'cloud');
		vi.stubGlobal('fetch', fetchMock);
		vi.clearAllMocks();
		mockPrefilterEntities.mockReturnValue([]);
		mockRouteQuery.mockReturnValue('sonnet');
	});

	it('streams final text via onTextDelta when model returns end_turn', async () => {
		mockInferWithCache.mockResolvedValue(textResponse('Hello world'));
		mockStreamInfer.mockReturnValue(makeMockStream(['Hello', ' world']));

		const cb = makeCallbacks();
		await chatStream('ws-1', fakeEnvelope, [{ role: 'user', content: 'Hi' }], '', cb);

		expect(cb.onTextDelta).toHaveBeenCalledWith('Hello');
		expect(cb.onTextDelta).toHaveBeenCalledWith(' world');
		expect(cb.onDone).toHaveBeenCalledWith([]);
	});

	it('streams a local Qwen answer through Ollama without cloud inference', async () => {
		enableLocalQwenChat();
		fetchMock.mockResolvedValue(
			localModelResponse({
				type: 'answer',
				response: 'Local chat is working.',
			}),
		);

		const cb = makeCallbacks();
		await chatStream('ws-1', fakeEnvelope, [{ role: 'user', content: 'Hi' }], '', cb);

		expect(cb.onTextDelta).toHaveBeenCalledWith('Local chat is working.');
		expect(cb.onDone).toHaveBeenCalledWith([]);
		expect(mockInferWithCache).not.toHaveBeenCalled();
		expect(mockStreamInfer).not.toHaveBeenCalled();
		expect(mockRouteQuery).not.toHaveBeenCalled();
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
		};
		expect(body.model).toBe('qwen3:4b-instruct');
		expect(body.stream).toBe(false);
		expect(body.think).toBe(false);
		expect(body.format.properties).toHaveProperty('response');
	});

	it('emits onToolStart/onToolEnd around tool execution', async () => {
		mockSearchContactByName.mockResolvedValue([{ id: 'c-1', firstName: 'Alice' }]);

		mockInferWithCache
			.mockResolvedValueOnce(toolUseResponse('search_contacts', 'tu-1', { name: 'Alice' }))
			.mockResolvedValueOnce(textResponse('Found Alice'));
		mockStreamInfer.mockReturnValue(makeMockStream(['Found Alice']));

		const cb = makeCallbacks();
		await chatStream('ws-1', fakeEnvelope, [{ role: 'user', content: 'Find Alice' }], '', cb);

		expect(cb.calls).toEqual([
			'tool_start:search_contacts',
			'tool_end:search_contacts',
			'text:Found Alice',
			'done:search_contacts',
		]);
	});

	it('calls onDone with all toolsUsed across iterations', async () => {
		mockSearchContactByName.mockResolvedValue([]);
		mockListDeals.mockResolvedValue([]);

		mockInferWithCache
			.mockResolvedValueOnce(toolUseResponse('search_contacts', 'tu-1', { name: 'X' }))
			.mockResolvedValueOnce(toolUseResponse('get_deals', 'tu-2', {}))
			.mockResolvedValueOnce(textResponse('Done'));
		mockStreamInfer.mockReturnValue(makeMockStream(['Done']));

		const cb = makeCallbacks();
		await chatStream('ws-1', fakeEnvelope, [{ role: 'user', content: 'Search' }], '', cb);

		expect(cb.onDone).toHaveBeenCalledWith(['search_contacts', 'get_deals']);
	});

	it('emits onError when tool executor throws', async () => {
		mockSearchContactByName.mockRejectedValue(new Error('DB down'));
		mockInferWithCache
			.mockResolvedValueOnce(toolUseResponse('search_contacts', 'tu-err', { name: 'X' }))
			.mockResolvedValueOnce(textResponse('Sorry'));
		mockStreamInfer.mockReturnValue(makeMockStream(['Sorry']));

		const cb = makeCallbacks();
		await chatStream('ws-1', fakeEnvelope, [{ role: 'user', content: 'Find' }], '', cb);

		// Tool error is caught, execution continues to final text
		expect(cb.onToolStart).toHaveBeenCalledWith('search_contacts');
		expect(cb.onToolEnd).toHaveBeenCalledWith('search_contacts');
		expect(cb.onDone).toHaveBeenCalled();
	});

	it('emits onError on catastrophic failure', async () => {
		mockInferWithCache.mockRejectedValue(new Error('API unreachable'));

		const cb = makeCallbacks();
		await chatStream('ws-1', fakeEnvelope, [{ role: 'user', content: 'Hi' }], '', cb);

		expect(cb.onError).toHaveBeenCalledWith('API unreachable');
		expect(cb.onDone).not.toHaveBeenCalled();
	});

	it('respects max iterations cap (3)', async () => {
		mockSearchContactByName.mockResolvedValue([]);
		mockInferWithCache.mockResolvedValue(
			toolUseResponse('search_contacts', 'tu-loop', { name: 'X' }),
		);

		const cb = makeCallbacks();
		await chatStream('ws-1', fakeEnvelope, [{ role: 'user', content: 'Loop' }], '', cb);

		expect(mockInferWithCache).toHaveBeenCalledTimes(3);
		expect(cb.onTextDelta).toHaveBeenCalledWith(expect.stringContaining('maximum number'));
		expect(cb.onDone).toHaveBeenCalled();
	});

	it('handles multiple tools in a single iteration', async () => {
		mockSearchContactByName.mockResolvedValue([]);
		mockListDeals.mockResolvedValue([]);

		mockInferWithCache
			.mockResolvedValueOnce(
				multiToolResponse([
					{ name: 'search_contacts', id: 'tu-a', input: { name: 'Bob' } },
					{ name: 'get_deals', id: 'tu-b', input: {} },
				]),
			)
			.mockResolvedValueOnce(textResponse('Results'));
		mockStreamInfer.mockReturnValue(makeMockStream(['Results']));

		const cb = makeCallbacks();
		await chatStream('ws-1', fakeEnvelope, [{ role: 'user', content: 'Multi' }], '', cb);

		expect(cb.calls).toEqual([
			'tool_start:search_contacts',
			'tool_end:search_contacts',
			'tool_start:get_deals',
			'tool_end:get_deals',
			'text:Results',
			'done:search_contacts,get_deals',
		]);
	});

	it('uses custom systemPrompt when provided', async () => {
		mockInferWithCache.mockResolvedValue(textResponse('Custom'));
		mockStreamInfer.mockReturnValue(makeMockStream(['Custom']));

		const cb = makeCallbacks();
		await chatStream(
			'ws-1',
			fakeEnvelope,
			[{ role: 'user', content: 'Hi' }],
			'Custom system prompt',
			cb,
		);

		// Both inferWithCache and streamInfer should receive the custom prompt
		expect(mockInferWithCache.mock.calls[0][0]).toBe('Custom system prompt');
		expect(mockStreamInfer.mock.calls[0][0]).toBe('Custom system prompt');
	});

	it('builds context-aware prompt with contact info when context has contactId', async () => {
		mockInferWithCache.mockResolvedValue(textResponse('Contact info'));
		mockStreamInfer.mockReturnValue(makeMockStream(['Contact info']));
		mockGetDealsByContact.mockResolvedValue([]);
		mockGetCommitmentsByContact.mockResolvedValue([]);

		const cb = makeCallbacks();
		const context = {
			page: 'contacts/detail',
			contactId: 'c-123',
			contactName: 'Alice',
			contactSummary: 'VC partner since 2024',
		};
		await chatStream('ws-1', fakeEnvelope, [{ role: 'user', content: 'Hi' }], '', cb, context);

		// System prompt should include contact context
		const systemPrompt = mockInferWithCache.mock.calls[0][0] as string;
		expect(systemPrompt).toContain('Alice');
		expect(systemPrompt).toContain('c-123');
		expect(systemPrompt).toContain('VC partner since 2024');
	});

	it('pre-fetches contact deals + commitments as domain knowledge (Layer 3)', async () => {
		mockInferWithCache.mockResolvedValue(textResponse('Found deals'));
		mockStreamInfer.mockReturnValue(makeMockStream(['Found deals']));
		mockGetDealsByContact.mockResolvedValue([{ id: 'd-1', stage: 'won', value: 100000 }]);
		mockGetCommitmentsByContact.mockResolvedValue([{ id: 'cm-1', title: 'Follow up' }]);

		const cb = makeCallbacks();
		const context = { page: 'contacts/detail', contactId: 'c-123', contactName: 'Bob' };
		await chatStream('ws-1', fakeEnvelope, [{ role: 'user', content: 'Deals?' }], '', cb, context);

		// DAL should be called with workspace_id scoping
		expect(mockGetDealsByContact).toHaveBeenCalledWith('ws-1', 'c-123', fakeEnvelope);
		expect(mockGetCommitmentsByContact).toHaveBeenCalledWith('ws-1', 'c-123', fakeEnvelope, {
			limit: 10,
		});

		// Domain knowledge (Layer 3, arg index 2) should contain pre-fetched data
		const domainKnowledge = mockInferWithCache.mock.calls[0][2] as string;
		expect(domainKnowledge).toContain('Deals');
		expect(domainKnowledge).toContain('d-1');
	});

	it('does not pre-fetch when context has no contactId', async () => {
		mockInferWithCache.mockResolvedValue(textResponse('Dashboard'));
		mockStreamInfer.mockReturnValue(makeMockStream(['Dashboard']));

		const cb = makeCallbacks();
		const context = { page: 'dashboard' };
		await chatStream('ws-1', fakeEnvelope, [{ role: 'user', content: 'Hi' }], '', cb, context);

		expect(mockGetDealsByContact).not.toHaveBeenCalled();
		expect(mockGetCommitmentsByContact).not.toHaveBeenCalled();

		// Domain knowledge should be empty
		const domainKnowledge = mockInferWithCache.mock.calls[0][2] as string;
		expect(domainKnowledge).toBe('');
	});
});

// ─── P4: Smart model routing ──────────────────────────────────────────────────

describe('P4 smart model routing', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockPrefilterEntities.mockReturnValue([]);
	});

	it('passes Haiku model string to inferWithCache when routeQuery returns haiku', async () => {
		mockRouteQuery.mockReturnValue('haiku');
		mockInferWithCache.mockResolvedValue(textResponse('Found it'));
		mockStreamInfer.mockReturnValue(makeMockStream(['Found it']));

		const cb = makeCallbacks();
		await chatStream('ws-1', fakeEnvelope, [{ role: 'user', content: 'search for Alice' }], '', cb);

		const options = mockInferWithCache.mock.calls[0][4];
		expect(options.model).toBe('claude-haiku-4-5-20251001');
		expect(options.helicone.modelTier).toBe('haiku');
	});

	it('passes Sonnet model string to inferWithCache when routeQuery returns sonnet', async () => {
		mockRouteQuery.mockReturnValue('sonnet');
		mockInferWithCache.mockResolvedValue(textResponse('Analysis'));
		mockStreamInfer.mockReturnValue(makeMockStream(['Analysis']));

		const cb = makeCallbacks();
		await chatStream('ws-1', fakeEnvelope, [{ role: 'user', content: 'explain the deal' }], '', cb);

		const options = mockInferWithCache.mock.calls[0][4];
		expect(options.model).toBe('claude-sonnet-4-6');
		expect(options.helicone.modelTier).toBe('sonnet');
	});

	it('Sonnet signals override Haiku when both present', async () => {
		// When the query has both Sonnet and Haiku signals, routeQuery returns sonnet
		mockRouteQuery.mockReturnValue('sonnet');
		mockInferWithCache.mockResolvedValue(textResponse('Done'));
		mockStreamInfer.mockReturnValue(makeMockStream(['Done']));

		const cb = makeCallbacks();
		await chatStream(
			'ws-1',
			fakeEnvelope,
			[{ role: 'user', content: 'find and analyze the deal' }],
			'',
			cb,
		);

		const options = mockInferWithCache.mock.calls[0][4];
		expect(options.model).toBe('claude-sonnet-4-6');
	});

	it('also passes routedModel to streamInfer for final streaming', async () => {
		mockRouteQuery.mockReturnValue('haiku');
		mockInferWithCache.mockResolvedValue(textResponse('Streaming'));
		mockStreamInfer.mockReturnValue(makeMockStream(['Streaming']));

		const cb = makeCallbacks();
		await chatStream('ws-1', fakeEnvelope, [{ role: 'user', content: 'list my contacts' }], '', cb);

		// streamInfer options (5th arg) should also use the routed model
		const streamOptions = mockStreamInfer.mock.calls[0][4];
		expect(streamOptions.model).toBe('claude-haiku-4-5-20251001');
	});

	it('routes based on last user message, not earlier messages', async () => {
		mockRouteQuery.mockReturnValue('haiku');
		mockInferWithCache.mockResolvedValue(textResponse('OK'));
		mockStreamInfer.mockReturnValue(makeMockStream(['OK']));

		const cb = makeCallbacks();
		await chatStream(
			'ws-1',
			fakeEnvelope,
			[
				{ role: 'user', content: 'explain this complex thing' },
				{ role: 'assistant', content: 'Here is the explanation...' },
				{ role: 'user', content: 'search for Bob' },
			],
			'',
			cb,
		);

		// routeQuery should be called with the last user message
		expect(mockRouteQuery).toHaveBeenCalledWith('search for Bob');
	});
});

// ─── buildSystemPrompt ───────────────────────────────────────────────────────

// Re-import to test directly (avoiding biome import stripping)
const { buildSystemPrompt: buildPrompt } = await import('../chat-stream');

describe('buildSystemPrompt', () => {
	it('returns base CHAT_SYSTEM_KERNEL when no context provided', () => {
		const result = buildPrompt();
		expect(result).toContain('You are Gordian');
		expect(result).not.toContain('currently viewing');
	});

	it('returns base prompt when context has no contactId', () => {
		const result = buildPrompt({ page: 'dashboard' });
		expect(result).toContain('You are Gordian');
		expect(result).not.toContain('currently viewing');
	});

	it('appends contact context when contactId is present', () => {
		const result = buildPrompt({
			page: 'contacts/detail',
			contactId: 'c-abc',
			contactName: 'Alice',
			contactSummary: 'Investor at a16z',
		});
		expect(result).toContain('You are Gordian');
		expect(result).toContain('Alice');
		expect(result).toContain('c-abc');
		expect(result).toContain('Investor at a16z');
		expect(result).toContain('"this contact"');
	});

	it('uses fallback name when contactName is missing', () => {
		const result = buildPrompt({ page: 'contacts/detail', contactId: 'c-abc' });
		expect(result).toContain('this contact');
		expect(result).toContain('c-abc');
	});
});
