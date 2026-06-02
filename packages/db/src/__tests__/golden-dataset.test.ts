import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInsert = vi.hoisted(() => vi.fn());
const mockValues = vi.hoisted(() => vi.fn());
const mockReturning = vi.hoisted(() => vi.fn());
const mockWithKeys = vi.hoisted(() => vi.fn());
const mockGetCurrentKeys = vi.hoisted(() => vi.fn());
const mockMaskEntities = vi.hoisted(() => vi.fn());
const mockPrefilterEntities = vi.hoisted(() => vi.fn());

vi.mock('../client', () => ({
	db: {
		insert: mockInsert,
		execute: vi.fn(),
		update: vi.fn(),
		select: vi.fn(),
	},
}));

vi.mock('@repo/crypto', () => ({
	withKeys: mockWithKeys,
	getCurrentKeys: mockGetCurrentKeys,
	maskEntities: mockMaskEntities,
	prefilterEntities: mockPrefilterEntities,
	keyStore: { getStore: vi.fn(() => null) },
	encrypt: vi.fn((value: string) => `enc:${value}`),
	decrypt: vi.fn((value: string) => value),
	computeBlindIndex: vi.fn((value: string) => `bidx:${value}`),
}));

const WORKSPACE_ID = '11111111-1111-1111-1111-111111111111';

describe('createGoldenExample privacy guards', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockReturning.mockResolvedValue([{ id: 'golden-1' }]);
		mockValues.mockReturnValue({ returning: mockReturning });
		mockInsert.mockReturnValue({ values: mockValues });
		mockWithKeys.mockImplementation((_envelope: unknown, fn: () => unknown) => fn());
		mockGetCurrentKeys.mockReturnValue({ bik: Buffer.from('bik') });
		mockPrefilterEntities.mockReturnValue([]);
		mockMaskEntities.mockImplementation((text: string) => ({ maskedText: text, entityMap: [] }));
	});

	it('redacts commitment extraction prediction and correction text before storage', async () => {
		const { createGoldenExample } = await import('../dal/golden-dataset');

		await createGoldenExample({
			workspaceId: WORKSPACE_ID,
			featureDomain: 'commitment_extraction',
			inputContext: 'masked context from caller',
			modelPrediction: {
				title: 'Send the deck to alice@example.com',
				commitment_type: 'task',
				assignee: 'user',
				due_date: '2026-06-01T00:00:00.000Z',
				confidence: 0.81,
				quote: 'I will send Alice the deck',
				reasoning: 'Alice asked and the user promised to send the deck',
			},
			correctedOutput: {
				title: 'Send the updated deck to alice@example.com',
				commitment_type: 'task',
				assignee: 'user',
				due_date: '2026-06-01T00:00:00.000Z',
				confidence: 0.95,
				quote: 'Actually I will send Alice the updated deck',
			},
		});

		const stored = mockValues.mock.calls[0][0] as Record<string, unknown>;
		const storedJson = JSON.stringify({
			modelPrediction: stored.modelPrediction,
			correctedOutput: stored.correctedOutput,
		});

		expect(storedJson).not.toContain('alice@example.com');
		expect(storedJson).not.toContain('Send the deck');
		expect(storedJson).not.toContain('Alice');
		expect(stored.modelPrediction).toMatchObject({
			title: expect.stringMatching(/^\[COMMITMENT_TEXT_\d+\]$/),
			commitment_type: 'task',
			assignee: 'user',
			due_date: '2026-06-01T00:00:00.000Z',
			confidence: 0.81,
			quote: expect.stringMatching(/^\[COMMITMENT_TEXT_\d+\]$/),
			reasoning: expect.stringMatching(/^\[COMMITMENT_TEXT_\d+\]$/),
		});
		expect(stored.correctedOutput).toMatchObject({
			title: expect.stringMatching(/^\[COMMITMENT_TEXT_\d+\]$/),
			commitment_type: 'task',
			assignee: 'user',
			due_date: '2026-06-01T00:00:00.000Z',
			confidence: 0.95,
			quote: expect.stringMatching(/^\[COMMITMENT_TEXT_\d+\]$/),
		});
		expect((stored.modelPrediction as Record<string, unknown>).title).not.toEqual(
			(stored.correctedOutput as Record<string, unknown>).title,
		);
	});

	it('uses the same placeholder when prediction and correction contain the same text', async () => {
		const { createGoldenExample } = await import('../dal/golden-dataset');

		await createGoldenExample({
			workspaceId: WORKSPACE_ID,
			featureDomain: 'commitment_extraction',
			inputContext: 'masked context from caller',
			modelPrediction: {
				title: 'Call Bob about the allocation',
				commitment_type: 'meeting',
				assignee: 'contact',
			},
			correctedOutput: {
				title: 'Call Bob about the allocation',
				commitment_type: 'meeting',
				assignee: 'contact',
			},
		});

		const stored = mockValues.mock.calls[0][0] as Record<string, Record<string, unknown>>;
		expect(stored.modelPrediction.title).toBe('[COMMITMENT_TEXT_1]');
		expect(stored.correctedOutput.title).toBe('[COMMITMENT_TEXT_1]');
	});

	it('does not redact prediction and correction JSON for other feature domains', async () => {
		const { createGoldenExample } = await import('../dal/golden-dataset');

		await createGoldenExample({
			workspaceId: WORKSPACE_ID,
			featureDomain: 'summary_generation',
			inputContext: 'summary context',
			modelPrediction: { title: 'Visible summary title', score: 1 },
			correctedOutput: { title: 'Visible corrected title', score: 2 },
		});

		const stored = mockValues.mock.calls[0][0] as Record<string, unknown>;
		expect(stored.modelPrediction).toEqual({ title: 'Visible summary title', score: 1 });
		expect(stored.correctedOutput).toEqual({ title: 'Visible corrected title', score: 2 });
	});
});
