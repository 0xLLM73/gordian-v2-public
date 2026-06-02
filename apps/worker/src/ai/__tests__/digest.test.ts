import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('@repo/crypto', () => ({
	maskEntities: vi.fn((text: string) => ({ maskedText: `[MASKED]${text}`, entityMap: [] })),
}));

vi.mock('@repo/db', () => ({
	getActiveCommitments: vi.fn(() => Promise.resolve([])),
	getChatsByIds: vi.fn(() => Promise.resolve([])),
	getContactsByIds: vi.fn(() => Promise.resolve([])),
	getMessageTimeRangeStats: vi.fn(() => Promise.resolve({ contactCount: 0, messageCount: 0 })),
	getMessagesByTimeRange: vi.fn(() => Promise.resolve([])),
	listDeals: vi.fn(() => Promise.resolve([])),
}));

const mockSelectPromptVariant = vi.fn();
vi.mock('../bandit', () => ({
	selectPromptVariant: mockSelectPromptVariant,
}));

const mockInferWithCache = vi.fn();
vi.mock('../cached-inference', () => ({
	inferWithCache: mockInferWithCache,
}));

vi.mock('../prefilter', () => ({
	prefilterEntities: vi.fn(() => []),
}));
import {
	getActiveCommitments,
	getChatsByIds,
	getContactsByIds,
	getMessageTimeRangeStats,
	getMessagesByTimeRange,
	listDeals,
} from '@repo/db';

describe('generateDigest', () => {
	beforeEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
		vi.clearAllMocks();
		vi.mocked(getActiveCommitments).mockResolvedValue([]);
		vi.mocked(getChatsByIds).mockResolvedValue([]);
		vi.mocked(getContactsByIds).mockResolvedValue([]);
		vi.mocked(getMessageTimeRangeStats).mockResolvedValue({ contactCount: 0, messageCount: 0 });
		vi.mocked(getMessagesByTimeRange).mockResolvedValue([]);
		vi.mocked(listDeals).mockResolvedValue([]);

		mockSelectPromptVariant.mockImplementation((domain: string) => {
			if (domain === 'digest_style') {
				return Promise.resolve({ variant: 'digest_comprehensive', traceId: 'style-trace-1' });
			}
			return Promise.resolve({ variant: 'digest_tone_casual', traceId: 'tone-trace-1' });
		});

		mockInferWithCache.mockResolvedValue({
			content: [
				{
					type: 'tool_use',
					id: 'tool-1',
					name: 'generate_digest',
					input: {
						activity_overview: {
							summary: 'Test summary',
							message_count: 0,
							active_conversations: 0,
							new_contacts: 0,
						},
						highlights: [],
						key_conversations: [],
						action_items: [],
						watch_list: [],
					},
				},
			],
		});
	});

	it('selects both style and tone variants via Thompson Sampling', async () => {
		const { generateDigest } = await import('../digest');

		await generateDigest(
			{
				userId: 'user-1',
				workspaceId: 'ws-1',
				periodStart: new Date('2026-02-15'),
				periodEnd: new Date('2026-02-16'),
				digestFocus: 'balanced',
				workspaceSalt: Buffer.from('test-salt'),
			},
			{
				encryptedWrk: Buffer.from('test'),
				kmsContext: { workspaceId: 'ws-1' },
				wrkVersion: 1,
			},
		);

		expect(mockSelectPromptVariant).toHaveBeenCalledTimes(2);
		expect(mockSelectPromptVariant).toHaveBeenCalledWith(
			'digest_style',
			expect.any(Array),
			'user-1',
		);
		expect(mockSelectPromptVariant).toHaveBeenCalledWith(
			'digest_tone',
			expect.any(Array),
			'user-1',
		);
	});

	it('calls inferWithCache with correct system kernel and tools', async () => {
		const { generateDigest } = await import('../digest');

		await generateDigest(
			{
				userId: 'user-1',
				workspaceId: 'ws-1',
				periodStart: new Date('2026-02-15'),
				periodEnd: new Date('2026-02-16'),
				digestFocus: 'balanced',
				workspaceSalt: Buffer.from('test-salt'),
			},
			{
				encryptedWrk: Buffer.from('test'),
				kmsContext: { workspaceId: 'ws-1' },
				wrkVersion: 1,
			},
		);

		expect(mockInferWithCache).toHaveBeenCalledOnce();
		const call = mockInferWithCache.mock.calls[0];
		// System kernel should contain the base instructions + modifiers
		expect(call[0]).toContain('relationship intelligence analyst');
		// Should include tools
		expect(call[4].tools).toHaveLength(1);
		expect(call[4].tools[0].name).toBe('generate_digest');
		// Helicone feature attribution
		expect(call[4].helicone.feature).toBe('daily-digest');
	});

	it('extracts structured sections from tool_use response', async () => {
		const { generateDigest } = await import('../digest');

		const result = await generateDigest(
			{
				userId: 'user-1',
				workspaceId: 'ws-1',
				periodStart: new Date('2026-02-15'),
				periodEnd: new Date('2026-02-16'),
				digestFocus: 'balanced',
				workspaceSalt: Buffer.from('test-salt'),
			},
			{
				encryptedWrk: Buffer.from('test'),
				kmsContext: { workspaceId: 'ws-1' },
				wrkVersion: 1,
			},
		);

		expect(result.sections).toBeDefined();
		const sections = result.sections as Record<string, unknown>;
		expect(sections.activity_overview).toBeDefined();
		expect(sections.source_coverage).toMatchObject({
			sample_strategy: 'empty-period',
			total_messages: 0,
		});
		expect(sections.highlights).toEqual([]);
		expect(result.styleTraceId).toBe('style-trace-1');
		expect(result.toneTraceId).toBe('tone-trace-1');
		expect(result.styleVariant).toBe('digest_comprehensive');
		expect(result.toneVariant).toBe('digest_tone_casual');
		expect(result.model).toBe('claude-sonnet-4-6');
	});

	it('handles empty message set without error', async () => {
		const { generateDigest } = await import('../digest');

		const result = await generateDigest(
			{
				userId: 'user-1',
				workspaceId: 'ws-1',
				periodStart: new Date('2026-02-15'),
				periodEnd: new Date('2026-02-16'),
				digestFocus: 'balanced',
				workspaceSalt: Buffer.from('test-salt'),
			},
			{
				encryptedWrk: Buffer.from('test'),
				kmsContext: { workspaceId: 'ws-1' },
				wrkVersion: 1,
			},
		);

		expect(result.messageCount).toBe(0);
		expect(result.contactCount).toBe(0);
	});

	it('uses local Qwen digest generation without cloud inference when configured', async () => {
		vi.stubEnv('DIGEST_LLM_PROVIDER', 'local');
		vi.stubEnv('DIGEST_LLM_API', 'ollama');
		vi.stubEnv('DIGEST_LLM_BASE_URL', 'http://localhost:11434');
		vi.stubEnv('DIGEST_LLM_MODEL', 'qwen3.5:9b');
		vi.mocked(getMessageTimeRangeStats).mockResolvedValueOnce({
			contactCount: 1,
			messageCount: 1,
		});
		vi.mocked(getMessagesByTimeRange).mockResolvedValueOnce([
			{
				chatId: 'chat-1',
				id: 'msg-1',
				contactId: 'contact-1',
				text: 'follow up tomorrow',
				sentAt: new Date('2026-02-15T12:00:00Z'),
			} as Awaited<ReturnType<typeof getMessagesByTimeRange>>[number],
		]);
		vi.mocked(getContactsByIds).mockResolvedValueOnce([
			{
				id: 'contact-1',
				firstName: 'Test',
				lastName: 'Contact',
			} as Awaited<ReturnType<typeof getContactsByIds>>[number],
		]);
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					message: {
						content: JSON.stringify({
							activity_overview: {
								summary: 'Local summary',
								message_count: 1,
								active_conversations: 1,
								new_contacts: 0,
							},
							highlights: [],
							key_conversations: [
								{
									contact_ref: 'Test Contact',
									summary: 'Follow-up was discussed.',
									sentiment: 'neutral',
								},
							],
							action_items: [
								{
									item: 'Follow up tomorrow',
									priority: 'medium',
									contact_ref: 'Test Contact',
								},
							],
							watch_list: [],
						}),
					},
				}),
				{ headers: { 'content-type': 'application/json' }, status: 200 },
			),
		);
		vi.stubGlobal('fetch', fetchMock);
		const { generateDigest } = await import('../digest');

		const result = await generateDigest(
			{
				userId: 'user-1',
				workspaceId: 'ws-1',
				periodStart: new Date('2026-02-15'),
				periodEnd: new Date('2026-02-16'),
				digestFocus: 'balanced',
				workspaceSalt: Buffer.from('test-salt'),
			},
			{
				encryptedWrk: Buffer.from('test'),
				kmsContext: { workspaceId: 'ws-1' },
				wrkVersion: 1,
			},
		);

		expect(mockInferWithCache).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledOnce();
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('http://localhost:11434/api/chat');
		const body = JSON.parse(String(init.body)) as Record<string, unknown>;
		expect(body.model).toBe('qwen3.5:9b');
		expect(body.format).toMatchObject({ type: 'object' });
		expect(body.messages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					role: 'system',
					content: expect.stringContaining('Return JSON only'),
				}),
			]),
		);
		expect(result.model).toBe('qwen3.5:9b');
		expect(result.messageCount).toBe(1);
		expect(result.contactCount).toBe(1);
		expect(result.sections).toMatchObject({
			activity_overview: { summary: 'Local summary' },
			action_items: [{ item: 'Follow up tomorrow', priority: 'medium' }],
			source_coverage: {
				sample_strategy: 'full-period',
				sampled_messages: 1,
				total_messages: 1,
			},
		});
	});

	it('repairs malformed local Qwen JSON before failing digest generation', async () => {
		vi.stubEnv('DIGEST_LLM_PROVIDER', 'local');
		vi.stubEnv('DIGEST_LLM_API', 'ollama');
		vi.stubEnv('DIGEST_LLM_BASE_URL', 'http://localhost:11434');
		vi.stubEnv('DIGEST_LLM_MODEL', 'qwen3.5:9b');
		vi.mocked(getMessageTimeRangeStats).mockResolvedValueOnce({
			contactCount: 1,
			messageCount: 1,
		});
		vi.mocked(getMessagesByTimeRange).mockResolvedValueOnce([
			{
				chatId: 'chat-1',
				id: 'msg-1',
				contactId: 'contact-1',
				text: 'repair the json',
				sentAt: new Date('2026-02-15T12:00:00Z'),
			} as Awaited<ReturnType<typeof getMessagesByTimeRange>>[number],
		]);
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						message: {
							content:
								'{"activity_overview":{"summary":"Broken JSON","message_count":1,"active_conversations":1},"highlights":[{"title":"Broken","detail":"Missing bracket"}',
						},
					}),
					{ headers: { 'content-type': 'application/json' }, status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						message: {
							content: JSON.stringify({
								activity_overview: {
									summary: 'Repaired JSON',
									message_count: 1,
									active_conversations: 1,
									new_contacts: 0,
								},
								highlights: [{ title: 'Repaired', detail: 'JSON was repaired locally.' }],
								key_conversations: [],
								action_items: [],
								watch_list: [],
							}),
						},
					}),
					{ headers: { 'content-type': 'application/json' }, status: 200 },
				),
			);
		vi.stubGlobal('fetch', fetchMock);
		const { generateDigest } = await import('../digest');

		const result = await generateDigest(
			{
				userId: 'user-1',
				workspaceId: 'ws-1',
				periodStart: new Date('2026-02-15T00:00:00Z'),
				periodEnd: new Date('2026-02-16T00:00:00Z'),
				digestFocus: 'balanced',
				workspaceSalt: Buffer.from('test-salt'),
			},
			{
				encryptedWrk: Buffer.from('test'),
				kmsContext: { workspaceId: 'ws-1' },
				wrkVersion: 1,
			},
		);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		const repairBody = JSON.parse(
			String((fetchMock.mock.calls[1][1] as RequestInit).body),
		) as Record<string, unknown>;
		const repairMessages = repairBody.messages as Array<{ role: string; content: string }>;
		expect(repairMessages[0].content).toContain('repair malformed JSON');
		expect(repairMessages[1].content).toContain('Malformed JSON');
		expect(result.sections).toMatchObject({
			activity_overview: { summary: 'Repaired JSON' },
			highlights: [{ title: 'Repaired', detail: 'JSON was repaired locally.' }],
		});
	});

	it('summarizes larger local digest prompts in Qwen batches before the final pass', async () => {
		vi.stubEnv('DIGEST_LLM_PROVIDER', 'local');
		vi.stubEnv('DIGEST_LLM_API', 'ollama');
		vi.stubEnv('DIGEST_LLM_BASE_URL', 'http://localhost:11434');
		vi.stubEnv('DIGEST_LLM_MODEL', 'qwen3.5:9b');
		vi.mocked(getMessageTimeRangeStats).mockResolvedValueOnce({
			contactCount: 11,
			messageCount: 66,
		});
		vi.mocked(getMessagesByTimeRange).mockResolvedValueOnce(
			Array.from({ length: 66 }, (_, index) => {
				const contactNumber = Math.floor(index / 6);
				const messageNumber = index % 6;
				return {
					chatId: `chat-${contactNumber}`,
					id: `msg-${index}`,
					contactId: `contact-${contactNumber}`,
					text: `message ${contactNumber}-${messageNumber}`,
					sentAt: new Date(Date.UTC(2026, 1, 15, 0, index, 0)),
				} as Awaited<ReturnType<typeof getMessagesByTimeRange>>[number];
			}),
		);
		vi.mocked(getContactsByIds).mockResolvedValueOnce(
			Array.from({ length: 11 }, (_, index) => ({
				id: `contact-${index}`,
				firstName: 'Contact',
				lastName: `${index}`,
			})) as Awaited<ReturnType<typeof getContactsByIds>>,
		);

		const ollamaResponse = (content: Record<string, unknown>) =>
			new Response(
				JSON.stringify({
					message: {
						content: JSON.stringify(content),
					},
				}),
				{ headers: { 'content-type': 'application/json' }, status: 200 },
			);
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				ollamaResponse({
					summary: 'Batch one summary',
					highlights: ['Batch one highlight'],
					key_conversations: [{ contact_ref: 'Contact 10', summary: 'Contact 10 update' }],
					action_items: [],
					watch_list: [],
				}),
			)
			.mockResolvedValueOnce(
				ollamaResponse({
					summary: 'Batch two summary',
					highlights: ['Batch two highlight'],
					key_conversations: [{ contact_ref: 'Contact 0', summary: 'Contact 0 update' }],
					action_items: [{ item: 'Follow up from batch two', priority: 'medium' }],
					watch_list: [],
				}),
			)
			.mockResolvedValueOnce(
				ollamaResponse({
					activity_overview: {
						summary: 'Final digest summary',
						message_count: 66,
						active_conversations: 11,
						new_contacts: 0,
					},
					highlights: [{ title: 'Batched context', detail: 'Used compact batch summaries.' }],
					key_conversations: [
						{
							contact_ref: 'Contact 10',
							summary: 'Included from batch one.',
							sentiment: 'neutral',
						},
					],
					action_items: [{ item: 'Follow up from batch two', priority: 'medium' }],
					watch_list: [],
				}),
			);
		vi.stubGlobal('fetch', fetchMock);
		const { generateDigest } = await import('../digest');

		const result = await generateDigest(
			{
				userId: 'user-1',
				workspaceId: 'ws-1',
				periodStart: new Date('2026-02-15T00:00:00Z'),
				periodEnd: new Date('2026-02-16T00:00:00Z'),
				digestFocus: 'balanced',
				workspaceSalt: Buffer.from('test-salt'),
			},
			{
				encryptedWrk: Buffer.from('test'),
				kmsContext: { workspaceId: 'ws-1' },
				wrkVersion: 1,
			},
		);

		expect(mockInferWithCache).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledTimes(3);
		const firstBatchBody = JSON.parse(
			String((fetchMock.mock.calls[0][1] as RequestInit).body),
		) as Record<string, unknown>;
		const finalBody = JSON.parse(
			String((fetchMock.mock.calls[2][1] as RequestInit).body),
		) as Record<string, unknown>;
		const firstBatchMessages = firstBatchBody.messages as Array<{ role: string; content: string }>;
		const finalMessages = finalBody.messages as Array<{ role: string; content: string }>;
		expect(firstBatchMessages[1].content).toContain('batch 1 of 2');
		expect(firstBatchMessages[1].content).toContain('[MASKED]message');
		expect(finalMessages[1].content).toContain('Local Qwen batch summaries');
		expect(finalMessages[1].content).toContain('Batch one summary');
		expect(finalMessages[1].content).toContain('Batch two summary');
		expect(finalMessages[1].content).not.toContain('[MASKED]message');
		expect(result.sections).toMatchObject({
			activity_overview: { summary: 'Final digest summary' },
			source_coverage: {
				batch_count: 2,
				batch_messages: 66,
				batch_strategy: 'local-qwen-map-reduce:2x~60',
				prompt_messages: 66,
				total_messages: 66,
			},
		});
	});

	it('samples large periods across the full time range and exposes coverage', async () => {
		vi.mocked(getMessageTimeRangeStats).mockResolvedValueOnce({
			contactCount: 25,
			messageCount: 1000,
		});
		vi.mocked(getMessagesByTimeRange).mockImplementation(
			async (_workspaceId, _start, _end, _envelope, options) => {
				const offset = options?.offset ?? 0;
				const limit = options?.limit ?? 20;
				return Array.from({ length: limit }, (_, index) => {
					const sequence = offset + index;
					return {
						chatId: `chat-${sequence % 25}`,
						id: `msg-${sequence}`,
						contactId: `contact-${sequence % 25}`,
						text: `message ${sequence}`,
						sentAt: new Date(Date.UTC(2026, 1, 15, 0, sequence % 60, 0)),
					} as Awaited<ReturnType<typeof getMessagesByTimeRange>>[number];
				});
			},
		);
		const { generateDigest } = await import('../digest');

		const result = await generateDigest(
			{
				userId: 'user-1',
				workspaceId: 'ws-1',
				periodStart: new Date('2026-02-15T00:00:00Z'),
				periodEnd: new Date('2026-02-16T00:00:00Z'),
				digestFocus: 'balanced',
				workspaceSalt: Buffer.from('test-salt'),
			},
			{
				encryptedWrk: Buffer.from('test'),
				kmsContext: { workspaceId: 'ws-1' },
				wrkVersion: 1,
			},
		);

		expect(getMessagesByTimeRange).toHaveBeenCalledTimes(12);
		expect(getMessagesByTimeRange).toHaveBeenCalledWith(
			'ws-1',
			expect.any(Date),
			expect.any(Date),
			expect.any(Object),
			expect.objectContaining({ limit: 20, offset: 0, order: 'desc' }),
		);
		expect(getMessagesByTimeRange).toHaveBeenCalledWith(
			'ws-1',
			expect.any(Date),
			expect.any(Date),
			expect.any(Object),
			expect.objectContaining({ limit: 20, offset: 980, order: 'desc' }),
		);
		const userMessage = mockInferWithCache.mock.calls[0][3][0].content;
		expect(userMessage).toContain('Total period messages: 1000');
		expect(userMessage).toContain('Sampling strategy: time-spread:12x20');
		expect(result.messageCount).toBe(1000);
		expect(result.contactCount).toBe(25);
		expect(result.sections).toMatchObject({
			source_coverage: {
				message_budget: 240,
				sample_strategy: 'time-spread:12x20',
				sampled_messages: 240,
				total_conversations: 25,
				total_messages: 1000,
			},
		});
	});

	it('uses chat titles for contactless group conversations', async () => {
		vi.mocked(getMessageTimeRangeStats).mockResolvedValueOnce({
			contactCount: 1,
			messageCount: 2,
		});
		vi.mocked(getMessagesByTimeRange).mockResolvedValueOnce([
			{
				chatId: 'chat-group-1',
				id: 'msg-1',
				contactId: null,
				text: 'group update one',
				sentAt: new Date('2026-02-15T12:00:00Z'),
			} as Awaited<ReturnType<typeof getMessagesByTimeRange>>[number],
			{
				chatId: 'chat-group-1',
				id: 'msg-2',
				contactId: null,
				text: 'group update two',
				sentAt: new Date('2026-02-15T12:05:00Z'),
			} as Awaited<ReturnType<typeof getMessagesByTimeRange>>[number],
		]);
		vi.mocked(getChatsByIds).mockResolvedValueOnce([
			{
				id: 'chat-group-1',
				title: 'Builders Group',
				username: null,
				type: 'supergroup',
			} as Awaited<ReturnType<typeof getChatsByIds>>[number],
		]);
		const { generateDigest } = await import('../digest');

		await generateDigest(
			{
				userId: 'user-1',
				workspaceId: 'ws-1',
				periodStart: new Date('2026-02-15T00:00:00Z'),
				periodEnd: new Date('2026-02-16T00:00:00Z'),
				digestFocus: 'balanced',
				workspaceSalt: Buffer.from('test-salt'),
			},
			{
				encryptedWrk: Buffer.from('test'),
				kmsContext: { workspaceId: 'ws-1' },
				wrkVersion: 1,
			},
		);

		expect(getChatsByIds).toHaveBeenCalledWith('ws-1', ['chat-group-1'], expect.any(Object));
		const userMessage = mockInferWithCache.mock.calls[0][3][0].content;
		expect(userMessage).toContain('Builders Group (2 sampled messages)');
		expect(userMessage).not.toContain('Unknown Contact (2 sampled messages)');
	});

	it('includes focus instruction when not balanced', async () => {
		const { generateDigest } = await import('../digest');

		await generateDigest(
			{
				userId: 'user-1',
				workspaceId: 'ws-1',
				periodStart: new Date('2026-02-15'),
				periodEnd: new Date('2026-02-16'),
				digestFocus: 'commitments',
				workspaceSalt: Buffer.from('test-salt'),
			},
			{
				encryptedWrk: Buffer.from('test'),
				kmsContext: { workspaceId: 'ws-1' },
				wrkVersion: 1,
			},
		);

		const userMessage = mockInferWithCache.mock.calls[0][3][0].content;
		expect(userMessage).toContain('FOCUS: Emphasize commitments');
	});

	it('fetches commitments and deals for the time period', async () => {
		const { generateDigest } = await import('../digest');

		await generateDigest(
			{
				userId: 'user-1',
				workspaceId: 'ws-1',
				periodStart: new Date('2026-02-15'),
				periodEnd: new Date('2026-02-16'),
				digestFocus: 'balanced',
				workspaceSalt: Buffer.from('test-salt'),
			},
			{
				encryptedWrk: Buffer.from('test'),
				kmsContext: { workspaceId: 'ws-1' },
				wrkVersion: 1,
			},
		);

		expect(getActiveCommitments).toHaveBeenCalledWith('ws-1', expect.any(Object), { limit: 30 });
		expect(listDeals).toHaveBeenCalledWith('ws-1', expect.any(Object), { limit: 20 });
	});
});
