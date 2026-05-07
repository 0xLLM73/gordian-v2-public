import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Phase 35 (Sprint 18) — Precedent Search Tests
 *
 * Verifies:
 *   - findRelevantPrecedents embeds query and passes workspaceId to searchOutcomes
 *   - Output is PII-free: only type, result, contextLabels, occurredAt returned
 *   - formatPrecedents produces readable text with type/result/labels — no contact IDs
 *
 * Note: search_precedents chat tool executor tests are in chat-tools.test.ts.
 */

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockSearchOutcomes = vi.hoisted(() => vi.fn());
const mockGenerateEmbedding = vi.hoisted(() => vi.fn());
const mockPrefilterEntities = vi.hoisted(() => vi.fn());
const mockMaskEntities = vi.hoisted(() => vi.fn());

vi.mock('@repo/db', () => ({
	searchOutcomes: mockSearchOutcomes,
}));

vi.mock('../embeddings', () => ({
	generateEmbedding: mockGenerateEmbedding,
}));

vi.mock('../prefilter', () => ({
	prefilterEntities: mockPrefilterEntities,
}));

vi.mock('@repo/crypto', async () => {
	const fakeKeys = { dek: Buffer.alloc(32), bik: Buffer.alloc(32), tsk: Buffer.alloc(32) };
	return {
		withKeys: vi.fn((_envelope: unknown, fn: () => unknown) => fn()),
		getCurrentKeys: vi.fn(() => fakeKeys),
		keyStore: { getStore: () => fakeKeys },
		maskEntities: mockMaskEntities,
	};
});

import { findRelevantPrecedents, formatPrecedents } from '../precedents';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WS = 'ws-00000000-0000-0000-0000-000000000001';
const FAKE_EMBEDDING = [0.1, 0.2, 0.3];

const fakeEnvelope = {
	encryptedWrk: Buffer.from('fake'),
	kmsContext: {},
	wrkVersion: 1,
} as Parameters<typeof findRelevantPrecedents>[2];

/** A realistic outcome row returned by searchOutcomes (includes contactId from DB) */
function makeOutcomeRow(
	overrides: Partial<{
		id: string;
		type: string;
		result: string;
		contactId: string;
		contextLabels: string[];
		occurredAt: Date;
	}> = {},
) {
	return {
		id: 'outcome-uuid',
		workspaceId: WS,
		type: 'deal_closed',
		result: 'positive',
		contactId: 'contact-00000000-0000-0000-0000-000000000001', // PII — must NOT appear in output
		contextLabels: ['deal_type:equity', 'stage:won', 'value_range:100k_1m'],
		occurredAt: new Date('2026-01-15'),
		embedding: FAKE_EMBEDDING,
		notes: null,
		...overrides,
	};
}

// ─── findRelevantPrecedents ───────────────────────────────────────────────────

describe('findRelevantPrecedents', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGenerateEmbedding.mockResolvedValue(FAKE_EMBEDDING);
		mockSearchOutcomes.mockResolvedValue([]);
		// SEC-300: prefilterEntities returns empty (no PII detected), maskEntities passes through
		mockPrefilterEntities.mockReturnValue([]);
		mockMaskEntities.mockImplementation((text: string) => ({ maskedText: text }));
	});

	it('masks query via ELM before embedding (SEC-300)', async () => {
		await findRelevantPrecedents(WS, 'equity deal won at series A', fakeEnvelope);

		expect(mockPrefilterEntities).toHaveBeenCalledWith('equity deal won at series A');
		expect(mockMaskEntities).toHaveBeenCalledWith(
			'equity deal won at series A',
			expect.any(Buffer), // bik salt
			[], // prefilter result
		);
		expect(mockGenerateEmbedding).toHaveBeenCalledWith('equity deal won at series A');
	});

	it('passes workspaceId and embedding to searchOutcomes', async () => {
		await findRelevantPrecedents(WS, 'commitment missed by contact', fakeEnvelope);

		expect(mockSearchOutcomes).toHaveBeenCalledWith(
			WS,
			FAKE_EMBEDDING,
			expect.any(Number),
			fakeEnvelope,
		);
	});

	it('defaults limit to 5 when not specified', async () => {
		await findRelevantPrecedents(WS, 'deal lost', fakeEnvelope);

		const [, , calledLimit] = mockSearchOutcomes.mock.calls[0] as [string, number[], number];
		expect(calledLimit).toBe(5);
	});

	it('passes custom limit to searchOutcomes', async () => {
		await findRelevantPrecedents(WS, 'relationship declining', fakeEnvelope, 10);

		const [, , calledLimit] = mockSearchOutcomes.mock.calls[0] as [string, number[], number];
		expect(calledLimit).toBe(10);
	});

	it('returns empty array when no outcomes found', async () => {
		mockSearchOutcomes.mockResolvedValue([]);

		const results = await findRelevantPrecedents(WS, 'intro made', fakeEnvelope);

		expect(results).toEqual([]);
	});

	it('returns structured PII-free context — no contactId in output', async () => {
		mockSearchOutcomes.mockResolvedValue([makeOutcomeRow()]);

		const results = await findRelevantPrecedents(WS, 'equity deal', fakeEnvelope);

		expect(results).toHaveLength(1);
		const precedent = results[0]!;

		// Required fields present
		expect(precedent).toHaveProperty('type', 'deal_closed');
		expect(precedent).toHaveProperty('result', 'positive');
		expect(precedent).toHaveProperty('contextLabels');
		expect(precedent).toHaveProperty('occurredAt');

		// PII guard: contactId must NOT be in the returned object
		expect(precedent).not.toHaveProperty('contactId');
		expect(precedent).not.toHaveProperty('id');
		expect(precedent).not.toHaveProperty('workspaceId');
		expect(precedent).not.toHaveProperty('embedding');
		expect(precedent).not.toHaveProperty('notes');
	});

	it('maps contextLabels correctly from DB row', async () => {
		const labels = ['commitment_type:task', 'assignee:user', 'confidence:high'];
		mockSearchOutcomes.mockResolvedValue([
			makeOutcomeRow({ type: 'commitment_fulfilled', contextLabels: labels }),
		]);

		const results = await findRelevantPrecedents(WS, 'commitment fulfilled', fakeEnvelope);

		expect(results[0]!.contextLabels).toEqual(labels);
	});

	it('returns multiple precedents ordered as returned by searchOutcomes', async () => {
		const rows = [
			makeOutcomeRow({
				type: 'deal_closed',
				result: 'positive',
				occurredAt: new Date('2026-01-10'),
			}),
			makeOutcomeRow({
				type: 'commitment_missed',
				result: 'negative',
				occurredAt: new Date('2026-01-05'),
			}),
		];
		mockSearchOutcomes.mockResolvedValue(rows);

		const results = await findRelevantPrecedents(WS, 'deal outcomes', fakeEnvelope, 2);

		expect(results).toHaveLength(2);
		expect(results[0]!.type).toBe('deal_closed');
		expect(results[1]!.type).toBe('commitment_missed');
	});
});

// ─── formatPrecedents ─────────────────────────────────────────────────────────

describe('formatPrecedents', () => {
	it('returns fallback message when precedents array is empty', () => {
		const result = formatPrecedents([]);

		expect(result).toBe('No similar past outcomes found.');
	});

	it('formats a single precedent with type, result, and labels', () => {
		const precedents = [
			{
				type: 'deal_closed',
				result: 'negative',
				contextLabels: ['deal_type:equity', 'stage:lost', 'value_range:sub_10k'],
				occurredAt: new Date('2026-01-15'),
			},
		];

		const result = formatPrecedents(precedents);

		expect(result).toContain('[deal_closed]');
		expect(result).toContain('NEGATIVE');
		expect(result).toContain('deal_type:equity');
		expect(result).toContain('stage:lost');
		expect(result).toContain('value_range:sub_10k');
	});

	it('formats multiple precedents as separate lines', () => {
		const precedents = [
			{
				type: 'commitment_fulfilled',
				result: 'positive',
				contextLabels: ['commitment_type:promise', 'assignee:user', 'confidence:high'],
				occurredAt: new Date('2026-01-10'),
			},
			{
				type: 'relationship_health',
				result: 'neutral',
				contextLabels: ['trend:stable', 'label:healthy'],
				occurredAt: new Date('2026-01-05'),
			},
		];

		const result = formatPrecedents(precedents);
		const lines = result.split('\n');

		expect(lines).toHaveLength(2);
		expect(lines[0]).toContain('[commitment_fulfilled]');
		expect(lines[1]).toContain('[relationship_health]');
	});

	it('output contains no contact UUIDs or raw PII identifiers', () => {
		const precedents = [
			{
				type: 'intro_connected',
				result: 'positive',
				contextLabels: ['intro_context:investor', 'confidence:high'],
				occurredAt: new Date('2026-02-01'),
			},
		];

		const result = formatPrecedents(precedents);

		// No UUID patterns in output
		expect(result).not.toMatch(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
	});

	it('uppercases the result for visual prominence', () => {
		const precedents = [
			{
				type: 'goal_completed',
				result: 'positive',
				contextLabels: ['goal_type:habit', 'completion:100pct'],
				occurredAt: new Date('2026-01-20'),
			},
		];

		const result = formatPrecedents(precedents);

		expect(result).toContain('POSITIVE');
		expect(result).not.toContain('positive'); // strictly uppercased in result field
	});
});
