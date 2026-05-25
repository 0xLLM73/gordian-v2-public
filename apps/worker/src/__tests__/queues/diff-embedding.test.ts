import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetUnembeddedDiffs = vi.fn();
const mockUpdateDiffEmbedding = vi.fn();
const mockGenerateEmbedding = vi.fn();

type MockProcessor = (job?: unknown) => Promise<unknown> | unknown;

vi.mock('@repo/db', () => ({
	getUnembeddedDiffs: (...args: unknown[]) => mockGetUnembeddedDiffs(...args),
	updateDiffEmbedding: (...args: unknown[]) => mockUpdateDiffEmbedding(...args),
}));

vi.mock('../../ai/embeddings', () => ({
	generateEmbedding: (...args: unknown[]) => mockGenerateEmbedding(...args),
}));

vi.mock('../../redis', () => ({
	connection: {},
}));

vi.mock('bullmq', () => ({
	Worker: vi.fn().mockImplementation((_name: string, processor: MockProcessor) => {
		// Store the processor so tests can invoke it directly
		(Worker as unknown as { __processor: MockProcessor }).__processor = processor;
		return { on: vi.fn() };
	}),
	Queue: vi.fn().mockImplementation(() => ({
		add: vi.fn(),
	})),
}));

const Worker = (await import('bullmq')).Worker as unknown as { __processor: MockProcessor };

describe('diff-embedding worker', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('processes unembedded diffs by generating and storing embeddings', async () => {
		const fakeEmbedding = Array.from({ length: 512 }, () => Math.random());

		mockGetUnembeddedDiffs.mockResolvedValue([
			{ id: 'diff-1', description: 'False positive: social pleasantry' },
			{ id: 'diff-2', description: 'Wrong date extracted' },
		]);
		mockGenerateEmbedding.mockResolvedValue(fakeEmbedding);
		mockUpdateDiffEmbedding.mockResolvedValue({});

		// Import to trigger Worker constructor
		await import('../../queues/diff-embedding');

		const processor = Worker.__processor;
		expect(processor).toBeDefined();

		const result = await processor();

		expect(mockGetUnembeddedDiffs).toHaveBeenCalledWith(50);
		expect(mockGenerateEmbedding).toHaveBeenCalledTimes(2);
		expect(mockGenerateEmbedding).toHaveBeenCalledWith('False positive: social pleasantry');
		expect(mockGenerateEmbedding).toHaveBeenCalledWith('Wrong date extracted');
		expect(mockUpdateDiffEmbedding).toHaveBeenCalledTimes(2);
		expect(mockUpdateDiffEmbedding).toHaveBeenCalledWith('diff-1', fakeEmbedding);
		expect(mockUpdateDiffEmbedding).toHaveBeenCalledWith('diff-2', fakeEmbedding);
		expect(result).toEqual({ processed: 2, total: 2 });
	});

	it('returns early when no unembedded diffs exist', async () => {
		mockGetUnembeddedDiffs.mockResolvedValue([]);

		await import('../../queues/diff-embedding');

		const processor = Worker.__processor;
		const result = await processor();

		expect(result).toEqual({ processed: 0 });
		expect(mockGenerateEmbedding).not.toHaveBeenCalled();
		expect(mockUpdateDiffEmbedding).not.toHaveBeenCalled();
	});

	it('skips diffs with no description', async () => {
		mockGetUnembeddedDiffs.mockResolvedValue([
			{ id: 'diff-1', description: null },
			{ id: 'diff-2', description: 'Has description' },
		]);
		mockGenerateEmbedding.mockResolvedValue([0.1, 0.2]);
		mockUpdateDiffEmbedding.mockResolvedValue({});

		await import('../../queues/diff-embedding');

		const processor = Worker.__processor;
		const result = await processor();

		expect(mockGenerateEmbedding).toHaveBeenCalledTimes(1);
		expect(mockGenerateEmbedding).toHaveBeenCalledWith('Has description');
		expect(result).toEqual({ processed: 1, total: 2 });
	});

	it('continues processing when individual embedding fails', async () => {
		mockGetUnembeddedDiffs.mockResolvedValue([
			{ id: 'diff-1', description: 'Will fail' },
			{ id: 'diff-2', description: 'Will succeed' },
		]);
		mockGenerateEmbedding
			.mockRejectedValueOnce(new Error('OpenAI rate limit'))
			.mockResolvedValueOnce([0.1, 0.2]);
		mockUpdateDiffEmbedding.mockResolvedValue({});

		await import('../../queues/diff-embedding');

		const processor = Worker.__processor;
		const result = await processor();

		// First one failed, second succeeded
		expect(mockUpdateDiffEmbedding).toHaveBeenCalledTimes(1);
		expect(mockUpdateDiffEmbedding).toHaveBeenCalledWith('diff-2', [0.1, 0.2]);
		expect(result).toEqual({ processed: 1, total: 2 });
	});
});
