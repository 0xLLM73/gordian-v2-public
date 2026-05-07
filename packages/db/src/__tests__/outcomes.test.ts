import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockInsertReturning = vi.hoisted(() => vi.fn());
const mockInsertValues = vi.hoisted(() => vi.fn(() => ({ returning: mockInsertReturning })));
const mockInsert = vi.hoisted(() => vi.fn(() => ({ values: mockInsertValues })));

const mockExecute = vi.hoisted(() => vi.fn());

// select chain: select → from → where → orderBy → limit
const mockSelectLimit = vi.hoisted(() => vi.fn());
const mockSelectOrderBy = vi.hoisted(() => vi.fn(() => ({ limit: mockSelectLimit })));
const mockSelectWhere = vi.hoisted(() =>
	vi.fn<any>(() => ({ orderBy: mockSelectOrderBy, groupBy: mockSelectGroupBy })),
);
const mockSelectGroupBy = vi.hoisted(() => vi.fn());
const mockSelectFrom = vi.hoisted(() => vi.fn(() => ({ where: mockSelectWhere })));
const mockSelect = vi.hoisted(() => vi.fn(() => ({ from: mockSelectFrom })));

vi.mock('../client', () => ({
	db: {
		insert: mockInsert,
		execute: mockExecute,
		select: mockSelect,
	},
}));

import { createOutcome, getOutcomeStats, listOutcomes, searchOutcomes } from '../dal/outcomes';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WS = 'a0000000-0000-0000-0000-000000000001';
const CONTACT = 'b0000000-0000-0000-0000-000000000002';

const baseOutcome = {
	id: 'oc-00000000-0000-0000-0000-000000000001',
	workspaceId: WS,
	contactId: CONTACT,
	type: 'deal_closed' as const,
	result: 'positive' as const,
	contextLabels: ['deal_type:equity', 'stage:won', 'value_range:100k-500k'],
	notes: null,
	embedding: null,
	occurredAt: new Date('2026-01-15T10:00:00Z'),
	createdAt: new Date('2026-01-15T10:00:00Z'),
};

// ─── createOutcome ────────────────────────────────────────────────────────────

describe('createOutcome', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockInsert.mockReturnValue({ values: mockInsertValues });
		mockInsertValues.mockReturnValue({ returning: mockInsertReturning });
	});

	it('inserts outcome and returns the created row', async () => {
		mockInsertReturning.mockResolvedValueOnce([baseOutcome]);

		const result = await createOutcome(WS, {
			contactId: CONTACT,
			type: 'deal_closed',
			result: 'positive',
			contextLabels: ['deal_type:equity', 'stage:won', 'value_range:100k-500k'],
		});

		expect(mockInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceId: WS,
				contactId: CONTACT,
				type: 'deal_closed',
				result: 'positive',
				contextLabels: ['deal_type:equity', 'stage:won', 'value_range:100k-500k'],
			}),
		);
		expect(result).toEqual(baseOutcome);
	});

	it('defaults contextLabels to [] when not provided', async () => {
		mockInsertReturning.mockResolvedValueOnce([{ ...baseOutcome, contextLabels: [] }]);

		await createOutcome(WS, { type: 'goal_completed', result: 'positive' });

		expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ contextLabels: [] }));
	});

	it('allows contactId to be omitted (workspace-level outcome)', async () => {
		const workspaceLevelOutcome = { ...baseOutcome, contactId: undefined };
		mockInsertReturning.mockResolvedValueOnce([workspaceLevelOutcome]);

		await createOutcome(WS, { type: 'goal_completed', result: 'positive' });

		expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: WS }));
		// contactId not required — should not throw
	});

	it('throws when insert returns no rows', async () => {
		mockInsertReturning.mockResolvedValueOnce([]);

		await expect(createOutcome(WS, { type: 'deal_closed', result: 'positive' })).rejects.toThrow(
			'createOutcome: insert returned no rows',
		);
	});

	it('includes embedding when provided', async () => {
		const embedding = new Array(512).fill(0.1);
		mockInsertReturning.mockResolvedValueOnce([{ ...baseOutcome, embedding }]);

		await createOutcome(WS, {
			type: 'deal_closed',
			result: 'positive',
			embedding,
		});

		expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ embedding }));
	});

	it('SEC-120: rejects labels without prefix:value format', async () => {
		await expect(
			createOutcome(WS, {
				type: 'deal_closed',
				result: 'positive',
				contextLabels: ['no_colon_here'],
			}),
		).rejects.toThrow('SEC-120: context_label must be "prefix:value" format');
	});

	it('SEC-120: rejects labels with unknown prefix', async () => {
		await expect(
			createOutcome(WS, {
				type: 'deal_closed',
				result: 'positive',
				contextLabels: ['contact_name:John Doe'],
			}),
		).rejects.toThrow('SEC-120: unknown context_label prefix "contact_name"');
	});

	it('SEC-120: accepts all known label prefixes', async () => {
		mockInsertReturning.mockResolvedValueOnce([baseOutcome]);

		await createOutcome(WS, {
			type: 'deal_closed',
			result: 'positive',
			contextLabels: [
				'deal_type:equity',
				'stage:won',
				'value_range:100k',
				'commitment_type:follow_up',
				'assignee:user',
				'confidence:high',
				'goal_type:business',
				'completion:90pct',
				'intro_context:warm',
				'trend:improving',
				'label:thriving',
			],
		});

		expect(mockInsertValues).toHaveBeenCalledTimes(1);
	});
});

// ─── listOutcomes ─────────────────────────────────────────────────────────────

describe('listOutcomes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSelect.mockReturnValue({ from: mockSelectFrom });
		mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
		mockSelectWhere.mockReturnValue({ orderBy: mockSelectOrderBy, groupBy: mockSelectGroupBy });
		mockSelectOrderBy.mockReturnValue({ limit: mockSelectLimit });
		mockSelectLimit.mockResolvedValue([]);
	});

	it('returns outcomes for the workspace ordered by occurredAt desc', async () => {
		mockSelectLimit.mockResolvedValueOnce([baseOutcome]);

		const result = await listOutcomes(WS);

		expect(result).toEqual([baseOutcome]);
		expect(mockSelect).toHaveBeenCalledTimes(1);
		expect(mockSelectOrderBy).toHaveBeenCalledTimes(1);
	});

	it('always filters by workspaceId (workspace isolation)', async () => {
		await listOutcomes(WS);
		await listOutcomes('ws-B');

		expect(mockSelectWhere).toHaveBeenCalledTimes(2);
	});

	it('adds contactId filter when provided', async () => {
		mockSelectLimit.mockResolvedValueOnce([baseOutcome]);

		const result = await listOutcomes(WS, CONTACT);

		expect(result).toEqual([baseOutcome]);
		expect(mockSelectWhere).toHaveBeenCalledTimes(1);
	});

	it('returns empty array when no outcomes exist', async () => {
		const result = await listOutcomes(WS);
		expect(result).toEqual([]);
	});

	it('returns empty array for unknown contactId', async () => {
		const result = await listOutcomes(WS, 'c0000000-0000-0000-0000-000000000099');
		expect(result).toEqual([]);
	});
});

// ─── searchOutcomes ───────────────────────────────────────────────────────────

describe('searchOutcomes', () => {
	const queryEmbedding = new Array(512).fill(0.5);

	beforeEach(() => {
		vi.clearAllMocks();
		mockExecute.mockResolvedValue([]);
		// Two-step pattern: select chain for step 2 (Drizzle ORM fetch)
		mockSelect.mockReturnValue({ from: mockSelectFrom });
		mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
	});

	it('uses two-step pattern: raw SQL IDs then Drizzle ORM full rows', async () => {
		// Step 1: execute returns IDs
		mockExecute.mockResolvedValueOnce([{ id: baseOutcome.id }]);
		// Step 2: select chain returns full rows
		mockSelectWhere.mockResolvedValueOnce([baseOutcome]);

		const result = await searchOutcomes(WS, queryEmbedding);

		expect(mockExecute).toHaveBeenCalledTimes(1);
		expect(mockSelect).toHaveBeenCalledTimes(1);
		expect(result).toEqual([baseOutcome]);
	});

	it('returns empty array when no similar outcomes exist', async () => {
		const result = await searchOutcomes(WS, queryEmbedding);
		expect(result).toEqual([]);
		// Should not call select when execute returns empty
		expect(mockSelect).not.toHaveBeenCalled();
	});

	it('defaults limit to 10', async () => {
		await searchOutcomes(WS, queryEmbedding);
		expect(mockExecute).toHaveBeenCalledTimes(1);
	});

	it('accepts custom limit', async () => {
		await searchOutcomes(WS, queryEmbedding, 5);
		expect(mockExecute).toHaveBeenCalledTimes(1);
	});
});

// ─── getOutcomeStats ──────────────────────────────────────────────────────────

describe('getOutcomeStats', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSelect.mockReturnValue({ from: mockSelectFrom });
		mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
		mockSelectWhere.mockReturnValue({ orderBy: mockSelectOrderBy, groupBy: mockSelectGroupBy });
		mockSelectGroupBy.mockResolvedValue([]);
	});

	it('returns stats grouped by type with computed win rate', async () => {
		mockSelectGroupBy.mockResolvedValueOnce([
			{ type: 'deal_closed', total: 5, positive: 3, negative: 1, neutral: 1 },
		]);

		const result = await getOutcomeStats(WS);

		expect(result).toHaveLength(1);
		const stat = result[0];
		expect(stat?.type).toBe('deal_closed');
		expect(stat?.total).toBe(5);
		expect(stat?.positive).toBe(3);
		expect(stat?.winRate).toBeCloseTo(0.6);
	});

	it('returns winRate=0 when total is 0', async () => {
		mockSelectGroupBy.mockResolvedValueOnce([
			{ type: 'commitment_missed', total: 0, positive: 0, negative: 0, neutral: 0 },
		]);

		const result = await getOutcomeStats(WS);

		expect(result[0]?.winRate).toBe(0);
	});

	it('returns empty array when no outcomes exist', async () => {
		const result = await getOutcomeStats(WS);
		expect(result).toEqual([]);
	});

	it('always filters by workspaceId', async () => {
		await getOutcomeStats(WS);
		expect(mockSelectWhere).toHaveBeenCalledTimes(1);
	});

	it('returns stats for multiple outcome types', async () => {
		mockSelectGroupBy.mockResolvedValueOnce([
			{ type: 'deal_closed', total: 10, positive: 7, negative: 2, neutral: 1 },
			{ type: 'commitment_fulfilled', total: 8, positive: 8, negative: 0, neutral: 0 },
		]);

		const result = await getOutcomeStats(WS);

		expect(result).toHaveLength(2);
		expect(result[0]?.type).toBe('deal_closed');
		expect(result[1]?.type).toBe('commitment_fulfilled');
		expect(result[1]?.winRate).toBe(1.0);
	});
});
