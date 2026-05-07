import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockInsert = vi.hoisted(() => vi.fn());
const mockSelect = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
const mockWithKeys = vi.hoisted(() => vi.fn());

const mockValues = vi.hoisted(() => vi.fn());
const mockReturning = vi.hoisted(() => vi.fn());
const mockWhere = vi.hoisted(() => vi.fn());
const mockOrderBy = vi.hoisted(() => vi.fn());
const mockLimit = vi.hoisted(() => vi.fn<any>());
const mockOffset = vi.hoisted(() => vi.fn());
const mockSet = vi.hoisted(() => vi.fn());
const mockFrom = vi.hoisted(() => vi.fn());

vi.mock('../client', () => ({
	db: {
		insert: mockInsert,
		select: mockSelect,
		update: mockUpdate,
	},
}));

vi.mock('@repo/crypto', () => ({
	withKeys: mockWithKeys,
}));

vi.mock('../schema/deal-candidates', () => ({
	dealCandidates: {
		id: 'id',
		workspaceId: 'workspace_id',
		sourceMessageId: 'source_message_id',
		chatId: 'chat_id',
		confidence: 'confidence',
		contactId: 'contact_id',
		dealTitleGuess: 'deal_title_guess',
		dealTypeGuess: 'deal_type_guess',
		signals: 'signals',
		status: 'status',
		dismissedAt: 'dismissed_at',
		confirmedDealId: 'confirmed_deal_id',
		createdAt: 'created_at',
	},
}));

import {
	confirmCandidate,
	createDealCandidate,
	dismissCandidate,
	isDuplicateCandidate,
	listPendingCandidates,
} from '../dal/deal-candidates';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WS = 'ws-00000000-0000-0000-0000-000000000001';
const fakeEnvelope = { encryptedWrk: Buffer.from('fake'), kmsContext: {}, wrkVersion: 1 };

const fakeCandidate = {
	id: 'dc-1',
	workspaceId: WS,
	sourceMessageId: 'msg-1',
	chatId: 'chat-1',
	confidence: 0.9,
	contactId: 'c-1',
	dealTitleGuess: 'Series A',
	dealTypeGuess: 'investment',
	signals: [{ text: 'raising a round', tier: 1 }],
	status: 'pending',
	dismissedAt: null,
	confirmedDealId: null,
	createdAt: new Date(),
};

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();

	// withKeys executes the callback
	mockWithKeys.mockImplementation((_env: unknown, fn: () => unknown) => fn());

	// Default chain: insert().values().returning()
	mockReturning.mockResolvedValue([fakeCandidate]);
	mockValues.mockReturnValue({ returning: mockReturning });
	mockInsert.mockReturnValue({ values: mockValues });

	// Default chain: select().from().where().orderBy().limit().offset()
	mockOffset.mockResolvedValue([fakeCandidate]);
	mockLimit.mockReturnValue({ offset: mockOffset });
	mockOrderBy.mockReturnValue({ limit: mockLimit });
	mockWhere.mockReturnValue({ orderBy: mockOrderBy, limit: mockLimit });
	mockFrom.mockReturnValue({ where: mockWhere });
	mockSelect.mockReturnValue({ from: mockFrom });

	// Default chain: update().set().where().returning()
	mockSet.mockReturnValue({ where: vi.fn().mockReturnValue({ returning: mockReturning }) });
	mockUpdate.mockReturnValue({ set: mockSet });
});

// ─── createDealCandidate ──────────────────────────────────────────────────────

describe('createDealCandidate', () => {
	it('inserts with workspace_id and returns the row', async () => {
		const result = await createDealCandidate(
			WS,
			{
				sourceMessageId: 'msg-1',
				chatId: 'chat-1',
				confidence: 0.9,
				contactId: 'c-1',
				dealTitleGuess: 'Series A',
				dealTypeGuess: 'investment',
				signals: [{ text: 'raising a round', tier: 1 }],
			},
			fakeEnvelope,
		);

		expect(result).toEqual(fakeCandidate);
		expect(mockWithKeys).toHaveBeenCalledWith(fakeEnvelope, expect.any(Function));
		expect(mockInsert).toHaveBeenCalled();
	});

	it('throws when insert returns no rows', async () => {
		mockReturning.mockResolvedValue([]);

		await expect(
			createDealCandidate(
				WS,
				{
					sourceMessageId: 'msg-1',
					chatId: 'chat-1',
					confidence: 0.5,
					dealTitleGuess: 'Test',
					dealTypeGuess: 'other',
					signals: [],
				},
				fakeEnvelope,
			),
		).rejects.toThrow('insert returned no rows');
	});
});

// ─── listPendingCandidates ────────────────────────────────────────────────────

describe('listPendingCandidates', () => {
	it('returns pending candidates ordered by confidence desc', async () => {
		const result = await listPendingCandidates(WS, fakeEnvelope);

		expect(result).toEqual([fakeCandidate]);
		expect(mockWithKeys).toHaveBeenCalledWith(fakeEnvelope, expect.any(Function));
	});

	it('passes limit and offset options', async () => {
		await listPendingCandidates(WS, fakeEnvelope, { limit: 10, offset: 5 });

		expect(mockLimit).toHaveBeenCalledWith(10);
		expect(mockOffset).toHaveBeenCalledWith(5);
	});
});

// ─── confirmCandidate ─────────────────────────────────────────────────────────

describe('confirmCandidate', () => {
	it('sets status to confirmed and links the deal', async () => {
		const result = await confirmCandidate(WS, 'dc-1', 'deal-1');

		expect(result).toEqual(fakeCandidate);
		expect(mockUpdate).toHaveBeenCalled();
		expect(mockSet).toHaveBeenCalledWith({ status: 'confirmed', confirmedDealId: 'deal-1' });
	});

	it('returns null when candidate not found', async () => {
		mockSet.mockReturnValue({
			where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
		});

		const result = await confirmCandidate(WS, 'nonexistent', 'deal-1');
		expect(result).toBeNull();
	});
});

// ─── dismissCandidate ─────────────────────────────────────────────────────────

describe('dismissCandidate', () => {
	it('sets status to dismissed with timestamp', async () => {
		const result = await dismissCandidate(WS, 'dc-1');

		expect(result).toEqual(fakeCandidate);
		expect(mockUpdate).toHaveBeenCalled();
	});

	it('returns null when candidate not found', async () => {
		mockSet.mockReturnValue({
			where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
		});

		const result = await dismissCandidate(WS, 'nonexistent');
		expect(result).toBeNull();
	});
});

// ─── isDuplicateCandidate ─────────────────────────────────────────────────────

describe('isDuplicateCandidate', () => {
	it('returns true when existing candidate has overlapping signal text', async () => {
		// isDuplicateCandidate chain: select().from().where() — no orderBy/limit
		mockWhere.mockResolvedValueOnce([
			{ id: 'dc-old', signals: [{ text: 'raising a round', tier: 1 }] },
		]);

		const result = await isDuplicateCandidate(WS, 'c-1', [{ text: 'raising a round', tier: 1 }]);
		expect(result).toBe(true);
	});

	it('returns false when no overlapping signals', async () => {
		mockWhere.mockResolvedValueOnce([
			{ id: 'dc-old', signals: [{ text: 'different signal', tier: 2 }] },
		]);

		const result = await isDuplicateCandidate(WS, 'c-1', [{ text: 'raising a round', tier: 1 }]);
		expect(result).toBe(false);
	});

	it('returns false when no existing candidates', async () => {
		mockWhere.mockResolvedValueOnce([]);

		const result = await isDuplicateCandidate(WS, 'c-1', [{ text: 'raising a round', tier: 1 }]);
		expect(result).toBe(false);
	});
});
