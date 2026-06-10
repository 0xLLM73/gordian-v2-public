import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const mockDbSelect = vi.hoisted(() => vi.fn());
const mockDbExecute = vi.hoisted(() => vi.fn());
const mockAnalyzeRelationshipHealthLocal = vi.hoisted(() => vi.fn());
const mockCanRunLocalRelationshipHealthAnalysis = vi.hoisted(() => vi.fn());
const mockGetActiveContactHealthFeedback = vi.hoisted(() => vi.fn());
const mockGetHealthScoresByWorkspace = vi.hoisted(() => vi.fn());
const mockGetMessagesByContact = vi.hoisted(() => vi.fn());
const mockHasWorkspaceAiAnalysisConsent = vi.hoisted(() => vi.fn());
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
	contactTags: {
		contactId: 'contactId',
		priority: 'priority',
		relationship: 'relationship',
		workspaceId: 'workspaceId',
	},
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
	getActiveContactHealthFeedback: (...args: unknown[]) =>
		mockGetActiveContactHealthFeedback(...args),
	getHealthScoresByWorkspace: (...args: unknown[]) => mockGetHealthScoresByWorkspace(...args),
	getMessagesByContact: (...args: unknown[]) => mockGetMessagesByContact(...args),
	hasWorkspaceAiAnalysisConsent: (...args: unknown[]) => mockHasWorkspaceAiAnalysisConsent(...args),
	upsertHealthScore: (...args: unknown[]) => mockUpsertHealthScore(...args),
}));

vi.mock('../../ai/relationship-health', () => ({
	analyzeRelationshipHealthLocal: (...args: unknown[]) =>
		mockAnalyzeRelationshipHealthLocal(...args),
	canRunLocalRelationshipHealthAnalysis: (...args: unknown[]) =>
		mockCanRunLocalRelationshipHealthAnalysis(...args),
}));

vi.mock('../../realtime/broadcast', () => ({
	broadcastUpdate: (...args: unknown[]) => mockBroadcastUpdate(...args),
}));

vi.mock('../outcome-evaluation', () => ({
	enqueueRelationshipEvaluation: (...args: unknown[]) => mockEnqueueRelationshipEvaluation(...args),
}));

vi.mock('bullmq', () => ({
	// biome-ignore lint/complexity/useArrowFunction: Vitest 4 class mocks must be constructible.
	Queue: vi.fn().mockImplementation(function () {
		return {
			add: vi.fn(),
			close: vi.fn(),
		};
	}),
	// biome-ignore lint/complexity/useArrowFunction: Vitest 4 class mocks must be constructible.
	Worker: vi.fn().mockImplementation(function (_name: string, processor: unknown) {
		return {
			processor,
			close: vi.fn(),
			on: vi.fn(),
		};
	}),
}));

vi.mock('../../redis', () => ({
	connection: {},
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import {
	buildHealthScoringInsight,
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

describe('buildHealthScoringInsight', () => {
	const baseInput = {
		baseLabel: 'cooling',
		cadence: {
			baselineSessions: 14,
			historyDays: 210,
			lastInteractionAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
			medianGapDays: 8,
			p75GapDays: 12,
			p90GapDays: 20,
			recentSessions: 0,
			sessionCount: 16,
		},
		composite: 0.42,
		daysSinceLast: 45,
		incoming: 6,
		lastIsOutgoing: true,
		medianResponseHours: null,
		outgoing: 6,
		priority: 'medium' as const,
		recentMessages: 0,
		relationshipType: null,
		totalMessages: 12,
	};

	it('flags a relationship gap longer than the learned cadence', () => {
		const insight = buildHealthScoringInsight(baseInput);

		expect(insight.version).toBe(2);
		expect(insight.statusReason.code).toBe('gap_longer_than_usual');
		expect(insight.statusReason.privacyLevel).toBe('aggregate_only');
		expect(insight.cadence.sessionCount).toBe(16);
		expect(insight.confidence.label).toBe('high');
		expect(insight.statusReason.plainLanguage).toContain('No meaningful 1:1');
	});

	it('separates steady low-touch contacts from real cooling risk', () => {
		const insight = buildHealthScoringInsight({
			...baseInput,
			baseLabel: 'cooling',
			cadence: {
				...baseInput.cadence,
				medianGapDays: 60,
				p75GapDays: 75,
				p90GapDays: 100,
			},
			daysSinceLast: 80,
			relationshipType: 'investor',
		});

		expect(insight.statusReason.code).toBe('steady_low_touch');
		expect(insight.statusReason.suggestedAction).toBe('none');
		expect(insight.attention.actionability).toBeLessThan(0.1);
	});

	it('prioritizes cases where the user owes a reply', () => {
		const insight = buildHealthScoringInsight({
			...baseInput,
			daysSinceLast: 6,
			lastIsOutgoing: false,
			priority: 'high',
		});

		expect(insight.statusReason.code).toBe('needs_reply');
		expect(insight.statusReason.directionality).toBe('user_owes');
		expect(insight.statusReason.suggestedAction).toBe('open_chat');
		expect(insight.attention.priorityWeight).toBe(1.25);
	});

	it('does not treat ancient sparse inbound history as a pending reply', () => {
		const insight = buildHealthScoringInsight({
			...baseInput,
			cadence: {
				...baseInput.cadence,
				historyDays: 1,
				sessionCount: 1,
			},
			daysSinceLast: 355,
			incoming: 1,
			lastIsOutgoing: false,
			outgoing: 0,
			totalMessages: 1,
		});

		expect(insight.statusReason.code).toBe('learning');
		expect(insight.statusReason.suggestedAction).toBe('set_cadence');
		expect(insight.confidence.label).toBe('low');
	});

	it('treats old established-cadence silence as a cadence gap, not a pending reply', () => {
		const insight = buildHealthScoringInsight({
			...baseInput,
			daysSinceLast: 90,
			incoming: 10,
			lastIsOutgoing: false,
			outgoing: 8,
			totalMessages: 18,
		});

		expect(insight.statusReason.code).toBe('gap_longer_than_usual');
		expect(insight.statusReason.suggestedAction).toBe('send_light_checkin');
	});

	it('marks sparse histories as learning instead of overclaiming risk', () => {
		const insight = buildHealthScoringInsight({
			...baseInput,
			cadence: {
				...baseInput.cadence,
				historyDays: 7,
				sessionCount: 2,
			},
			daysSinceLast: 10,
			totalMessages: 3,
		});

		expect(insight.statusReason.code).toBe('learning');
		expect(insight.confidence.label).toBe('low');
		expect(insight.sourceCoverage.sparse).toBe(true);
	});
});

// ─── Worker integration tests ────────────────────────────────────────────────

// Capture the processor at import time (before any clearAllMocks)
import { Worker } from 'bullmq';
const workerCalls = (Worker as unknown as ReturnType<typeof vi.fn>).mock.calls;
const hsCall = workerCalls.find((c: unknown[]) => c[0] === 'health-scoring');
const workerProcessor = hsCall?.[1] as (job: {
	data: {
		keyEnvelope?: {
			encryptedWrk: string;
			kmsContext: Record<string, string>;
			wrkVersion: number;
		};
		workspaceId: string;
	};
}) => Promise<void>;

describe('health-scoring worker', () => {
	const processor = workerProcessor;

	beforeEach(() => {
		vi.clearAllMocks();
		mockAnalyzeRelationshipHealthLocal.mockResolvedValue(undefined);
		mockCanRunLocalRelationshipHealthAnalysis.mockReturnValue(false);
		mockGetActiveContactHealthFeedback.mockResolvedValue([]);
		mockGetMessagesByContact.mockResolvedValue([]);
		mockHasWorkspaceAiAnalysisConsent.mockResolvedValue(false);
	});

	/**
	 * Sets up the db mock chain for the worker.
	 * Worker makes 5 db.select calls: contacts, messageStats, commitmentStats, contactTags, relTypes.
	 * It also makes 2 db.execute calls: latencyStats and cadenceStats.
	 */
	function setupDbChain(selectResults: unknown[], executeResults: unknown[] | unknown[][] = []) {
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
		const maybeRows = executeResults as unknown[];
		const normalized = Array.isArray(maybeRows[0])
			? (executeResults as unknown[][])
			: [executeResults as unknown[]];
		mockDbExecute.mockResolvedValueOnce(normalized[0] ?? []);
		mockDbExecute.mockResolvedValueOnce(normalized[1] ?? []);
	}

	it('detects transitions and broadcasts ghosting alerts', async () => {
		const wsId = 'ws-001';

		// db.select: contacts, messageStats, commitmentStats, contactTags, relTypes
		// db.execute: latencyStats, cadenceStats
		setupDbChain(
			[
				[{ id: 'contact-a' }, { id: 'contact-b' }],
				[
					{
						contactId: 'contact-a',
						totalMessages: 12,
						recentMessages: 0,
						lastMessageAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
						lastIsOutgoing: true,
						outgoingCount: 6,
						incomingCount: 6,
					},
				],
				[], // no commitments
				[], // no contactTags
				[], // no relTypes
			],
			[
				[], // no latencyStats
				[
					{
						contact_id: 'contact-a',
						session_count: 8,
						history_days: 120,
						last_interaction_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
						recent_sessions: 0,
						baseline_sessions: 8,
						median_gap_days: 8,
						p75_gap_days: 12,
						p90_gap_days: 20,
					},
				],
			],
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
						newLabel: 'cooling',
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

	it('stores aggregate reason and cadence data without raw message text', async () => {
		const wsId = 'ws-reasons';

		setupDbChain(
			[
				[{ id: 'contact-reason' }],
				[
					{
						contactId: 'contact-reason',
						totalMessages: 12,
						recentMessages: 0,
						lastMessageAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
						lastIsOutgoing: true,
						outgoingCount: 6,
						incomingCount: 6,
					},
				],
				[],
				[{ contactId: 'contact-reason', priority: 'high', relationship: 'colleague' }],
				[],
			],
			[
				[],
				[
					{
						contact_id: 'contact-reason',
						session_count: 8,
						history_days: 120,
						last_interaction_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
						recent_sessions: 0,
						baseline_sessions: 8,
						median_gap_days: 8,
						p75_gap_days: 12,
						p90_gap_days: 20,
					},
				],
			],
		);

		mockGetHealthScoresByWorkspace.mockResolvedValue([]);
		mockUpsertHealthScore.mockResolvedValue(undefined);

		await processor({ data: { workspaceId: wsId } });

		const upsertCall = (mockUpsertHealthScore.mock.calls as unknown[][])[0];
		const input = upsertCall[1] as Record<string, unknown>;
		const compData = input.computationData as Record<string, unknown>;
		const statusReason = compData.statusReason as Record<string, unknown>;
		const cadence = compData.cadence as Record<string, unknown>;
		const attention = compData.attention as Record<string, unknown>;

		expect(compData.version).toBe(2);
		expect(statusReason.code).toBe('gap_longer_than_usual');
		expect(statusReason.privacyLevel).toBe('aggregate_only');
		expect(cadence.sessionCount).toBe(8);
		expect(attention.priorityWeight).toBe(1.25);
		expect(compData).not.toHaveProperty('text');
		expect(compData).not.toHaveProperty('messageText');
	});

	it('applies active low-touch feedback during health recompute', async () => {
		const wsId = 'ws-feedback';
		const createdAt = new Date();

		setupDbChain(
			[
				[{ id: 'contact-feedback' }],
				[
					{
						contactId: 'contact-feedback',
						totalMessages: 12,
						recentMessages: 0,
						lastMessageAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
						lastIsOutgoing: true,
						outgoingCount: 6,
						incomingCount: 6,
					},
				],
				[],
				[],
				[],
			],
			[
				[],
				[
					{
						contact_id: 'contact-feedback',
						session_count: 8,
						history_days: 120,
						last_interaction_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
						recent_sessions: 0,
						baseline_sessions: 8,
						median_gap_days: 8,
						p75_gap_days: 12,
						p90_gap_days: 20,
					},
				],
			],
		);

		mockGetHealthScoresByWorkspace.mockResolvedValue([]);
		mockGetActiveContactHealthFeedback.mockResolvedValue([
			{
				id: 'feedback-1',
				workspaceId: wsId,
				contactId: 'contact-feedback',
				userId: 'user-1',
				action: 'mark_low_touch',
				reason: 'normal_low_touch',
				statusReasonCode: 'gap_longer_than_usual',
				snoozedUntil: null,
				metadata: {},
				createdAt,
				updatedAt: createdAt,
			},
		]);
		mockUpsertHealthScore.mockResolvedValue(undefined);

		await processor({ data: { workspaceId: wsId } });

		expect(mockGetActiveContactHealthFeedback).toHaveBeenCalledWith(wsId, ['contact-feedback']);
		const upsertCall = (mockUpsertHealthScore.mock.calls as unknown[][])[0];
		const input = upsertCall[1] as Record<string, unknown>;
		const compData = input.computationData as Record<string, unknown>;
		const statusReason = compData.statusReason as Record<string, unknown>;
		const attention = compData.attention as Record<string, unknown>;
		const feedback = compData.feedback as Record<string, unknown>;

		expect(input.label).toBe('steady_low_touch');
		expect(statusReason.code).toBe('steady_low_touch');
		expect(attention.score).toBe(0);
		expect(feedback.action).toBe('mark_low_touch');
		expect(feedback.reason).toBe('normal_low_touch');
	});

	it('skips local relationship classifiers when no key envelope is present', async () => {
		const wsId = 'ws-no-key';

		setupDbChain(
			[
				[{ id: 'contact-no-key' }],
				[
					{
						contactId: 'contact-no-key',
						totalMessages: 12,
						recentMessages: 0,
						lastMessageAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
						lastIsOutgoing: true,
						outgoingCount: 6,
						incomingCount: 6,
					},
				],
				[],
				[],
				[],
			],
			[
				[],
				[
					{
						contact_id: 'contact-no-key',
						session_count: 8,
						history_days: 120,
						last_interaction_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
						recent_sessions: 0,
						baseline_sessions: 8,
						median_gap_days: 8,
						p75_gap_days: 12,
						p90_gap_days: 20,
					},
				],
			],
		);

		mockCanRunLocalRelationshipHealthAnalysis.mockReturnValue(true);
		mockHasWorkspaceAiAnalysisConsent.mockResolvedValue(true);
		mockGetHealthScoresByWorkspace.mockResolvedValue([]);
		mockUpsertHealthScore.mockResolvedValue(undefined);

		await processor({ data: { workspaceId: wsId } });

		expect(mockHasWorkspaceAiAnalysisConsent).not.toHaveBeenCalled();
		expect(mockGetMessagesByContact).not.toHaveBeenCalled();
		expect(mockAnalyzeRelationshipHealthLocal).not.toHaveBeenCalled();
	});

	it('stores bounded local AI signals when consent and key envelope are present', async () => {
		const wsId = 'ws-local-ai';
		const keyEnvelope = {
			encryptedWrk: Buffer.from('encrypted-wrk').toString('base64'),
			kmsContext: { workspaceId: wsId },
			wrkVersion: 1,
		};

		setupDbChain(
			[
				[{ id: 'contact-ai' }],
				[
					{
						contactId: 'contact-ai',
						totalMessages: 18,
						recentMessages: 0,
						lastMessageAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
						lastIsOutgoing: false,
						outgoingCount: 8,
						incomingCount: 10,
					},
				],
				[],
				[{ contactId: 'contact-ai', priority: 'high', relationship: 'colleague' }],
				[],
			],
			[
				[],
				[
					{
						contact_id: 'contact-ai',
						session_count: 10,
						history_days: 140,
						last_interaction_at: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
						recent_sessions: 0,
						baseline_sessions: 10,
						median_gap_days: 6,
						p75_gap_days: 8,
						p90_gap_days: 10,
					},
				],
			],
		);

		mockCanRunLocalRelationshipHealthAnalysis.mockReturnValue(true);
		mockHasWorkspaceAiAnalysisConsent.mockResolvedValue(true);
		mockGetHealthScoresByWorkspace.mockResolvedValue([]);
		mockGetMessagesByContact.mockResolvedValue([
			{
				id: 'm1',
				text: 'Can you send the deck?',
				isOutgoing: false,
				sentAt: new Date(),
			},
		]);
		mockAnalyzeRelationshipHealthLocal.mockResolvedValue({
			version: 1,
			meaningfulExchange: { label: 'meaningful', confidence: 0.86 },
			directAsk: { detected: true, userOwesReply: true, confidence: 0.92 },
			topicLabels: ['work', 'planning'],
			draftCheckIn: { available: true, reviewRequired: true, autoSend: false },
			runtime: { mode: 'local', model: 'qwen3:4b-instruct', source: 'commitment-fallback' },
		});
		mockUpsertHealthScore.mockResolvedValue(undefined);

		await processor({ data: { workspaceId: wsId, keyEnvelope } });

		expect(mockHasWorkspaceAiAnalysisConsent).toHaveBeenCalledWith(wsId);
		expect(mockGetMessagesByContact).toHaveBeenCalledWith(
			wsId,
			'contact-ai',
			expect.objectContaining({
				encryptedWrk: expect.any(Buffer),
				kmsContext: { workspaceId: wsId },
				wrkVersion: 1,
			}),
			{ limit: 12 },
		);
		expect(mockAnalyzeRelationshipHealthLocal).toHaveBeenCalledWith([
			expect.objectContaining({
				content: 'Can you send the deck?',
				isOutgoing: false,
			}),
		]);

		const upsertCall = (mockUpsertHealthScore.mock.calls as unknown[][])[0];
		const input = upsertCall[1] as Record<string, unknown>;
		const compData = input.computationData as Record<string, unknown>;
		const statusReason = compData.statusReason as Record<string, unknown>;
		const aiSignals = compData.aiSignals as Record<string, unknown>;

		expect(statusReason.code).toBe('needs_reply');
		expect(statusReason.privacyLevel).toBe('aggregate_only');
		expect(aiSignals).toEqual(
			expect.objectContaining({
				version: 1,
				topicLabels: ['work', 'planning'],
				draftCheckIn: { available: true, reviewRequired: true, autoSend: false },
			}),
		);
		expect(JSON.stringify(compData)).not.toContain('Can you send the deck?');
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
		mockAnalyzeRelationshipHealthLocal.mockResolvedValue(undefined);
		mockCanRunLocalRelationshipHealthAnalysis.mockReturnValue(false);
		mockGetActiveContactHealthFeedback.mockResolvedValue([]);
		mockGetMessagesByContact.mockResolvedValue([]);
		mockHasWorkspaceAiAnalysisConsent.mockResolvedValue(false);
	});

	function setupDbChain(selectResults: unknown[], executeResults: unknown[] | unknown[][] = []) {
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
		const maybeRows = executeResults as unknown[];
		const normalized = Array.isArray(maybeRows[0])
			? (executeResults as unknown[][])
			: [executeResults as unknown[]];
		mockDbExecute.mockResolvedValueOnce(normalized[0] ?? []);
		mockDbExecute.mockResolvedValueOnce(normalized[1] ?? []);
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
