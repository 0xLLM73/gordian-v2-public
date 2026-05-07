import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('@repo/crypto', () => ({
	maskEntities: vi.fn((text: string) => ({ maskedText: `[MASKED]${text}`, entityMap: [] })),
}));

vi.mock('@repo/db', () => ({
	getActiveCommitments: vi.fn(() => Promise.resolve([])),
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
import { getActiveCommitments, listDeals } from '@repo/db';

describe('generateDigest', () => {
	beforeEach(() => {
		vi.clearAllMocks();

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
