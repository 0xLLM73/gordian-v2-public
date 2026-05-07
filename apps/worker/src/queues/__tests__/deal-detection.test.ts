import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DealDetectionJobData } from '../deal-detection';

// ─── Hoisted mocks ──────────────────────────────────────────────────────────────

const mockUnwrapWrk = vi.hoisted(() => vi.fn());
const mockDeriveKeys = vi.hoisted(() => vi.fn());
const mockDecrypt = vi.hoisted(() => vi.fn());
const mockMaskEntities = vi.hoisted(() => vi.fn());
const mockPrefilterEntities = vi.hoisted(() => vi.fn());
const mockClassifyDealIntent = vi.hoisted(() => vi.fn());
const mockExtractDealCandidate = vi.hoisted(() => vi.fn());

vi.mock('@repo/crypto', () => ({
	unwrapWrk: mockUnwrapWrk,
	deriveKeys: mockDeriveKeys,
	decrypt: mockDecrypt,
	maskEntities: mockMaskEntities,
}));

vi.mock('../../ai/deal-classifier', () => ({
	classifyDealIntent: mockClassifyDealIntent,
}));

vi.mock('../../ai/deal-extraction', () => ({
	extractDealCandidate: mockExtractDealCandidate,
}));

vi.mock('../../ai/prefilter', () => ({
	prefilterEntities: mockPrefilterEntities,
}));

// Mock BullMQ — must be before import
vi.mock('bullmq', () => ({
	Queue: vi.fn(function MockQueue() {
		return { add: vi.fn() };
	}),
	Worker: vi.fn(function MockWorker(_name: string, processor: unknown) {
		// Expose processor for testing
		(Worker as unknown as { __processor: unknown }).__processor = processor;
		return { on: vi.fn() };
	}),
}));

vi.mock('../../redis', () => ({
	connection: {},
}));

import { Worker } from 'bullmq';

// ─── Fixtures ────────────────────────────────────────────────────────────────────

const WS = 'ws-00000000-0000-0000-0000-000000000001';
const CHAT = 'chat-123';
const MSG = 'msg-456';
const CONTACT = 'contact-789';
const FAKE_WRK = Buffer.from('fake-wrk');
const FAKE_DEK = Buffer.from('fake-dek-32-bytes-long-enough!!');
const FAKE_BIK = Buffer.from('fake-bik-for-masking');

const JOB_DATA = {
	encryptedText: 'encrypted-message-text',
	chatId: CHAT,
	sourceMessageId: MSG,
	workspaceId: WS,
	contactId: CONTACT,
	keyEnvelope: {
		encryptedWrk: Buffer.from('test-wrk').toString('base64'),
		kmsContext: { workspaceId: WS },
		wrkVersion: 1,
	},
};

const FAKE_CANDIDATE = {
	id: 'cand-001',
	workspaceId: WS,
	chatId: CHAT,
	dealTypeGuess: 'saft',
};

// ─── Get processor ───────────────────────────────────────────────────────────────

// Import the module to trigger Worker construction, capturing the processor
async function getProcessor() {
	// Clear module cache to re-trigger Worker constructor
	vi.resetModules();

	// Re-mock before re-import
	vi.doMock('@repo/crypto', () => ({
		unwrapWrk: mockUnwrapWrk,
		deriveKeys: mockDeriveKeys,
		decrypt: mockDecrypt,
		maskEntities: mockMaskEntities,
	}));
	vi.doMock('../../ai/deal-classifier', () => ({
		classifyDealIntent: mockClassifyDealIntent,
	}));
	vi.doMock('../../ai/deal-extraction', () => ({
		extractDealCandidate: mockExtractDealCandidate,
	}));
	vi.doMock('../../ai/prefilter', () => ({
		prefilterEntities: mockPrefilterEntities,
	}));
	vi.doMock('bullmq', () => ({
		Queue: vi.fn(function MockQueue() {
			return { add: vi.fn() };
		}),
		Worker: vi.fn(function MockWorker(_name: string, processor: unknown) {
			(Worker as unknown as { __processor: unknown }).__processor = processor;
			return { on: vi.fn() };
		}),
	}));
	vi.doMock('../../redis', () => ({ connection: {} }));

	await import('../deal-detection');
	return (
		Worker as unknown as {
			__processor: (job: { data: DealDetectionJobData }) => Promise<unknown>;
		}
	).__processor;
}

// ─── Tests ───────────────────────────────────────────────────────────────────────

describe('deal-detection queue worker', () => {
	let processor: (job: { data: DealDetectionJobData }) => Promise<unknown>;

	beforeEach(async () => {
		vi.clearAllMocks();

		// Default mock returns
		mockUnwrapWrk.mockResolvedValue(FAKE_WRK);
		mockDeriveKeys.mockResolvedValue({ dek: FAKE_DEK, bik: FAKE_BIK });
		mockDecrypt.mockReturnValue('Our SAFT allocation is $2M USDC');
		mockPrefilterEntities.mockReturnValue([]);
		mockMaskEntities.mockReturnValue({ maskedText: '[MASKED] SAFT allocation is $2M USDC' });
		mockClassifyDealIntent.mockResolvedValue({ isInvestmentDiscussion: true, confidence: 0.95 });
		mockExtractDealCandidate.mockResolvedValue(FAKE_CANDIDATE);

		processor = await getProcessor();
	});

	// ─── Full pipeline ──────────────────────────────────────────────────────

	describe('full pipeline', () => {
		it('runs GC3→GC4 pipeline and returns candidate', async () => {
			const result = await processor({ data: JOB_DATA });
			expect(result).toEqual({ layer: 'gc4', passed: true, candidateId: 'cand-001' });
		});

		it('decrypts message text from job payload', async () => {
			await processor({ data: JOB_DATA });
			expect(mockUnwrapWrk).toHaveBeenCalled();
			expect(mockDeriveKeys).toHaveBeenCalledWith(FAKE_WRK, WS, 1);
			expect(mockDecrypt).toHaveBeenCalledWith('encrypted-message-text', FAKE_DEK);
		});

		it('ELM-masks text before calling GC3', async () => {
			await processor({ data: JOB_DATA });
			expect(mockPrefilterEntities).toHaveBeenCalledWith('Our SAFT allocation is $2M USDC');
			expect(mockMaskEntities).toHaveBeenCalledWith(
				'Our SAFT allocation is $2M USDC',
				FAKE_BIK,
				[],
			);
			expect(mockClassifyDealIntent).toHaveBeenCalledWith('[MASKED] SAFT allocation is $2M USDC');
		});

		it('passes masked text to GC4 extraction', async () => {
			await processor({ data: JOB_DATA });
			expect(mockExtractDealCandidate).toHaveBeenCalledWith(
				'[MASKED] SAFT allocation is $2M USDC',
				CHAT,
				MSG,
				WS,
				expect.objectContaining({ wrkVersion: 1 }),
				CONTACT,
			);
		});
	});

	// ─── GC3 rejection ──────────────────────────────────────────────────────

	describe('GC3 rejection', () => {
		it('stops at GC3 when not investment discussion', async () => {
			mockClassifyDealIntent.mockResolvedValueOnce({
				isInvestmentDiscussion: false,
				confidence: 0.3,
			});
			const result = await processor({ data: JOB_DATA });
			expect(result).toEqual({ layer: 'gc3', passed: false });
			expect(mockExtractDealCandidate).not.toHaveBeenCalled();
		});
	});

	// ─── GC4 null result ────────────────────────────────────────────────────

	describe('GC4 null result', () => {
		it('returns passed: false when extraction returns null', async () => {
			mockExtractDealCandidate.mockResolvedValueOnce(null);
			const result = await processor({ data: JOB_DATA });
			expect(result).toEqual({ layer: 'gc4', passed: false });
		});
	});

	// ─── contactId handling ─────────────────────────────────────────────────

	describe('contactId handling', () => {
		it('passes undefined contactId when not provided', async () => {
			const { contactId: _, ...dataWithoutContact } = JOB_DATA;
			await processor({ data: dataWithoutContact });
			expect(mockExtractDealCandidate).toHaveBeenCalledWith(
				expect.any(String),
				CHAT,
				MSG,
				WS,
				expect.any(Object),
				undefined,
			);
		});
	});

	// ─── Queue configuration ────────────────────────────────────────────────

	describe('queue configuration', () => {
		it('creates queue with {ai-flow} prefix', async () => {
			vi.resetModules();
			const { Queue: MockQueue } = await import('bullmq');
			await import('../deal-detection');
			expect(MockQueue).toHaveBeenCalledWith(
				'deal-detection',
				expect.objectContaining({ prefix: '{ai-flow}' }),
			);
		});

		it('creates worker with {ai-flow} prefix and concurrency 3', async () => {
			vi.resetModules();
			const { Worker: MockWorker } = await import('bullmq');
			await import('../deal-detection');
			expect(MockWorker).toHaveBeenCalledWith(
				'deal-detection',
				expect.any(Function),
				expect.objectContaining({ prefix: '{ai-flow}', concurrency: 3 }),
			);
		});
	});
});
