import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetTopPatterns = vi.fn();
const mockGetGoldenLibrary = vi.fn();
const mockSeedBanditPriors = vi.fn();
const mockCheckCommitmentHeuristic = vi.fn((_content: string) => ({
	matched: false,
	pattern: '',
	confidence: 0,
}));
const mockSelectPromptVariant = vi.fn(() =>
	Promise.resolve({ traceId: 'trace-local-qwen', variant: 'extraction_default' }),
);

vi.mock('@repo/db', () => ({
	getTopPatterns: mockGetTopPatterns,
	getGoldenLibrary: mockGetGoldenLibrary,
}));

vi.mock('../bandit', () => ({
	seedBanditPriors: mockSeedBanditPriors,
	selectPromptVariant: mockSelectPromptVariant,
}));

vi.mock('../cached-inference', () => ({
	inferWithCache: vi.fn(),
	getHeliconeHeaders: vi.fn(() => ({})),
}));

vi.mock('../commitment-heuristics', () => ({
	checkCommitmentHeuristic: mockCheckCommitmentHeuristic,
}));

const mockHaikuCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
	default: class MockAnthropic {
		messages = { create: mockHaikuCreate };
	},
}));

const fetchMock = vi.fn();

function enableLocalQwenCommitments() {
	vi.stubEnv('NODE_ENV', 'development');
	vi.stubEnv('AI_PROCESSING_ENABLED', 'false');
	vi.stubEnv('COMMITMENT_LLM_PROVIDER', 'local');
	vi.stubEnv('COMMITMENT_LLM_BASE_URL', 'http://localhost:11434/v1');
	vi.stubEnv('COMMITMENT_LLM_MODEL', 'qwen3:4b-instruct');
	vi.stubEnv('KNOWLEDGE_EMBEDDING_PROVIDER', 'local');
	vi.stubEnv('KNOWLEDGE_EMBEDDING_PRESET', 'qwen');
	vi.stubEnv('KNOWLEDGE_EMBEDDING_MODEL', 'qwen3-embedding:0.6b');
}

describe('local Qwen commitment extraction', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		vi.unstubAllEnvs();
		vi.stubGlobal('fetch', fetchMock);
		mockCheckCommitmentHeuristic.mockImplementation(() => ({
			matched: false,
			pattern: '',
			confidence: 0,
		}));
		mockGetTopPatterns.mockResolvedValue([]);
		mockGetGoldenLibrary.mockResolvedValue([]);
		fetchMock.mockResolvedValue({
			ok: true,
			json: () =>
				Promise.resolve({
					message: {
						content: JSON.stringify({
							commitments: [
								{
									title: 'Send the deck tomorrow',
									commitment_type: 'task',
									assignee: 'user',
									due_date: null,
									due_date_text: 'tomorrow',
									due_precision: 'relative',
									confidence: 0.82,
									quote: 'the deck tomorrow',
									source_message_ids: ['11111111-1111-4111-8111-111111111111'],
									evidence_level: 'explicit',
									state: 'open',
									rationale_tags: ['explicit_promise'],
									failure_reason: null,
								},
								{
									title: 'Maybe catch up',
									commitment_type: 'meeting',
									assignee: 'user',
									due_date: null,
									due_date_text: null,
									due_precision: 'unknown',
									confidence: 0.2,
									quote: 'maybe catch up',
									source_message_ids: ['11111111-1111-4111-8111-111111111111'],
									evidence_level: 'weak',
									state: 'open',
									rationale_tags: ['weak_language'],
									failure_reason: null,
								},
							],
						}),
					},
				}),
			text: () => Promise.resolve(''),
		});
	});

	it('routes local commitment extraction to Qwen and does not call Anthropic', async () => {
		enableLocalQwenCommitments();
		const { extractCommitmentsWithBandit } = await import('../commitment-extraction');

		const result = await extractCommitmentsWithBandit(
			[
				{
					id: '11111111-1111-4111-8111-111111111111',
					sourceMessageId: '11111111-1111-4111-8111-111111111111',
					role: 'user',
					content:
						"I'll send alice@example.com the deck tomorrow. Maybe catch up. Call +1-555-123-4567.",
					timestamp: '2026-01-01T00:00:00Z',
				},
			],
			'2026-01-01T00:00:00Z',
			'user-1',
			'workspace-1',
			{ workspaceSalt: Buffer.from('workspace-salt') },
		);

		expect(mockHaikuCreate).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledWith(
			'http://localhost:11434/api/chat',
			expect.objectContaining({
				headers: expect.not.objectContaining({
					Authorization: expect.any(String),
				}),
			}),
		);

		const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
			keep_alive?: string;
			model: string;
			messages: Array<{ role: string; content: string }>;
			format: { type: string; properties: Record<string, unknown> };
			options: { num_predict: number; temperature: number };
			stream: boolean;
			think: boolean;
		};
		expect(body.model).toBe('qwen3:4b-instruct');
		expect(body.format.properties).toHaveProperty('commitments');
		expect(body.stream).toBe(false);
		expect(body.think).toBe(false);
		expect(body.keep_alive).toBe('1m');
		expect(body.options.num_predict).toBeGreaterThan(0);
		expect(body.messages[1].content).not.toContain('alice@example.com');
		expect(body.messages[1].content).not.toContain('+1-555-123-4567');
		expect(body.messages[1].content).toContain('EMAIL_');
		expect(body.messages[1].content).toContain('PHONE_');

		expect(result.candidates).toHaveLength(2);
		expect(result.commitments).toHaveLength(1);
		expect(result.commitments[0].title).toBe('Send the deck tomorrow');
		expect(result.commitments[0].source_message_ids).toEqual([
			'11111111-1111-4111-8111-111111111111',
		]);
		expect(result.traceId).toBe('trace-local-qwen');
	});

	it('does not store heuristic-looking text when local Qwen returns no commitment', async () => {
		enableLocalQwenCommitments();
		fetchMock.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					message: {
						content: JSON.stringify({ commitments: [] }),
					},
				}),
			text: () => Promise.resolve(''),
		});
		const { extractCommitmentsWithBandit } = await import('../commitment-extraction');

		const result = await extractCommitmentsWithBandit(
			[
				{
					id: '11111111-1111-4111-8111-111111111111',
					sourceMessageId: '11111111-1111-4111-8111-111111111111',
					role: 'user',
					content: "I'll be there haha",
					timestamp: '2026-01-01T00:00:00Z',
				},
			],
			'2026-01-01T00:00:00Z',
			'user-1',
			'workspace-1',
			{ workspaceSalt: Buffer.from('workspace-salt') },
		);

		expect(fetchMock).toHaveBeenCalled();
		expect(result.commitments).toHaveLength(0);
	});

	it('repairs invalid local Qwen source ids when the quote grounds to one source line', async () => {
		enableLocalQwenCommitments();
		fetchMock.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					message: {
						content: JSON.stringify({
							commitments: [
								{
									title: 'Send the deck tomorrow',
									commitment_type: 'task',
									assignee: 'user',
									due_date: null,
									due_date_text: 'tomorrow',
									due_precision: 'relative',
									confidence: 0.82,
									quote: 'I will send the deck tomorrow.',
									source_message_ids: ['missing-source'],
									evidence_level: 'explicit',
									state: 'open',
									rationale_tags: ['explicit_promise'],
									failure_reason: null,
								},
							],
						}),
					},
				}),
			text: () => Promise.resolve(''),
		});
		const { extractCommitmentsWithBandit } = await import('../commitment-extraction');

		const result = await extractCommitmentsWithBandit(
			[
				{
					id: '22222222-2222-4222-8222-222222222222',
					sourceMessageId: '22222222-2222-4222-8222-222222222222',
					role: 'user',
					content: 'I will send the deck tomorrow.',
					timestamp: '2026-01-01T00:01:00Z',
				},
				{
					id: '33333333-3333-4333-8333-333333333333',
					sourceMessageId: '33333333-3333-4333-8333-333333333333',
					role: 'assistant',
					content: 'Thanks.',
					timestamp: '2026-01-01T00:02:00Z',
				},
			],
			'2026-01-01T00:00:00Z',
			'user-1',
			'workspace-1',
			{ workspaceSalt: Buffer.from('workspace-salt') },
		);

		expect(fetchMock).toHaveBeenCalled();
		expect(result.commitments).toEqual([
			expect.objectContaining({
				title: 'Send the deck tomorrow',
				source_message_ids: ['22222222-2222-4222-8222-222222222222'],
			}),
		]);
	});

	it('parses common local JSON variants without weakening required fields', async () => {
		const { parseLocalCommitmentJson } = await import('../commitment-extraction');

		expect(
			parseLocalCommitmentJson(`Here is the JSON:
{
  "extracted_commitments": [
    {
      "title": "Review the terms",
      "commitmentType": "task",
      "assignee": "user",
      "confidence": "0.74",
      "source_quote": "I can review the terms"
    },
    {
      "title": "Missing quote",
      "commitment_type": "task",
      "assignee": "user",
      "confidence": 0.9
    }
  ]
}`),
		).toEqual([
			expect.objectContaining({
				title: 'Review the terms',
				commitment_type: 'task',
				assignee: 'user',
				confidence: 0.74,
				quote: 'I can review the terms',
			}),
		]);
	});

	it('sends learned structural hints to local Qwen without raw golden text', async () => {
		enableLocalQwenCommitments();
		mockGetTopPatterns.mockResolvedValue([
			{ patternText: 'Web3 "ape in" is financial', confidenceScore: 0.72 },
		]);
		mockGetGoldenLibrary.mockResolvedValue([
			{
				inputContext: 'Alice alice@example.com said she would send the deck',
				correctedOutput: {
					title: 'Send deck to Alice alice@example.com',
					commitment_type: 'task',
					assignee: 'user',
					confidence: 0.76,
					quote: 'send the deck to Alice',
				},
			},
		]);
		const { extractCommitmentsWithBandit } = await import('../commitment-extraction');

		await extractCommitmentsWithBandit(
			[
				{
					id: '11111111-1111-4111-8111-111111111111',
					sourceMessageId: '11111111-1111-4111-8111-111111111111',
					role: 'user',
					content: 'I will send the deck tomorrow',
					timestamp: '2026-01-01T00:00:00Z',
				},
			],
			'2026-01-01T00:00:00Z',
			'user-1',
			'workspace-1',
		);

		const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
			messages: Array<{ role: string; content: string }>;
		};
		const systemPrompt = body.messages[0].content;
		expect(systemPrompt).toContain('Learned calibration hints');
		expect(systemPrompt).toContain('Web3');
		expect(systemPrompt).toContain('"commitment_type":"task"');
		expect(systemPrompt).not.toContain('alice@example.com');
		expect(systemPrompt).not.toContain('Send deck to Alice');
	});

	it('does not call local Qwen when deterministic triggers find no episode', async () => {
		enableLocalQwenCommitments();
		const { extractCommitmentsWithBandit } = await import('../commitment-extraction');

		const result = await extractCommitmentsWithBandit(
			[{ role: 'contact', content: 'Nice to meet you.', timestamp: '2026-01-01T00:00:00Z' }],
			'2026-01-01T00:00:00Z',
			'user-1',
			'workspace-1',
		);

		expect(fetchMock).not.toHaveBeenCalled();
		expect(result.commitments).toEqual([]);
	});

	it('rejects local outputs that are not grounded to the masked episode', async () => {
		enableLocalQwenCommitments();
		fetchMock.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					message: {
						content: JSON.stringify({
							commitments: [
								{
									title: 'Send the deck tomorrow',
									commitment_type: 'task',
									assignee: 'user',
									due_date: null,
									due_date_text: 'tomorrow',
									due_precision: 'relative',
									confidence: 0.91,
									quote: 'not in transcript',
									source_message_ids: ['missing-source'],
									evidence_level: 'explicit',
									state: 'open',
									rationale_tags: ['explicit_promise'],
									failure_reason: null,
								},
							],
						}),
					},
				}),
			text: () => Promise.resolve(''),
		});
		const { extractCommitmentsWithBandit } = await import('../commitment-extraction');

		const result = await extractCommitmentsWithBandit(
			[
				{
					id: '11111111-1111-4111-8111-111111111111',
					sourceMessageId: '11111111-1111-4111-8111-111111111111',
					role: 'user',
					content: "I'll send the deck tomorrow",
					timestamp: '2026-01-01T00:00:00Z',
				},
			],
			'2026-01-01T00:00:00Z',
			'user-1',
			'workspace-1',
		);

		expect(result.candidates).toEqual([]);
		expect(result.commitments).toEqual([]);
	});
});
