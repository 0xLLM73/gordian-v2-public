import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockWithKeys = vi.hoisted(() => vi.fn((_, fn: () => unknown) => fn()));

const mockSelectLimit = vi.hoisted(() => vi.fn());
const mockSelectWhere = vi.hoisted(() => vi.fn(() => ({ limit: mockSelectLimit })));
const mockSelectFrom = vi.hoisted(() => vi.fn(() => ({ where: mockSelectWhere })));
const mockSelect = vi.hoisted(() => vi.fn(() => ({ from: mockSelectFrom })));

const mockUpdateReturning = vi.hoisted(() => vi.fn());
const mockUpdateWhere = vi.hoisted(() => vi.fn(() => ({ returning: mockUpdateReturning })));
const mockUpdateSet = vi.hoisted(() => vi.fn(() => ({ where: mockUpdateWhere })));
const mockUpdate = vi.hoisted(() => vi.fn(() => ({ set: mockUpdateSet })));

const mockInsertReturning = vi.hoisted(() => vi.fn());
const mockInsertValues = vi.hoisted(() => vi.fn(() => ({ returning: mockInsertReturning })));
const mockInsert = vi.hoisted(() => vi.fn(() => ({ values: mockInsertValues })));

vi.mock('@repo/crypto', () => ({
	withKeys: mockWithKeys,
}));

vi.mock('../client', () => ({
	db: {
		select: mockSelect,
		insert: mockInsert,
		update: mockUpdate,
	},
}));

import { getCalibration, getCalibrationForAI, upsertCalibration } from '../dal/calibration';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const fakeEnvelope = {
	encryptedWrk: Buffer.from('fake'),
	kmsContext: {},
	wrkVersion: 1,
};

const USER = 'usr-00000000-0000-0000-0000-000000000001';
const WS = 'ws-00000000-0000-0000-0000-000000000001';

const baseRow = {
	id: 'cal-1',
	userId: USER,
	workspaceId: WS,
	calibrationVersion: 1,
	communicationStyle: 'direct' as const,
	detailPreference: 'balanced' as const,
	riskTolerance: 'moderate' as const,
	decisionSpeed: 'moderate' as const,
	relationshipFocus: 'balanced' as const,
	priorities: [],
	industryFocus: [],
	roleDescription: null,
	investmentThesis: null,
	ticketSizeMin: null,
	ticketSizeMax: null,
	completedAt: null,
	createdAt: new Date(),
	updatedAt: new Date(),
};

// ─── getCalibration ───────────────────────────────────────────────────────────

describe('getCalibration', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSelect.mockReturnValue({ from: mockSelectFrom });
		mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
		mockSelectWhere.mockReturnValue({ limit: mockSelectLimit });
	});

	it('returns null when no calibration exists', async () => {
		mockSelectLimit.mockResolvedValueOnce([]);

		const result = await getCalibration(USER, WS, fakeEnvelope);

		expect(result).toBeNull();
	});

	it('returns calibration row when found', async () => {
		mockSelectLimit.mockResolvedValueOnce([baseRow]);

		const result = await getCalibration(USER, WS, fakeEnvelope);

		expect(result).toEqual(baseRow);
	});

	it('scopes query to userId and workspaceId', async () => {
		mockSelectLimit.mockResolvedValueOnce([]);

		await getCalibration(USER, WS, fakeEnvelope);

		expect(mockSelect).toHaveBeenCalledTimes(1);
		expect(mockSelectWhere).toHaveBeenCalledTimes(1);
	});

	it('calls withKeys with the provided envelope', async () => {
		mockSelectLimit.mockResolvedValueOnce([]);

		await getCalibration(USER, WS, fakeEnvelope);

		expect(mockWithKeys).toHaveBeenCalledWith(fakeEnvelope, expect.any(Function));
	});
});

// ─── upsertCalibration ────────────────────────────────────────────────────────

describe('upsertCalibration', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSelect.mockReturnValue({ from: mockSelectFrom });
		mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
		mockSelectWhere.mockReturnValue({ limit: mockSelectLimit });
		mockInsert.mockReturnValue({ values: mockInsertValues });
		mockInsertValues.mockReturnValue({ returning: mockInsertReturning });
		mockUpdate.mockReturnValue({ set: mockUpdateSet });
		mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
		mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });
	});

	it('creates new calibration on first call (completedAt set, calibrationVersion = 1)', async () => {
		// No existing record
		mockSelectLimit.mockResolvedValueOnce([]);
		const newRow = { ...baseRow, completedAt: new Date() };
		mockInsertReturning.mockResolvedValueOnce([newRow]);

		const result = await upsertCalibration(
			USER,
			WS,
			{ communicationStyle: 'direct', riskTolerance: 'moderate' },
			fakeEnvelope,
		);

		expect(mockInsert).toHaveBeenCalledTimes(1);
		expect(mockInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({ userId: USER, workspaceId: WS, communicationStyle: 'direct' }),
		);
		expect(result.completedAt).not.toBeNull();
	});

	it('increments calibrationVersion on recalibration (1 → 2)', async () => {
		// Existing record with version 1
		mockSelectLimit.mockResolvedValueOnce([{ id: 'cal-1', calibrationVersion: 1 }]);
		const updatedRow = { ...baseRow, calibrationVersion: 2, completedAt: new Date() };
		mockUpdateReturning.mockResolvedValueOnce([updatedRow]);

		const result = await upsertCalibration(USER, WS, { riskTolerance: 'aggressive' }, fakeEnvelope);

		expect(mockInsert).not.toHaveBeenCalled();
		expect(mockUpdate).toHaveBeenCalledTimes(1);
		const setArgs = (mockUpdateSet.mock.calls as unknown[][])[0]?.[0] as Record<string, unknown>;
		expect(setArgs?.calibrationVersion).toBe(2);
		expect(result.calibrationVersion).toBe(2);
	});

	it('updates all provided dimensions on recalibration', async () => {
		mockSelectLimit.mockResolvedValueOnce([{ id: 'cal-1', calibrationVersion: 1 }]);
		mockUpdateReturning.mockResolvedValueOnce([{ ...baseRow, calibrationVersion: 2 }]);

		await upsertCalibration(
			USER,
			WS,
			{ communicationStyle: 'formal', detailPreference: 'granular', priorities: ['deal_flow'] },
			fakeEnvelope,
		);

		const setArgs = (mockUpdateSet.mock.calls as unknown[][])[0]?.[0] as Record<string, unknown>;
		expect(setArgs?.communicationStyle).toBe('formal');
		expect(setArgs?.detailPreference).toBe('granular');
		expect(setArgs?.priorities).toEqual(['deal_flow']);
	});

	it('throws when insert returns no rows', async () => {
		mockSelectLimit.mockResolvedValueOnce([]);
		mockInsertReturning.mockResolvedValueOnce([]);

		await expect(upsertCalibration(USER, WS, {}, fakeEnvelope)).rejects.toThrow(
			'upsertCalibration: insert returned no rows',
		);
	});

	it('calls withKeys with the provided envelope', async () => {
		mockSelectLimit.mockResolvedValueOnce([]);
		mockInsertReturning.mockResolvedValueOnce([{ ...baseRow, completedAt: new Date() }]);

		await upsertCalibration(USER, WS, {}, fakeEnvelope);

		expect(mockWithKeys).toHaveBeenCalledWith(fakeEnvelope, expect.any(Function));
	});
});

// ─── getCalibrationForAI ──────────────────────────────────────────────────────

describe('getCalibrationForAI', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSelect.mockReturnValue({ from: mockSelectFrom });
		mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
		mockSelectWhere.mockReturnValue({ limit: mockSelectLimit });
	});

	it('returns null when no calibration exists', async () => {
		mockSelectLimit.mockResolvedValueOnce([]);

		const result = await getCalibrationForAI(USER, WS, fakeEnvelope);

		expect(result).toBeNull();
	});

	it('returns null for incomplete calibration (completedAt is null)', async () => {
		mockSelectLimit.mockResolvedValueOnce([{ ...baseRow, completedAt: null }]);

		const result = await getCalibrationForAI(USER, WS, fakeEnvelope);

		expect(result).toBeNull();
	});

	it('returns CalibrationContext with summary when completedAt is set', async () => {
		mockSelectLimit.mockResolvedValueOnce([
			{
				...baseRow,
				completedAt: new Date(),
				roleDescription: 'Partner at Acme VC',
			},
		]);

		const result = await getCalibrationForAI(USER, WS, fakeEnvelope);

		expect(result).not.toBeNull();
		expect(result?.summary).toContain('User profile:');
		expect(result?.summary).toContain('Role: Partner at Acme VC');
	});

	it('summary includes communication and detail preference labels', async () => {
		mockSelectLimit.mockResolvedValueOnce([
			{
				...baseRow,
				communicationStyle: 'formal' as const,
				detailPreference: 'granular' as const,
				completedAt: new Date(),
			},
		]);

		const result = await getCalibrationForAI(USER, WS, fakeEnvelope);

		expect(result?.summary).toContain('formal and professional');
		expect(result?.summary).toContain('prefers granular, detailed analysis');
	});

	it('formats ticket size correctly (USD cents → "$X,XXX - $Y,YYY")', async () => {
		mockSelectLimit.mockResolvedValueOnce([
			{
				...baseRow,
				completedAt: new Date(),
				ticketSizeMin: 50000000, // $500,000
				ticketSizeMax: 500000000, // $5,000,000
			},
		]);

		const result = await getCalibrationForAI(USER, WS, fakeEnvelope);

		expect(result?.summary).toContain('$500,000');
		expect(result?.summary).toContain('$5,000,000');
	});

	it('omits optional fields when not provided', async () => {
		mockSelectLimit.mockResolvedValueOnce([
			{
				...baseRow,
				completedAt: new Date(),
				investmentThesis: null,
				ticketSizeMin: null,
				ticketSizeMax: null,
			},
		]);

		const result = await getCalibrationForAI(USER, WS, fakeEnvelope);

		expect(result?.summary).not.toContain('Investment thesis');
		expect(result?.summary).not.toContain('Ticket size');
	});

	it('returns structured CalibrationContext with dimensions', async () => {
		mockSelectLimit.mockResolvedValueOnce([
			{
				...baseRow,
				communicationStyle: 'direct' as const,
				detailPreference: 'balanced' as const,
				riskTolerance: 'moderate' as const,
				decisionSpeed: 'deliberate' as const,
				relationshipFocus: 'depth' as const,
				priorities: ['deal_flow'],
				industryFocus: ['defi', 'ai'],
				completedAt: new Date(),
			},
		]);

		const result = await getCalibrationForAI(USER, WS, fakeEnvelope);

		expect(result?.dimensions.communicationStyle).toBe('direct');
		expect(result?.dimensions.priorities).toEqual(['deal_flow']);
		expect(result?.dimensions.industryFocus).toEqual(['defi', 'ai']);
		expect(result?.version).toBe(1);
	});
});
