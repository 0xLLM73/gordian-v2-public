import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const mockDbSelect = vi.hoisted(() => vi.fn());
const mockDbExecute = vi.hoisted(() => vi.fn());
const mockGetHealthScoresByWorkspace = vi.hoisted(() => vi.fn());
const mockUpsertHealthScore = vi.hoisted(() => vi.fn());
const mockBroadcastUpdate = vi.hoisted(() => vi.fn());
const mockEnqueueRelationshipEvaluation = vi.hoisted(() => vi.fn());

vi.mock('@repo/db', () => ({
	commitments: { contactId: 'contactId', id: 'id', status: 'status', workspaceId: 'workspaceId' },
	contactRelationships: {
		sourceContactId: 'sourceContactId',
		relationshipType: 'relationshipType',
		workspaceId: 'workspaceId',
	},
	contactTags: { contactId: 'contactId', relationship: 'relationship', workspaceId: 'workspaceId' },
	contacts: { id: 'id', workspaceId: 'workspaceId' },
	messages: {
		contactId: 'contactId',
		id: 'id',
		isOutgoing: 'isOutgoing',
		sentAt: 'sentAt',
		workspaceId: 'workspaceId',
	},
	db: {
		select: mockDbSelect,
		execute: mockDbExecute,
	},
	eq: vi.fn(),
	sql: vi.fn(),
	getHealthScoresByWorkspace: (...args: unknown[]) => mockGetHealthScoresByWorkspace(...args),
	upsertHealthScore: (...args: unknown[]) => mockUpsertHealthScore(...args),
}));

vi.mock('../../realtime/broadcast', () => ({
	broadcastUpdate: (...args: unknown[]) => mockBroadcastUpdate(...args),
}));

vi.mock('../outcome-evaluation', () => ({
	enqueueRelationshipEvaluation: (...args: unknown[]) => mockEnqueueRelationshipEvaluation(...args),
}));

vi.mock('bullmq', () => ({
	Queue: vi.fn().mockImplementation(() => ({
		add: vi.fn(),
		close: vi.fn(),
	})),
	Worker: vi.fn().mockImplementation((_name: string, processor: unknown) => ({
		processor,
		close: vi.fn(),
		on: vi.fn(),
	})),
}));

vi.mock('../../redis', () => ({
	connection: {},
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import {
	computeFrequency,
	computeFulfillment,
	computeLabel,
	computeRecency,
	computeResponseLatency,
	computeTrend,
	getDecayLambda,
	getEffectiveLambda,
	isGhostingTransition,
} from '../health-scoring';

// ─── Pure function tests ─────────────────────────────────────────────────────

describe('computeLabel', () => {
	it('returns thriving for >= 0.75', () => {
		expect(computeLabel(0.75)).toBe('thriving');
		expect(computeLabel(0.9)).toBe('thriving');
	});

	it('returns healthy for >= 0.50', () => {
		expect(computeLabel(0.5)).toBe('healthy');
		expect(computeLabel(0.74)).toBe('healthy');
	});

	it('returns cooling for >= 0.25', () => {
		expect(computeLabel(0.25)).toBe('cooling');
		expect(computeLabel(0.49)).toBe('cooling');
	});

	it('returns dormant for < 0.25', () => {
		expect(computeLabel(0.24)).toBe('dormant');
		expect(computeLabel(0)).toBe('dormant');
	});
});

describe('computeTrend', () => {
	it('returns stable when no previous score', () => {
		expect(computeTrend(0.5, null)).toBe('stable');
	});

	it('returns improving when delta > 0.05', () => {
		expect(computeTrend(0.7, 0.5)).toBe('improving');
	});

	it('returns declining when delta < -0.05', () => {
		expect(computeTrend(0.3, 0.5)).toBe('declining');
	});

	it('returns stable when delta is within threshold', () => {
		expect(computeTrend(0.52, 0.5)).toBe('stable');
	});
});

describe('isGhostingTransition', () => {
	it('returns true when transitioning from thriving to cooling', () => {
		expect(isGhostingTransition('thriving', 'cooling')).toBe(true);
	});

	it('returns true when transitioning from healthy to dormant', () => {
		expect(isGhostingTransition('healthy', 'dormant')).toBe(true);
	});

	it('returns true when transitioning from cooling to dormant', () => {
		expect(isGhostingTransition('cooling', 'dormant')).toBe(true);
	});

	it('returns false when transitioning upward (dormant to cooling)', () => {
		expect(isGhostingTransition('dormant', 'cooling')).toBe(false);
	});

	it('returns false when staying at the same label', () => {
		expect(isGhostingTransition('cooling', 'cooling')).toBe(false);
	});

	it('returns false when transitioning to thriving or healthy', () => {
		expect(isGhostingTransition('cooling', 'thriving')).toBe(false);
		expect(isGhostingTransition('dormant', 'healthy')).toBe(false);
	});

	it('returns false when previous label is null', () => {
		expect(isGhostingTransition(null, 'dormant')).toBe(false);
	});

	it('returns false when previous label is undefined', () => {
		expect(isGhostingTransition(undefined, 'cooling')).toBe(false);
	});
});

// ─── Worker integration tests ────────────────────────────────────────────────

// Capture the processor at import time (before any clearAllMocks)
import { Worker } from 'bullmq';
const workerCalls = (Worker as unknown as ReturnType<typeof vi.fn>).mock.calls;
const hsCall = workerCalls.find((c: unknown[]) => c[0] === 'health-scoring');
const workerProcessor = hsCall?.[1] as (job: { data: { workspaceId: string } }) => Promise<void>;

describe('health-scoring worker', () => {
	const processor = workerProcessor;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	/**
	 * Sets up the db mock chain for the worker.
	 * Worker makes 5 db.select calls: contacts, messageStats, commitmentStats, contactTags, relTypes
	 * Plus 1 db.execute call for latencyStats.
	 */
	function setupDbChain(selectResults: unknown[], executeResult: unknown[] = []) {
		for (const result of selectResults) {
			const groupBy = vi.fn().mockResolvedValue(result);
			const where = vi.fn().mockImplementation(() => {
				const chainResult = Promise.resolve(result);
				(chainResult as unknown as Record<string, unknown>).groupBy = groupBy;
				return chainResult;
			});
			const from = vi.fn().mockReturnValue({ where });
			mockDbSelect.mockReturnValueOnce({ from });
		}
		mockDbExecute.mockResolvedValueOnce(executeResult);
	}

	it('detects transitions and broadcasts ghosting alerts', async () => {
		const wsId = 'ws-001';

		// db.select: contacts, messageStats, commitmentStats, contactTags, relTypes
		// db.execute: latencyStats
		setupDbChain(
			[
				[{ id: 'contact-a' }, { id: 'contact-b' }],
				[], // no messages
				[], // no commitments
				[], // no contactTags
				[], // no relTypes
			],
			[], // no latencyStats
		);

		mockGetHealthScoresByWorkspace.mockResolvedValue([
			{ contactId: 'contact-a', composite: 0.6, label: 'healthy', trend: 'stable' },
			{ contactId: 'contact-b', composite: 0.1, label: 'dormant', trend: 'stable' },
		]);

		mockUpsertHealthScore.mockResolvedValue(undefined);
		mockBroadcastUpdate.mockResolvedValue(undefined);
		mockEnqueueRelationshipEvaluation.mockResolvedValue(undefined);

		await processor({ data: { workspaceId: wsId } });

		expect(mockBroadcastUpdate).toHaveBeenCalledTimes(1);
		expect(mockBroadcastUpdate).toHaveBeenCalledWith(
			wsId,
			'ghosting-alerts',
			expect.objectContaining({
				contacts: expect.arrayContaining([
					expect.objectContaining({
						contactId: 'contact-a',
						previousLabel: 'healthy',
						newLabel: 'cooling', // no messages → composite ~0.31 (cooling tier)
					}),
				]),
				generatedAt: expect.any(String),
			}),
		);

		// contact-b should NOT be in transitions (dormant -> cooling is upward)
		const broadcastPayload = (mockBroadcastUpdate.mock.calls as unknown[][])[0][2] as {
			contacts: Array<{ contactId: string }>;
		};
		const contactIds = broadcastPayload.contacts.map((c) => c.contactId);
		expect(contactIds).not.toContain('contact-b');
	});

	it('does not broadcast when no transitions occur', async () => {
		const wsId = 'ws-002';

		setupDbChain([[{ id: 'contact-c' }], [], [], [], []], []);

		mockGetHealthScoresByWorkspace.mockResolvedValue([]);
		mockUpsertHealthScore.mockResolvedValue(undefined);

		await processor({ data: { workspaceId: wsId } });

		expect(mockBroadcastUpdate).not.toHaveBeenCalled();
	});

	it('does not broadcast for upward transitions', async () => {
		const wsId = 'ws-003';

		setupDbChain(
			[
				[{ id: 'contact-d' }],
				[
					{
						contactId: 'contact-d',
						totalMessages: 100,
						recentMessages: 30,
						lastMessageAt: new Date().toISOString(),
						outgoingCount: 50,
						incomingCount: 50,
					},
				],
				[{ contactId: 'contact-d', totalCommitments: 10, completedCommitments: 9 }],
				[], // contactTags
				[], // relTypes
			],
			[{ contact_id: 'contact-d', median_hours: 2 }],
		);

		mockGetHealthScoresByWorkspace.mockResolvedValue([
			{ contactId: 'contact-d', composite: 0.1, label: 'dormant', trend: 'stable' },
		]);
		mockUpsertHealthScore.mockResolvedValue(undefined);

		await processor({ data: { workspaceId: wsId } });

		expect(mockBroadcastUpdate).not.toHaveBeenCalled();
	});

	it('handles broadcast failure gracefully', async () => {
		const wsId = 'ws-004';

		setupDbChain([[{ id: 'contact-e' }], [], [], [], []], []);

		mockGetHealthScoresByWorkspace.mockResolvedValue([
			{ contactId: 'contact-e', composite: 0.8, label: 'thriving', trend: 'stable' },
		]);
		mockUpsertHealthScore.mockResolvedValue(undefined);
		mockBroadcastUpdate.mockRejectedValue(new Error('network error'));

		await expect(processor({ data: { workspaceId: wsId } })).resolves.toBeUndefined();
	});

	it('uses relationship type from contact_tags for recency lambda (H1)', async () => {
		const wsId = 'ws-h1';

		setupDbChain(
			[
				[{ id: 'contact-investor' }],
				[
					{
						contactId: 'contact-investor',
						totalMessages: 10,
						recentMessages: 2,
						lastMessageAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
						outgoingCount: 5,
						incomingCount: 5,
					},
				],
				[],
				[{ contactId: 'contact-investor', relationship: 'investor' }],
				[], // relTypes
			],
			[],
		);

		mockGetHealthScoresByWorkspace.mockResolvedValue([]);
		mockUpsertHealthScore.mockResolvedValue(undefined);

		await processor({ data: { workspaceId: wsId } });

		// H5 Weibull: lambda_effective = 0.023 / max(1, ln(1+0.1*10))
		const upsertCall = (mockUpsertHealthScore.mock.calls as unknown[][])[0];
		const input = upsertCall[1] as { recency: number };
		const lambdaEffective = 0.023 / Math.max(1, Math.log(1 + 0.1 * 10));
		const expectedRecency = Math.exp(-lambdaEffective * 20);
		expect(input.recency).toBeCloseTo(expectedRecency, 2);
	});

	it('uses batch health scores instead of N+1 queries (H2)', async () => {
		const wsId = 'ws-h2';

		setupDbChain([[{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }], [], [], [], []], []);

		mockGetHealthScoresByWorkspace.mockResolvedValue([
			{ contactId: 'c1', composite: 0.7, label: 'healthy', trend: 'stable' },
			{ contactId: 'c2', composite: 0.3, label: 'cooling', trend: 'declining' },
		]);
		mockUpsertHealthScore.mockResolvedValue(undefined);

		await processor({ data: { workspaceId: wsId } });

		expect(mockGetHealthScoresByWorkspace).toHaveBeenCalledTimes(1);
		expect(mockGetHealthScoresByWorkspace).toHaveBeenCalledWith(wsId, { limit: 100000 });

		const c1Call = (mockUpsertHealthScore.mock.calls as unknown[][]).find(
			(c) => (c[1] as { contactId: string }).contactId === 'c1',
		);
		expect((c1Call?.[1] as { previousComposite: number }).previousComposite).toBe(0.7);

		const c3Call = (mockUpsertHealthScore.mock.calls as unknown[][]).find(
			(c) => (c[1] as { contactId: string }).contactId === 'c3',
		);
		expect((c3Call?.[1] as { previousComposite: number | null }).previousComposite).toBeNull();
	});

	it('stores response latency in responsiveness field (H4)', async () => {
		const wsId = 'ws-h4';

		setupDbChain(
			[
				[{ id: 'contact-g' }],
				[
					{
						contactId: 'contact-g',
						totalMessages: 50,
						recentMessages: 10,
						lastMessageAt: new Date().toISOString(),
						outgoingCount: 25,
						incomingCount: 25,
					},
				],
				[],
				[],
				[],
			],
			[{ contact_id: 'contact-g', median_hours: 2 }],
		);

		mockGetHealthScoresByWorkspace.mockResolvedValue([]);
		mockUpsertHealthScore.mockResolvedValue(undefined);

		await processor({ data: { workspaceId: wsId } });

		const upsertCall = (mockUpsertHealthScore.mock.calls as unknown[][])[0];
		const input = upsertCall[1] as Record<string, unknown>;
		// 2hrs < L50=4hrs → high score
		expect(input.responsiveness).toBeGreaterThan(0.5);
		const compData = input.computationData as Record<string, unknown>;
		expect(compData.medianResponseHours).toBe(2);
	});

	it('includes relationshipType in computationData (H3)', async () => {
		const wsId = 'ws-h3';

		setupDbChain(
			[
				[{ id: 'contact-f' }],
				[
					{
						contactId: 'contact-f',
						totalMessages: 20,
						recentMessages: 4,
						lastMessageAt: new Date().toISOString(),
						outgoingCount: 10,
						incomingCount: 10,
					},
				],
				[],
				[{ contactId: 'contact-f', relationship: 'investor' }],
				[], // relTypes
			],
			[],
		);

		mockGetHealthScoresByWorkspace.mockResolvedValue([]);
		mockUpsertHealthScore.mockResolvedValue(undefined);

		await processor({ data: { workspaceId: wsId } });

		const upsertCall = (mockUpsertHealthScore.mock.calls as unknown[][])[0];
		const input = upsertCall[1] as Record<string, unknown>;
		const compData = input.computationData as Record<string, unknown>;
		expect(compData.relationshipType).toBe('investor');
		expect(compData.medianResponseHours).toBeNull();
	});
});

// ─── Additional pure function tests ──────────────────────────────────────────

describe('computeRecency', () => {
	it('returns 0 for null days', () => {
		expect(computeRecency(null)).toBe(0);
	});

	it('returns 1 for 0 days', () => {
		expect(computeRecency(0)).toBe(1);
	});

	it('decays over time', () => {
		const day1 = computeRecency(1);
		const day30 = computeRecency(30);
		expect(day1).toBeGreaterThan(day30);
	});

	it('uses relationship-specific lambda', () => {
		const days = 30;
		const investorRecency = computeRecency(days, 'investor');
		const defaultRecency = computeRecency(days, null);
		expect(investorRecency).toBeGreaterThan(defaultRecency);
	});

	it('maps contactRelationshipEnum values correctly', () => {
		const days = 14;
		expect(computeRecency(days, 'mentor')).toBeCloseTo(Math.exp(-0.015 * 14), 6);
		expect(computeRecency(days, 'colleague')).toBeCloseTo(Math.exp(-0.05 * 14), 6);
		expect(computeRecency(days, 'prospect')).toBeCloseTo(Math.exp(-0.033 * 14), 6);
		expect(computeRecency(days, 'vendor')).toBeCloseTo(Math.exp(-0.023 * 14), 6);
	});

	it('rounds effectively-zero recency scores to zero for Postgres real storage', () => {
		expect(computeRecency(10000)).toBe(0);
	});
});

describe('computeFrequency', () => {
	it('returns 1 at center for default type', () => {
		expect(computeFrequency(5)).toBeCloseTo(1.0, 2);
	});

	it('returns 1 at center for investor type', () => {
		expect(computeFrequency(1, 'investor')).toBeCloseTo(1.0, 2);
	});

	it('penalizes deviation from center', () => {
		expect(computeFrequency(0)).toBeLessThan(computeFrequency(5));
		expect(computeFrequency(20)).toBeLessThan(computeFrequency(5));
	});

	it('rounds effectively-zero frequency scores to zero for Postgres real storage', () => {
		expect(computeFrequency(500)).toBe(0);
	});

	it('uses default center for unknown type', () => {
		expect(computeFrequency(5, 'unknown')).toBeCloseTo(1.0, 2);
	});

	it('uses default center for null type', () => {
		expect(computeFrequency(5, null)).toBeCloseTo(1.0, 2);
	});
});

describe('computeResponseLatency', () => {
	it('returns 0.5 for null hours', () => {
		expect(computeResponseLatency(null)).toBe(0.5);
	});

	it('returns 0.5 at L50 (4 hours)', () => {
		expect(computeResponseLatency(4)).toBeCloseTo(0.5, 2);
	});

	it('returns high score for fast responses', () => {
		expect(computeResponseLatency(0)).toBeGreaterThan(0.8);
	});

	it('returns low score for slow responses', () => {
		expect(computeResponseLatency(24)).toBeLessThan(0.1);
	});

	it('is monotonically decreasing', () => {
		const h1 = computeResponseLatency(1);
		const h4 = computeResponseLatency(4);
		const h12 = computeResponseLatency(12);
		expect(h1).toBeGreaterThan(h4);
		expect(h4).toBeGreaterThan(h12);
	});

	it('rounds effectively-zero response scores to zero for Postgres real storage', () => {
		expect(computeResponseLatency(250)).toBe(0);
	});
});

describe('getDecayLambda', () => {
	it('returns default for null/undefined', () => {
		expect(getDecayLambda(null)).toBe(0.05);
		expect(getDecayLambda(undefined)).toBe(0.05);
	});

	it('maps contactRelationshipEnum values to correct lambdas', () => {
		expect(getDecayLambda('investor')).toBe(0.023);
		expect(getDecayLambda('client')).toBe(0.033);
		expect(getDecayLambda('partner')).toBe(0.023);
		expect(getDecayLambda('mentor')).toBe(0.015);
		expect(getDecayLambda('mentee')).toBe(0.015);
		expect(getDecayLambda('colleague')).toBe(0.05);
		expect(getDecayLambda('prospect')).toBe(0.033);
		expect(getDecayLambda('vendor')).toBe(0.023);
		expect(getDecayLambda('friend')).toBe(0.05);
		expect(getDecayLambda('family')).toBe(0.05);
		expect(getDecayLambda('other')).toBe(0.05);
	});

	it('returns default for unknown relationship type', () => {
		expect(getDecayLambda('unknown_type')).toBe(0.05);
	});
});

describe('getEffectiveLambda (H5)', () => {
	it('returns lambdaBase when totalMessages is 0', () => {
		expect(getEffectiveLambda(0.05, 0)).toBe(0.05);
	});

	it('reduces lambda for deep relationships', () => {
		const shallow = getEffectiveLambda(0.05, 5);
		const deep = getEffectiveLambda(0.05, 200);
		expect(deep).toBeLessThan(shallow);
	});

	it('computes correct Weibull adjustment', () => {
		const result = getEffectiveLambda(0.05, 100);
		expect(result).toBeCloseTo(0.05 / Math.log(11), 6);
	});
});

describe('computeRecency with Weibull (H5)', () => {
	it('decays slower with more messages', () => {
		const days = 30;
		const fewMessages = computeRecency(days, null, 5);
		const manyMessages = computeRecency(days, null, 200);
		expect(manyMessages).toBeGreaterThan(fewMessages);
	});

	it('matches simple decay when totalMessages=0', () => {
		const days = 14;
		expect(computeRecency(days, null, 0)).toBeCloseTo(Math.exp(-0.05 * 14), 6);
	});
});

describe('computeFulfillment', () => {
	it('returns 0.5 for no commitments', () => {
		expect(computeFulfillment(0, 0)).toBe(0.5);
	});

	it('returns ratio for commitments', () => {
		expect(computeFulfillment(3, 4)).toBe(0.75);
	});
});

describe('H6 — dormancy floor (worker integration)', () => {
	const processor = workerProcessor;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	function setupDbChain(selectResults: unknown[], executeResult: unknown[] = []) {
		for (const result of selectResults) {
			const groupBy = vi.fn().mockResolvedValue(result);
			const where = vi.fn().mockImplementation(() => {
				const chainResult = Promise.resolve(result);
				(chainResult as unknown as Record<string, unknown>).groupBy = groupBy;
				return chainResult;
			});
			const from = vi.fn().mockReturnValue({ where });
			mockDbSelect.mockReturnValueOnce({ from });
		}
		mockDbExecute.mockResolvedValueOnce(executeResult);
	}

	it('applies 0.20 floor when totalMessages >= 50', async () => {
		const wsId = 'ws-h6';

		setupDbChain(
			[
				[{ id: 'deep-contact' }],
				[
					{
						contactId: 'deep-contact',
						totalMessages: 80,
						recentMessages: 0,
						lastMessageAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
						outgoingCount: 40,
						incomingCount: 40,
					},
				],
				[],
				[],
				[],
			],
			[],
		);

		mockGetHealthScoresByWorkspace.mockResolvedValue([]);
		mockUpsertHealthScore.mockResolvedValue(undefined);

		await processor({ data: { workspaceId: wsId } });

		const upsertCall = (mockUpsertHealthScore.mock.calls as unknown[][])[0];
		const input = upsertCall[1] as { composite: number };
		expect(input.composite).toBeGreaterThanOrEqual(0.2);
	});

	it('does not clamp composite when totalMessages < 50', async () => {
		const wsId = 'ws-h6-no-floor';

		// 10 messages — below the 50-message threshold
		setupDbChain([[{ id: 'shallow-contact' }], [], [], [], []], []);

		mockGetHealthScoresByWorkspace.mockResolvedValue([]);
		mockUpsertHealthScore.mockResolvedValue(undefined);

		await processor({ data: { workspaceId: wsId } });

		const upsertCall = (mockUpsertHealthScore.mock.calls as unknown[][])[0];
		const input = upsertCall[1] as { composite: number };
		// With no messages, natural composite is above 0.20 (due to frequency/latency defaults)
		// but NOT clamped — it equals the natural weighted sum, not the floor
		expect(input.composite).not.toBe(0.2);
	});
});
