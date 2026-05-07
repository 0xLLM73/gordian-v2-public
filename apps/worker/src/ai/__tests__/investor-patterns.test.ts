import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockIsFeatureEnabled = vi.hoisted(() => vi.fn());
const mockGetDealsByContact = vi.hoisted(() => vi.fn());
const mockListDealParticipants = vi.hoisted(() => vi.fn());
const mockListKnowledgeByContact = vi.hoisted(() => vi.fn());
const mockUpsertInvestorProfile = vi.hoisted(() => vi.fn());

vi.mock('@repo/db', () => ({
	isFeatureEnabled: mockIsFeatureEnabled,
	getDealsByContact: mockGetDealsByContact,
	listDealParticipants: mockListDealParticipants,
	listKnowledgeByContact: mockListKnowledgeByContact,
	upsertInvestorProfile: mockUpsertInvestorProfile,
}));

import {
	computeActivityTrend,
	computeAvgCycle,
	computeCoInvestors,
	computeInvestorProfile,
	computePreferredRole,
	computeSectorFocus,
	computeTicketRange,
} from '../investor-patterns';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WS = 'ws-00000000-0000-0000-0000-000000000001';
const CONTACT = 'ct-00000000-0000-0000-0000-000000000001';

const fakeEnvelope = {
	encryptedWrk: Buffer.from('fake'),
	kmsContext: {},
	wrkVersion: 1,
};

function daysAgo(n: number): string {
	return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

// ─── computeAvgCycle ──────────────────────────────────────────────────────────

describe('computeAvgCycle', () => {
	it('returns avg days from created to closedAt for won/lost deals', () => {
		const deals = [
			{
				id: 'd1',
				stage: 'won',
				contactId: CONTACT,
				value: 100,
				createdAt: daysAgo(20),
				closedAt: new Date().toISOString(),
				stageHistory: [],
			},
			{
				id: 'd2',
				stage: 'lost',
				contactId: CONTACT,
				value: 200,
				createdAt: daysAgo(40),
				closedAt: daysAgo(0),
				stageHistory: [],
			},
		];

		const avg = computeAvgCycle(deals);
		expect(avg).toBeCloseTo(30, 0); // (20 + 40) / 2
	});

	it('returns null when no closed deals exist', () => {
		const deals = [
			{
				id: 'd1',
				stage: 'discovery',
				contactId: CONTACT,
				value: 100,
				createdAt: daysAgo(10),
				closedAt: null,
				stageHistory: [],
			},
		];
		expect(computeAvgCycle(deals)).toBeNull();
	});

	it('returns null for empty deal list', () => {
		expect(computeAvgCycle([])).toBeNull();
	});
});

// ─── computeTicketRange ───────────────────────────────────────────────────────

describe('computeTicketRange', () => {
	it('returns min/max value of won deals', () => {
		const deals = [
			{
				id: 'd1',
				stage: 'won',
				value: 500,
				contactId: CONTACT,
				createdAt: daysAgo(10),
				stageHistory: [],
			},
			{
				id: 'd2',
				stage: 'won',
				value: 1500,
				contactId: CONTACT,
				createdAt: daysAgo(20),
				stageHistory: [],
			},
			{
				id: 'd3',
				stage: 'lost',
				value: 200,
				contactId: CONTACT,
				createdAt: daysAgo(5),
				stageHistory: [],
			},
		];

		const { min, max } = computeTicketRange(deals);
		expect(min).toBe(500);
		expect(max).toBe(1500);
	});

	it('returns null/null when no won deals', () => {
		const { min, max } = computeTicketRange([
			{
				id: 'd1',
				stage: 'lost',
				value: 1000,
				contactId: CONTACT,
				createdAt: daysAgo(5),
				stageHistory: [],
			},
		]);
		expect(min).toBeNull();
		expect(max).toBeNull();
	});
});

// ─── computeActivityTrend ─────────────────────────────────────────────────────

describe('computeActivityTrend', () => {
	it('returns heating_up when recent count is >= 1.5x older count', () => {
		const deals = [
			// 3 in last 30 days
			{
				id: 'd1',
				stage: 'discovery',
				value: 0,
				contactId: CONTACT,
				createdAt: daysAgo(5),
				stageHistory: [],
			},
			{
				id: 'd2',
				stage: 'discovery',
				value: 0,
				contactId: CONTACT,
				createdAt: daysAgo(10),
				stageHistory: [],
			},
			{
				id: 'd3',
				stage: 'discovery',
				value: 0,
				contactId: CONTACT,
				createdAt: daysAgo(20),
				stageHistory: [],
			},
			// 1 in 30-90 days
			{
				id: 'd4',
				stage: 'won',
				value: 0,
				contactId: CONTACT,
				createdAt: daysAgo(60),
				stageHistory: [],
			},
		];
		expect(computeActivityTrend(deals)).toBe('heating_up');
	});

	it('returns cooling_down when recent count is <= 0.5x older count', () => {
		const deals = [
			// 1 in last 30 days
			{
				id: 'd1',
				stage: 'discovery',
				value: 0,
				contactId: CONTACT,
				createdAt: daysAgo(5),
				stageHistory: [],
			},
			// 4 in 30-90 days
			{
				id: 'd2',
				stage: 'won',
				value: 0,
				contactId: CONTACT,
				createdAt: daysAgo(40),
				stageHistory: [],
			},
			{
				id: 'd3',
				stage: 'won',
				value: 0,
				contactId: CONTACT,
				createdAt: daysAgo(50),
				stageHistory: [],
			},
			{
				id: 'd4',
				stage: 'won',
				value: 0,
				contactId: CONTACT,
				createdAt: daysAgo(60),
				stageHistory: [],
			},
			{
				id: 'd5',
				stage: 'won',
				value: 0,
				contactId: CONTACT,
				createdAt: daysAgo(70),
				stageHistory: [],
			},
		];
		expect(computeActivityTrend(deals)).toBe('cooling_down');
	});

	it('returns steady when no older deals', () => {
		const deals = [
			{
				id: 'd1',
				stage: 'discovery',
				value: 0,
				contactId: CONTACT,
				createdAt: daysAgo(5),
				stageHistory: [],
			},
		];
		expect(computeActivityTrend(deals)).toBe('steady');
	});
});

// ─── computePreferredRole ─────────────────────────────────────────────────────

describe('computePreferredRole', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns the most frequent participant role', async () => {
		const deals = [
			{
				id: 'd1',
				stage: 'won',
				contactId: CONTACT,
				value: 0,
				createdAt: daysAgo(5),
				stageHistory: [],
			},
			{
				id: 'd2',
				stage: 'won',
				contactId: CONTACT,
				value: 0,
				createdAt: daysAgo(10),
				stageHistory: [],
			},
		];
		mockListDealParticipants
			.mockResolvedValueOnce([{ role: 'co_investor', contactId: CONTACT }])
			.mockResolvedValueOnce([{ role: 'co_investor', contactId: CONTACT }]);

		const role = await computePreferredRole(WS, deals, fakeEnvelope);
		expect(role).toBe('co_investor');
	});

	it('returns null when no participant records', async () => {
		mockListDealParticipants.mockResolvedValue([]);
		const role = await computePreferredRole(
			WS,
			[
				{
					id: 'd1',
					stage: 'won',
					contactId: CONTACT,
					value: 0,
					createdAt: daysAgo(5),
					stageHistory: [],
				},
			],
			fakeEnvelope,
		);
		expect(role).toBeNull();
	});
});

// ─── computeSectorFocus ───────────────────────────────────────────────────────

describe('computeSectorFocus', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns deduplicated sector/topic labels from knowledge nodes', async () => {
		mockListKnowledgeByContact.mockResolvedValue([
			{ type: 'sector', name: 'DeFi' },
			{ type: 'topic', name: 'Ethereum L2' },
			{ type: 'topic', name: 'DeFi' }, // duplicate
			{ type: 'organization', name: 'Uniswap' }, // filtered out
		]);

		const labels = await computeSectorFocus(WS, CONTACT, fakeEnvelope);
		expect(labels).toContain('defi');
		expect(labels).toContain('ethereum l2');
		expect(labels).not.toContain('uniswap');
		expect(new Set(labels).size).toBe(labels.length); // deduplicated
	});

	it('returns empty array on error', async () => {
		mockListKnowledgeByContact.mockRejectedValue(new Error('DB error'));
		const labels = await computeSectorFocus(WS, CONTACT, fakeEnvelope);
		expect(labels).toEqual([]);
	});
});

// ─── computeCoInvestors ───────────────────────────────────────────────────────

describe('computeCoInvestors', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns contact IDs who co-invest in 2+ deals', async () => {
		const deals = [
			{
				id: 'd1',
				stage: 'won',
				contactId: CONTACT,
				value: 0,
				createdAt: daysAgo(5),
				stageHistory: [],
			},
			{
				id: 'd2',
				stage: 'won',
				contactId: CONTACT,
				value: 0,
				createdAt: daysAgo(10),
				stageHistory: [],
			},
		];
		const coId = 'co-investor-contact-id';
		mockListDealParticipants
			.mockResolvedValueOnce([{ contactId: coId, role: 'co_investor' }])
			.mockResolvedValueOnce([{ contactId: coId, role: 'co_investor' }]);

		const coInvestors = await computeCoInvestors(WS, CONTACT, deals, fakeEnvelope);
		expect(coInvestors).toContain(coId);
	});

	it('excludes contacts appearing in only 1 deal', async () => {
		const deals = [
			{
				id: 'd1',
				stage: 'won',
				contactId: CONTACT,
				value: 0,
				createdAt: daysAgo(5),
				stageHistory: [],
			},
			{
				id: 'd2',
				stage: 'won',
				contactId: CONTACT,
				value: 0,
				createdAt: daysAgo(10),
				stageHistory: [],
			},
		];
		mockListDealParticipants
			.mockResolvedValueOnce([{ contactId: 'co-1', role: 'co_investor' }])
			.mockResolvedValueOnce([{ contactId: 'co-2', role: 'co_investor' }]); // different contact

		const coInvestors = await computeCoInvestors(WS, CONTACT, deals, fakeEnvelope);
		expect(coInvestors).toHaveLength(0);
	});
});

// ─── computeInvestorProfile ───────────────────────────────────────────────────

describe('computeInvestorProfile', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUpsertInvestorProfile.mockResolvedValue({});
		mockListDealParticipants.mockResolvedValue([]);
		mockListKnowledgeByContact.mockResolvedValue([]);
	});

	it('returns early when feature flag is off', async () => {
		mockIsFeatureEnabled.mockResolvedValue(false);

		await computeInvestorProfile(WS, CONTACT, fakeEnvelope);

		expect(mockGetDealsByContact).not.toHaveBeenCalled();
		expect(mockUpsertInvestorProfile).not.toHaveBeenCalled();
	});

	it('returns early when deal fetch fails', async () => {
		mockIsFeatureEnabled.mockResolvedValue(true);
		mockGetDealsByContact.mockRejectedValue(new Error('DB error'));

		await computeInvestorProfile(WS, CONTACT, fakeEnvelope);

		expect(mockUpsertInvestorProfile).not.toHaveBeenCalled();
	});

	it('upserts investor profile with correct data', async () => {
		mockIsFeatureEnabled.mockResolvedValue(true);
		mockGetDealsByContact.mockResolvedValue([
			{
				id: 'd1',
				stage: 'won',
				value: 500,
				contactId: CONTACT,
				createdAt: daysAgo(30),
				closedAt: daysAgo(0),
				stageHistory: [],
			},
		]);
		mockListKnowledgeByContact.mockResolvedValue([{ type: 'sector', name: 'DeFi' }]);

		await computeInvestorProfile(WS, CONTACT, fakeEnvelope);

		expect(mockUpsertInvestorProfile).toHaveBeenCalledWith(
			WS,
			CONTACT,
			expect.objectContaining({
				dealCount: 1,
				winRate: 1,
				activityTrend: expect.any(String),
				sectorFocus: expect.arrayContaining(['defi']),
			}),
		);
	});
});
