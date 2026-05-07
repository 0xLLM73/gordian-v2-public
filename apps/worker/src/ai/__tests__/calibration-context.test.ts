import type { SealedEnvelope } from '@repo/crypto';
import { describe, expect, it, vi } from 'vitest';

const mockGetCalibrationForAI = vi.hoisted(() => vi.fn());

vi.mock('@repo/db', () => ({
	getCalibrationForAI: mockGetCalibrationForAI,
}));

import { buildCalibrationKernelModifier } from '../calibration-context';

const fakeEnvelope: SealedEnvelope = {
	encryptedWrk: Buffer.from('fake'),
	kmsContext: {},
	wrkVersion: 1,
};

const mockCtx = {
	summary: 'User profile: Role: VC. Communication: formal and professional.',
	dimensions: {
		communicationStyle: 'formal',
		detailPreference: 'granular',
		riskTolerance: 'moderate',
		decisionSpeed: 'deliberate',
		relationshipFocus: 'depth',
		priorities: ['deal_flow'],
		industryFocus: ['defi'],
	},
	roleDescription: 'VC partner',
	investmentThesis: null,
	ticketSizeMin: null,
	ticketSizeMax: null,
	version: 1,
};

describe('buildCalibrationKernelModifier', () => {
	it('returns empty string when no calibration exists', async () => {
		mockGetCalibrationForAI.mockResolvedValueOnce(null);

		const result = await buildCalibrationKernelModifier('u1', 'w1', fakeEnvelope);

		expect(result).toBe('');
	});

	it('returns modifier block containing header when calibration exists', async () => {
		mockGetCalibrationForAI.mockResolvedValueOnce(mockCtx);

		const result = await buildCalibrationKernelModifier('u1', 'w1', fakeEnvelope);

		expect(result).toContain('## User Calibration (Layer 1 Modifier)');
	});

	it('modifier contains the calibration summary', async () => {
		mockGetCalibrationForAI.mockResolvedValueOnce(mockCtx);

		const result = await buildCalibrationKernelModifier('u1', 'w1', fakeEnvelope);

		expect(result).toContain('User profile:');
		expect(result).toContain('formal and professional');
	});

	it('modifier contains style and detail level adaptation instruction', async () => {
		mockGetCalibrationForAI.mockResolvedValueOnce(mockCtx);

		const result = await buildCalibrationKernelModifier('u1', 'w1', fakeEnvelope);

		expect(result).toContain('Communication style: formal');
		expect(result).toContain('Detail level: granular');
	});

	it('passes userId, workspaceId and envelope to getCalibrationForAI', async () => {
		mockGetCalibrationForAI.mockResolvedValueOnce(null);

		await buildCalibrationKernelModifier('u-123', 'w-456', fakeEnvelope);

		expect(mockGetCalibrationForAI).toHaveBeenCalledWith('u-123', 'w-456', fakeEnvelope);
	});
});
