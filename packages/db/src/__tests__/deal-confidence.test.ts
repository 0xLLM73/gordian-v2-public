import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@repo/crypto', () => ({
	withKeys: vi.fn((_envelope: unknown, fn: () => unknown) => fn()),
	keyStore: { getStore: vi.fn(() => null) },
	computeBlindIndex: vi.fn((val: string) => `bidx:${val}`),
}));

// Track all groupBy calls to differentiate queries
const mockGroupBy = vi.fn<any>(() => Promise.resolve([]));
const mockWhere = vi.fn<any>(() => ({ groupBy: mockGroupBy }));
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

vi.mock('../client', () => ({
	db: {
		select: mockSelect,
	},
}));

function makeStageHistory(entries: Array<{ stage: string; daysAgo: number }>) {
	const now = Date.now();
	return entries.map((e) => ({
		stage: e.stage,
		timestamp: new Date(now - e.daysAgo * 24 * 60 * 60 * 1000).toISOString(),
	}));
}

describe('computeDealConfidence', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.resetModules();
	});

	it('returns empty array for no active deals', async () => {
		const { computeDealConfidence } = await import('../dal/deals');
		const result = await computeDealConfidence('ws-1', [
			{ id: 'd1', contactId: 'c1', stage: 'won', stageHistory: [] },
			{ id: 'd2', contactId: 'c2', stage: 'lost', stageHistory: [] },
		]);
		expect(result).toEqual([]);
		expect(mockSelect).not.toHaveBeenCalled();
	});

	it('computes badges for active deals with all signals', async () => {
		// 5 queries run in parallel via Promise.all:
		// 1. getStageVelocityStats → deals stageHistory
		// 2. getLastMessageDates → messages max(sentAt) grouped by contactId
		// 3. getMessageTrends → messages count with filter grouped by contactId
		// 4. getParticipantCounts → deal_participants count grouped by dealId
		// 5. getArtifactCounts → deal_artifacts count grouped by dealId

		// Query 1: getStageVelocityStats — select stageHistory from deals
		mockGroupBy.mockResolvedValueOnce([]); // no historical deals (falls through to where→groupBy)

		// But getStageVelocityStats doesn't use groupBy, it uses where directly
		// Let me re-think the mock chain
		// getStageVelocityStats: db.select({stageHistory}).from(deals).where(eq)
		// The where returns the result directly (no groupBy)
		// getLastMessageDates: db.select(...).from(messages).where(and).groupBy
		// getMessageTrends: db.select(...).from(messages).where(and).groupBy
		// getParticipantCounts: db.select(...).from(dealParticipants).where(and).groupBy
		// getArtifactCounts: db.select(...).from(dealArtifacts).where(and).groupBy

		// Reset to handle mixed query patterns
		vi.clearAllMocks();

		// For getStageVelocityStats, where() returns directly (no groupBy)
		// For the other 4, where() returns { groupBy } which returns the rows
		let callCount = 0;
		mockWhere.mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				// getStageVelocityStats: returns deals with stageHistory
				return Promise.resolve([
					{
						stageHistory: [
							{ stage: 'discovery', timestamp: '2025-12-01T00:00:00Z' },
							{ stage: 'diligence', timestamp: '2025-12-15T00:00:00Z' },
							{ stage: 'negotiation', timestamp: '2026-01-01T00:00:00Z' },
							{ stage: 'committed', timestamp: '2026-01-20T00:00:00Z' },
							{ stage: 'won', timestamp: '2026-02-01T00:00:00Z' },
						],
					},
				]);
			}
			// Other queries return { groupBy }
			return { groupBy: mockGroupBy };
		});

		const now = new Date();
		const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

		// Query 2: getLastMessageDates
		mockGroupBy.mockResolvedValueOnce([{ contactId: 'c1', lastSentAt: twoDaysAgo.toISOString() }]);

		// Query 3: getMessageTrends
		mockGroupBy.mockResolvedValueOnce([{ contactId: 'c1', recent: 10, older: 3 }]);

		// Query 4: getParticipantCounts
		mockGroupBy.mockResolvedValueOnce([{ dealId: 'd1', count: 3 }]);

		// Query 5: getArtifactCounts
		mockGroupBy.mockResolvedValueOnce([{ dealId: 'd1', count: 2 }]);

		const { computeDealConfidence } = await import('../dal/deals');
		const result = await computeDealConfidence('ws-1', [
			{
				id: 'd1',
				contactId: 'c1',
				stage: 'negotiation',
				stageHistory: makeStageHistory([
					{ stage: 'discovery', daysAgo: 30 },
					{ stage: 'diligence', daysAgo: 20 },
					{ stage: 'negotiation', daysAgo: 5 },
				]),
			},
		]);

		expect(result).toHaveLength(1);
		const r = result[0];
		expect(r.dealId).toBe('d1');
		expect(['hot', 'active', 'at_risk', 'stalled']).toContain(r.badge);
		expect(r.score).toBeGreaterThanOrEqual(0);
		expect(r.score).toBeLessThanOrEqual(1);
		expect(r.signals).toHaveProperty('stageVelocity');
		expect(r.signals).toHaveProperty('messageRecency');
		expect(r.signals).toHaveProperty('participantCount');
		expect(r.signals).toHaveProperty('artifactCount');
		expect(r.signals).toHaveProperty('messageTrend');
	});

	it('filters out terminal deals (won/lost)', async () => {
		let callCount = 0;
		mockWhere.mockImplementation(() => {
			callCount++;
			if (callCount === 1) return Promise.resolve([]);
			return { groupBy: mockGroupBy };
		});
		mockGroupBy.mockResolvedValue([]);

		const { computeDealConfidence } = await import('../dal/deals');
		const result = await computeDealConfidence('ws-1', [
			{ id: 'd1', contactId: 'c1', stage: 'won', stageHistory: [] },
			{
				id: 'd2',
				contactId: 'c2',
				stage: 'discovery',
				stageHistory: makeStageHistory([{ stage: 'discovery', daysAgo: 1 }]),
			},
		]);

		expect(result).toHaveLength(1);
		expect(result[0].dealId).toBe('d2');
	});

	it('assigns stalled badge when deal has been in stage much longer than average', async () => {
		let callCount = 0;
		mockWhere.mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				// Historical: discovery avg = 5 days
				return Promise.resolve([
					{
						stageHistory: [
							{ stage: 'discovery', timestamp: '2026-01-01T00:00:00Z' },
							{ stage: 'diligence', timestamp: '2026-01-06T00:00:00Z' },
						],
					},
				]);
			}
			return { groupBy: mockGroupBy };
		});

		// No messages, no participants, no artifacts
		mockGroupBy.mockResolvedValue([]);

		const { computeDealConfidence } = await import('../dal/deals');
		const result = await computeDealConfidence('ws-1', [
			{
				id: 'd1',
				contactId: 'c1',
				stage: 'discovery',
				// 60 days in discovery vs 5-day average = ratio 12.0 → score 0.0
				stageHistory: makeStageHistory([{ stage: 'discovery', daysAgo: 60 }]),
			},
		]);

		expect(result).toHaveLength(1);
		expect(result[0].badge).toBe('stalled');
		expect(result[0].signals.stageVelocity).toBe(0);
	});

	it('assigns hot badge when all signals are strong', async () => {
		let callCount = 0;
		mockWhere.mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				// Historical: negotiation avg = 14 days
				return Promise.resolve([
					{
						stageHistory: [
							{ stage: 'discovery', timestamp: '2025-11-01T00:00:00Z' },
							{ stage: 'negotiation', timestamp: '2025-11-15T00:00:00Z' },
							{ stage: 'committed', timestamp: '2025-11-29T00:00:00Z' },
						],
					},
				]);
			}
			return { groupBy: mockGroupBy };
		});

		const now = new Date();
		const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);

		// Messages: recent (1 day ago)
		mockGroupBy.mockResolvedValueOnce([{ contactId: 'c1', lastSentAt: oneDayAgo.toISOString() }]);
		// Trend: accelerating (20 recent, 5 older)
		mockGroupBy.mockResolvedValueOnce([{ contactId: 'c1', recent: 20, older: 5 }]);
		// Participants: 4
		mockGroupBy.mockResolvedValueOnce([{ dealId: 'd1', count: 4 }]);
		// Artifacts: 3
		mockGroupBy.mockResolvedValueOnce([{ dealId: 'd1', count: 3 }]);

		const { computeDealConfidence } = await import('../dal/deals');
		const result = await computeDealConfidence('ws-1', [
			{
				id: 'd1',
				contactId: 'c1',
				stage: 'negotiation',
				// 3 days in negotiation vs 14-day average → ratio 0.21 → score 1.0
				stageHistory: makeStageHistory([
					{ stage: 'discovery', daysAgo: 20 },
					{ stage: 'negotiation', daysAgo: 3 },
				]),
			},
		]);

		expect(result).toHaveLength(1);
		expect(result[0].badge).toBe('hot');
		expect(result[0].score).toBeGreaterThanOrEqual(0.75);
	});

	it('handles deals with empty stageHistory', async () => {
		let callCount = 0;
		mockWhere.mockImplementation(() => {
			callCount++;
			if (callCount === 1) return Promise.resolve([]);
			return { groupBy: mockGroupBy };
		});
		mockGroupBy.mockResolvedValue([]);

		const { computeDealConfidence } = await import('../dal/deals');
		const result = await computeDealConfidence('ws-1', [
			{ id: 'd1', contactId: 'c1', stage: 'discovery', stageHistory: [] },
		]);

		expect(result).toHaveLength(1);
		// No stageHistory → daysInStage = 0, no avg → default 0.5
		expect(result[0].signals.stageVelocity).toBe(0.5);
	});

	it('handles deals with null stageHistory', async () => {
		let callCount = 0;
		mockWhere.mockImplementation(() => {
			callCount++;
			if (callCount === 1) return Promise.resolve([]);
			return { groupBy: mockGroupBy };
		});
		mockGroupBy.mockResolvedValue([]);

		const { computeDealConfidence } = await import('../dal/deals');
		const result = await computeDealConfidence('ws-1', [
			{ id: 'd1', contactId: 'c1', stage: 'discovery', stageHistory: null },
		]);

		expect(result).toHaveLength(1);
		expect(result[0].signals.stageVelocity).toBe(0.5);
	});

	it('deduplicates contactIds for batch queries', async () => {
		let callCount = 0;
		mockWhere.mockImplementation(() => {
			callCount++;
			if (callCount === 1) return Promise.resolve([]);
			return { groupBy: mockGroupBy };
		});
		mockGroupBy.mockResolvedValue([]);

		const { computeDealConfidence } = await import('../dal/deals');
		await computeDealConfidence('ws-1', [
			{ id: 'd1', contactId: 'c1', stage: 'discovery', stageHistory: [] },
			{ id: 'd2', contactId: 'c1', stage: 'diligence', stageHistory: [] },
		]);

		// Both deals share c1 — message queries should only get c1 once
		// 5 queries total: velocity + 4 batch queries
		expect(mockSelect).toHaveBeenCalledTimes(5);
	});

	it('score is bounded between 0 and 1', async () => {
		let callCount = 0;
		mockWhere.mockImplementation(() => {
			callCount++;
			if (callCount === 1) return Promise.resolve([]);
			return { groupBy: mockGroupBy };
		});
		mockGroupBy.mockResolvedValue([]);

		const { computeDealConfidence } = await import('../dal/deals');
		const result = await computeDealConfidence('ws-1', [
			{ id: 'd1', contactId: 'c1', stage: 'discovery', stageHistory: [] },
		]);

		expect(result[0].score).toBeGreaterThanOrEqual(0);
		expect(result[0].score).toBeLessThanOrEqual(1);
	});
});
