import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReturning = vi.fn<any>();
const mockOnConflictDoNothing = vi.fn<any>(() => ({ returning: mockReturning }));
const mockValues = vi.fn<any>(() => ({
	returning: mockReturning,
	onConflictDoNothing: mockOnConflictDoNothing,
}));
const mockInsert = vi.fn<any>(() => ({ values: mockValues }));
const mockLimit = vi.fn<any>(() => Promise.resolve([]));
const mockOrderBy = vi.fn<any>(() => ({ limit: mockLimit }));
const mockWhere = vi.fn<any>(() => ({ limit: mockLimit, orderBy: mockOrderBy }));
const mockFrom = vi.fn<any>(() => ({ where: mockWhere }));
const mockSelect = vi.fn<any>(() => ({ from: mockFrom }));
const mockSetWhere = vi.fn<any>(() => Promise.resolve());
const mockSet = vi.fn<any>(() => ({ where: mockSetWhere }));
const mockUpdate = vi.fn<any>(() => ({ set: mockSet }));
const mockDelete = vi.fn<any>(() => ({ where: vi.fn(() => Promise.resolve()) }));

vi.mock('../client', () => ({
	db: {
		insert: mockInsert,
		update: mockUpdate,
		select: mockSelect,
		delete: mockDelete,
	},
}));

const mockComputeBlindIndex = vi.fn((val: string) => `hash:${val}`);
const mockKeyStoreGetStore = vi.fn(() => ({ bik: Buffer.from('test-bik') }));

vi.mock('@repo/crypto', () => ({
	withKeys: vi.fn((_envelope, fn) => fn()),
	computeBlindIndex: mockComputeBlindIndex,
	getCurrentKeys: mockKeyStoreGetStore,
	keyStore: { getStore: mockKeyStoreGetStore },
}));

const mockEnvelope = {
	encryptedWrk: Buffer.from('test'),
	kmsContext: { workspaceId: 'ws-1' },
	wrkVersion: 1,
};

describe('calendar DAL', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('createCalendarConnection wraps in withKeys', async () => {
		const { withKeys } = await import('@repo/crypto');
		mockReturning.mockResolvedValue([{ id: 'conn-1' }]);

		const { createCalendarConnection } = await import('../dal/calendar');
		await createCalendarConnection(
			'ws-1',
			{ accessToken: 'at', refreshToken: 'rt', email: 'user@test.com' },
			mockEnvelope,
		);

		expect(withKeys).toHaveBeenCalledWith(mockEnvelope, expect.any(Function));
	});

	it('getCalendarConnection returns null when no connection', async () => {
		mockLimit.mockResolvedValue([]);

		const { getCalendarConnection } = await import('../dal/calendar');
		const result = await getCalendarConnection('ws-1', mockEnvelope);

		expect(result).toBeNull();
	});

	it('upsertCalendarEvent uses onConflictDoNothing', async () => {
		mockReturning.mockResolvedValue([{ id: 'evt-1' }]);

		const { upsertCalendarEvent } = await import('../dal/calendar');
		await upsertCalendarEvent(
			'ws-1',
			'conn-1',
			{
				externalId: 'ext-1',
				title: 'Meeting',
				startTime: new Date(),
			},
			mockEnvelope,
		);

		expect(mockInsert).toHaveBeenCalled();
		expect(mockOnConflictDoNothing).toHaveBeenCalled();
	});

	it('matchAttendeeToContact returns null for empty emails', async () => {
		const { matchAttendeeToContact } = await import('../dal/calendar');
		const result = await matchAttendeeToContact('ws-1', 'evt-1', [], mockEnvelope);

		expect(result).toBeNull();
		expect(mockSelect).not.toHaveBeenCalled();
	});

	it('matchAttendeeToContact finds first matching contact using blind index', async () => {
		// First email: no match
		mockLimit.mockResolvedValueOnce([]);
		// Second email: match
		mockLimit.mockResolvedValueOnce([{ id: 'contact-1' }]);
		mockSetWhere.mockResolvedValue(undefined);

		const { matchAttendeeToContact } = await import('../dal/calendar');
		const result = await matchAttendeeToContact(
			'ws-1',
			'evt-1',
			['no@match.com', 'yes@match.com'],
			mockEnvelope,
		);

		expect(result).toBe('contact-1');
		// Verify blind index is used — computeBlindIndex called for each email checked
		expect(mockComputeBlindIndex).toHaveBeenCalledWith('no@match.com', expect.any(Buffer));
		expect(mockComputeBlindIndex).toHaveBeenCalledWith('yes@match.com', expect.any(Buffer));
	});

	it('matchAttendeeToContact wraps in withKeys for crypto context', async () => {
		const { withKeys } = await import('@repo/crypto');
		mockLimit.mockResolvedValue([]);

		const { matchAttendeeToContact } = await import('../dal/calendar');
		await matchAttendeeToContact('ws-1', 'evt-1', ['user@test.com'], mockEnvelope);

		expect(withKeys).toHaveBeenCalledWith(mockEnvelope, expect.any(Function));
	});

	it('getUpcomingEvents filters by time', async () => {
		mockLimit.mockResolvedValue([]);

		const { getUpcomingEvents } = await import('../dal/calendar');
		const result = await getUpcomingEvents('ws-1', 5);

		expect(mockSelect).toHaveBeenCalled();
		expect(result).toEqual([]);
	});
});
