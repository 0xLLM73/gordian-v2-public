import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests for the fulfillment queue worker.
 * Verifies job processing, edge case handling, and lastCheckedAt updates.
 */

// Mock @repo/crypto
vi.mock('@repo/crypto', () => ({
	withKeys: vi.fn((_envelope: unknown, fn: () => unknown) => fn()),
	keyStore: {
		getStore: vi.fn(() => ({
			dek: Buffer.alloc(32),
			bik: Buffer.alloc(32),
			tsk: Buffer.alloc(32),
		})),
	},
	unwrapWrk: vi.fn().mockResolvedValue(Buffer.alloc(32)),
	deriveKeys: vi
		.fn()
		.mockResolvedValue({ dek: Buffer.alloc(32), bik: Buffer.alloc(32), tsk: Buffer.alloc(32) }),
	decrypt: vi.fn((content: string) => content),
}));

// Mock DB DAL functions
const mockGetCommitmentsForFulfillmentCheck = vi.fn();
const mockMarkCommitmentFulfilled = vi.fn();
const mockUpdateLastCheckedAt = vi.fn();

vi.mock('@repo/db', () => ({
	getCommitmentsForFulfillmentCheck: (...args: unknown[]) =>
		mockGetCommitmentsForFulfillmentCheck(...args),
	markCommitmentFulfilled: (...args: unknown[]) => mockMarkCommitmentFulfilled(...args),
	updateLastCheckedAt: (...args: unknown[]) => mockUpdateLastCheckedAt(...args),
}));

// Mock AI detection
const mockDetectFulfillment = vi.fn();

vi.mock('../../ai/fulfillment-detection', () => ({
	detectFulfillment: (...args: unknown[]) => mockDetectFulfillment(...args),
}));

// Mock outcome-evaluation to prevent it from registering its own Worker instance
// (which would shift workerCalls[0] away from the fulfillment worker)
vi.mock('../outcome-evaluation', () => ({
	enqueueCommitmentEvaluation: vi.fn().mockResolvedValue(undefined),
}));

// Mock BullMQ
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

// Mock redis
vi.mock('../../redis', () => ({
	connection: {},
}));

// Import after mocks — side-effect import triggers Worker mock registration
await import('../fulfillment');

// Extract the processor function from the Worker mock
const { Worker } = await import('bullmq');
const workerCalls = vi.mocked(Worker).mock.calls;
const processorFn = workerCalls[0][1] as (job: {
	data: Record<string, unknown>;
}) => Promise<unknown>;

describe('fulfillment worker', () => {
	const baseJobData = {
		userId: 'user-1',
		contactId: '00000000-0000-0000-0000-000000000001',
		workspaceId: 'ws-1',
		keyEnvelope: {
			encryptedWrk: Buffer.from('test').toString('base64'),
			kmsContext: { workspace: 'ws-1' },
			wrkVersion: 1,
		},
		messages: [{ role: 'user', content: 'Here is the report', timestamp: '2026-01-15T10:00:00Z' }],
		workspaceSalt: Buffer.from('test-salt').toString('hex'),
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('skips contacts with no messages', async () => {
		const result = await processorFn({ data: { ...baseJobData, messages: [] } });
		expect(result).toEqual({ skipped: true, reason: 'no_messages' });
		expect(mockDetectFulfillment).not.toHaveBeenCalled();
	});

	it('skips contacts with no key envelope', async () => {
		const result = await processorFn({
			data: { ...baseJobData, keyEnvelope: undefined },
		});
		expect(result).toEqual({ skipped: true, reason: 'no_envelope' });
	});

	it('skips contacts with no workspace salt', async () => {
		const result = await processorFn({
			data: { ...baseJobData, workspaceSalt: undefined },
		});
		expect(result).toEqual({ skipped: true, reason: 'no_salt' });
	});

	it('skips contacts with no active commitments', async () => {
		mockGetCommitmentsForFulfillmentCheck.mockResolvedValue([]);

		const result = await processorFn({ data: baseJobData });
		expect(result).toEqual({ skipped: true, reason: 'no_active_commitments' });
		expect(mockDetectFulfillment).not.toHaveBeenCalled();
	});

	it('processes jobs and calls detectFulfillment', async () => {
		const activeCommitments = [
			{
				id: 'commit-1',
				title: 'Send report',
				commitmentType: 'promise',
				dueDate: null,
			},
		];
		mockGetCommitmentsForFulfillmentCheck.mockResolvedValue(activeCommitments);
		mockDetectFulfillment.mockResolvedValue({
			results: [
				{ commitmentId: 'commit-1', fulfilled: true, evidence: 'Report sent', confidence: 0.9 },
			],
			traceId: 'trace-1',
			variant: 'detection_default',
		});
		mockMarkCommitmentFulfilled.mockResolvedValue({});
		mockUpdateLastCheckedAt.mockResolvedValue(undefined);

		const result = await processorFn({ data: baseJobData });

		expect(mockDetectFulfillment).toHaveBeenCalledTimes(1);
		expect(mockMarkCommitmentFulfilled).toHaveBeenCalledWith(
			'ws-1',
			'commit-1',
			'Report sent',
			expect.any(Object), // envelope
		);
		expect(result).toEqual({
			traceId: 'trace-1',
			variant: 'detection_default',
			checked: 1,
			fulfilled: 1,
		});
	});

	it('updates lastCheckedAt even when no fulfillment detected', async () => {
		const activeCommitments = [
			{ id: 'commit-1', title: 'Send report', commitmentType: 'promise', dueDate: null },
			{ id: 'commit-2', title: 'Call client', commitmentType: 'meeting', dueDate: null },
		];
		mockGetCommitmentsForFulfillmentCheck.mockResolvedValue(activeCommitments);
		mockDetectFulfillment.mockResolvedValue({
			results: [],
			traceId: 'trace-2',
			variant: 'detection_strict',
		});
		mockUpdateLastCheckedAt.mockResolvedValue(undefined);

		const result = await processorFn({ data: baseJobData });

		expect(mockUpdateLastCheckedAt).toHaveBeenCalledWith('ws-1', ['commit-1', 'commit-2']);
		expect(result).toEqual({
			traceId: 'trace-2',
			variant: 'detection_strict',
			checked: 2,
			fulfilled: 0,
		});
	});
});
