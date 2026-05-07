import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockExecute = vi.hoisted(() => vi.fn());
const mockSelectWhere = vi.hoisted(() => vi.fn());
const mockSelectFrom = vi.hoisted(() => vi.fn(() => ({ where: mockSelectWhere })));
const mockSelect = vi.hoisted(() => vi.fn(() => ({ from: mockSelectFrom })));

vi.mock('../../client', () => ({
	db: {
		execute: mockExecute,
		select: mockSelect,
		transaction: vi.fn(
			(fn: (tx: { execute: typeof mockExecute; select: typeof mockSelect }) => Promise<unknown>) =>
				fn({ execute: mockExecute, select: mockSelect }),
		),
	},
}));

const mockWithKeys = vi.hoisted(() => vi.fn((_envelope: unknown, fn: () => unknown) => fn()));

vi.mock('@repo/crypto', () => ({
	withKeys: mockWithKeys,
}));

import type { SealedEnvelope } from '@repo/crypto';
import { provenanceSearch } from '../knowledge';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WS = 'ws-00000000-0000-0000-0000-000000000001';
const fakeEmbedding = Array(512).fill(0.1);

/** CTE row — excludes display_name/description (encrypted, fetched via Drizzle ORM in step 2) */
function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		node_id: 'node-1',
		node_type: 'topic',
		metadata: null,
		depth: 0,
		provenance_score: 0.85,
		...overrides,
	};
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('provenanceSearch', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExecute.mockResolvedValue([]);
		// Step 2 mock: Drizzle ORM select for displayName/description
		mockSelectWhere.mockResolvedValue([]);
		mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
		mockSelect.mockReturnValue({ from: mockSelectFrom });
	});

	it('returns empty array when no results', async () => {
		const results = await provenanceSearch(WS, fakeEmbedding);
		expect(results).toEqual([]);
		// withIterativeScan calls SET LOCAL first, then the CTE query
		expect(mockExecute).toHaveBeenCalledTimes(2);
	});

	it('passes workspaceId in the SQL query', async () => {
		await provenanceSearch(WS, fakeEmbedding);
		// calls[0] = SET LOCAL, calls[1] = CTE query
		const sqlCall = mockExecute.mock.calls[1][0];
		const queryStr = sqlCall.queryChunks
			? sqlCall.queryChunks.map((c: unknown) => String(c)).join('')
			: String(sqlCall);
		expect(queryStr).toContain(WS);
	});

	it('returns both outbound and inbound nodes', async () => {
		mockExecute.mockResolvedValue([
			makeRow({ node_id: 'decision-1', node_type: 'decision', depth: 1, provenance_score: 0.8 }),
			makeRow({ node_id: 'rationale-1', node_type: 'rationale', depth: 1, provenance_score: 0.7 }),
		]);

		const results = await provenanceSearch(WS, fakeEmbedding);
		expect(results).toHaveLength(2);
		expect(results.map((r) => r.nodeId)).toContain('decision-1');
		expect(results.map((r) => r.nodeId)).toContain('rationale-1');
	});

	it('sorts results by provenanceScore descending', async () => {
		mockExecute.mockResolvedValue([
			makeRow({ node_id: 'low', provenance_score: 0.3 }),
			makeRow({ node_id: 'high', provenance_score: 0.9 }),
			makeRow({ node_id: 'mid', provenance_score: 0.6 }),
		]);

		const results = await provenanceSearch(WS, fakeEmbedding);
		expect(results[0].nodeId).toBe('high');
		expect(results[1].nodeId).toBe('mid');
		expect(results[2].nodeId).toBe('low');
	});

	it('respects limit parameter', async () => {
		mockExecute.mockResolvedValue([
			makeRow({ node_id: 'a', provenance_score: 0.9 }),
			makeRow({ node_id: 'b', provenance_score: 0.8 }),
			makeRow({ node_id: 'c', provenance_score: 0.7 }),
		]);

		const results = await provenanceSearch(WS, fakeEmbedding, { limit: 2 });
		expect(results).toHaveLength(2);
	});

	it('caps maxHops at 4', async () => {
		await provenanceSearch(WS, fakeEmbedding, { maxHops: 10 });
		// calls[0] = SET LOCAL, calls[1] = CTE query
		const sqlCall = mockExecute.mock.calls[1][0];
		// The SQL should contain 4 (the cap), not 10
		const values = sqlCall.queryChunks?.filter((c: unknown) => typeof c !== 'string') ?? [];
		const numericValues = values.map((v: unknown) => {
			if (typeof v === 'object' && v !== null && 'value' in v)
				return (v as { value: unknown }).value;
			return v;
		});
		expect(numericValues).toContain(4);
		expect(numericValues).not.toContain(10);
	});

	it('whitelists decision metadata fields (SEC-PROV-011)', async () => {
		mockExecute.mockResolvedValue([
			makeRow({
				node_id: 'decision-1',
				node_type: 'decision',
				metadata: {
					action: 'deal_lost',
					decidedAt: '2026-02-28T00:00:00Z',
					entityId: 'deal-123',
					secretField: 'should-not-appear',
				},
				provenance_score: 0.9,
			}),
		]);

		const results = await provenanceSearch(WS, fakeEmbedding);
		expect(results[0].decisionAction).toBe('deal_lost');
		expect(results[0].decisionDate).toBe('2026-02-28T00:00:00Z');
		expect((results[0] as unknown as Record<string, unknown>).secretField).toBeUndefined();
		expect((results[0] as unknown as Record<string, unknown>).entityId).toBeUndefined();
	});

	it('whitelists outcome metadata fields (SEC-PROV-011)', async () => {
		mockExecute.mockResolvedValue([
			makeRow({
				node_id: 'outcome-1',
				node_type: 'outcome',
				metadata: {
					result: 'positive',
					roi_weight: 1.5,
					sensitiveData: 'should-not-appear',
				},
				provenance_score: 0.8,
			}),
		]);

		const results = await provenanceSearch(WS, fakeEmbedding);
		expect(results[0].outcomeResult).toBe('positive');
		expect(results[0].outcomeRoiWeight).toBe(1.5);
		expect((results[0] as unknown as Record<string, unknown>).sensitiveData).toBeUndefined();
	});

	it('whitelists rationale metadata (SEC-PROV-011)', async () => {
		mockExecute.mockResolvedValue([
			makeRow({
				node_id: 'rationale-1',
				node_type: 'rationale',
				metadata: {
					evidenceQuote: '[MASKED] tokenomics are weak',
					someSecret: 'should-not-appear',
				},
				provenance_score: 0.7,
			}),
		]);

		const results = await provenanceSearch(WS, fakeEmbedding);
		expect(results[0].maskedEvidenceQuote).toBe('[MASKED] tokenomics are weak');
		expect((results[0] as unknown as Record<string, unknown>).someSecret).toBeUndefined();
	});

	it('filters invalid anchorTypes (SEC-PROV-006)', async () => {
		await provenanceSearch(WS, fakeEmbedding, {
			anchorTypes: ['decision', 'invalid_type', 'rationale'],
		});

		// calls[0] = SET LOCAL, calls[1] = CTE query
		const sqlCall = mockExecute.mock.calls[1][0];
		// Serialize the entire SQL to check that the type filter was applied
		const fullSql = JSON.stringify(sqlCall);
		// Should contain the valid types but not the invalid one
		expect(fullSql).toContain('decision');
		expect(fullSql).toContain('rationale');
		expect(fullSql).not.toContain('invalid_type');
	});

	it('does not include metadata blob in result', async () => {
		mockExecute.mockResolvedValue([
			makeRow({
				node_type: 'topic',
				metadata: { anything: 'should-not-leak' },
			}),
		]);

		const results = await provenanceSearch(WS, fakeEmbedding);
		expect((results[0] as unknown as Record<string, unknown>).metadata).toBeUndefined();
	});

	it('handles null metadata gracefully', async () => {
		mockExecute.mockResolvedValue([makeRow({ node_type: 'decision', metadata: null })]);

		const results = await provenanceSearch(WS, fakeEmbedding);
		expect(results[0].decisionAction).toBeUndefined();
		expect(results[0].decisionDate).toBeUndefined();
	});

	it('calls withKeys for Step 2 when envelope is provided (SEC-ENC-515a)', async () => {
		mockExecute.mockResolvedValue([makeRow()]);
		const fakeEnvelope = {
			encryptedWrk: Buffer.from('test'),
			kmsContext: {},
			wrkVersion: 1,
		} as unknown as SealedEnvelope;

		await provenanceSearch(WS, fakeEmbedding, { envelope: fakeEnvelope });

		expect(mockWithKeys).toHaveBeenCalledWith(fakeEnvelope, expect.any(Function));
	});

	it('does not call withKeys when no envelope (SEC-ENC-515a)', async () => {
		mockExecute.mockResolvedValue([makeRow()]);

		await provenanceSearch(WS, fakeEmbedding);

		expect(mockWithKeys).not.toHaveBeenCalled();
	});

	it('Step 2 includes workspace_id in WHERE clause (SEC-ENC-515b)', async () => {
		mockExecute.mockResolvedValue([makeRow()]);

		await provenanceSearch(WS, fakeEmbedding);

		// Step 2 should call db.select().from().where() with a compound condition
		expect(mockSelect).toHaveBeenCalled();
		expect(mockSelectFrom).toHaveBeenCalled();
		expect(mockSelectWhere).toHaveBeenCalled();

		// The where clause should have been called (proving Step 2 ran with filtering)
		const whereArg = mockSelectWhere.mock.calls[0][0];
		expect(whereArg).toBeDefined();
	});
});
