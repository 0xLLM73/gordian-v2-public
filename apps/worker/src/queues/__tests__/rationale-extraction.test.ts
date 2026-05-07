import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks (hoisted before imports) ──────────────────────────────────────────

vi.mock('bullmq', () => ({
	Queue: vi.fn().mockImplementation(() => ({
		add: vi.fn().mockResolvedValue({ id: 'job-1' }),
		getJobCounts: vi.fn().mockResolvedValue({}),
	})),
	Worker: vi.fn().mockImplementation((_name: string, processor: unknown) => ({
		processor,
		on: vi.fn(),
	})),
}));

vi.mock('../../redis', () => ({
	connection: {},
}));

const mockUnwrapWrk = vi.fn().mockResolvedValue(Buffer.alloc(32));
const mockDeriveKeys = vi.fn().mockResolvedValue({
	dek: Buffer.alloc(32),
	bik: Buffer.from('a'.repeat(64), 'hex'),
	tsk: Buffer.alloc(32),
});

vi.mock('@repo/crypto', () => ({
	unwrapWrk: (...args: unknown[]) => mockUnwrapWrk(...args),
	deriveKeys: (...args: unknown[]) => mockDeriveKeys(...args),
}));

const mockGetMessagesByContact = vi.fn();
vi.mock('@repo/db', () => ({
	getMessagesByContact: (...args: unknown[]) => mockGetMessagesByContact(...args),
}));

const mockExtractDecisionRationales = vi.fn().mockResolvedValue(undefined);
vi.mock('../../ai/rationale-extraction', () => ({
	extractDecisionRationales: (...args: unknown[]) => mockExtractDecisionRationales(...args),
}));

// ─── Side-effect import (triggers Worker registration) ──────────────────────

await import('../rationale-extraction');

// ─── Extract processor from mock ────────────────────────────────────────────

const { Worker, Queue } = await import('bullmq');
const workerCalls = vi.mocked(Worker).mock.calls;
const queueCalls = vi.mocked(Queue).mock.calls;
const processorFn = workerCalls[0]?.[1] as (job: {
	data: Record<string, unknown>;
}) => Promise<unknown>;

// Snapshot queue config before beforeEach clears mocks
const rationaleQueueCall = queueCalls.find(
	(call) => typeof call[0] === 'string' && call[0] === 'rationale-extraction',
);
const rationaleWorkerCall = workerCalls.find(
	(call) => typeof call[0] === 'string' && call[0] === 'rationale-extraction',
);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WS = '00000000-0000-0000-0000-000000000001';
const CONTACT = '00000000-0000-0000-0000-000000000002';
const ENTITY = '00000000-0000-0000-0000-000000000003';

const fakeKeyEnvelope = {
	encryptedWrk: Buffer.from('test-key').toString('base64'),
	kmsContext: { WorkspaceID: WS },
	wrkVersion: 1,
};

const validJobData = {
	action: 'deal_lost',
	label: 'Deal stage → lost',
	contactId: CONTACT,
	entityId: ENTITY,
	entityType: 'deal' as const,
	workspaceId: WS,
	keyEnvelope: fakeKeyEnvelope,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('rationale-extraction worker', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetMessagesByContact.mockResolvedValue([
			{ text: 'The tokenomics are terrible', sentAt: new Date() },
			{ text: 'Team has no experience', sentAt: new Date() },
		]);
	});

	it('processes a valid job with messages', async () => {
		await processorFn({ data: validJobData });

		expect(mockUnwrapWrk).toHaveBeenCalledOnce();
		expect(mockDeriveKeys).toHaveBeenCalledWith(expect.any(Buffer), WS, 1);
		expect(mockGetMessagesByContact).toHaveBeenCalledWith(WS, CONTACT, expect.any(Object), {
			limit: 50,
		});
		expect(mockExtractDecisionRationales).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'deal_lost',
				label: 'Deal stage → lost',
				contactId: CONTACT,
				entityId: ENTITY,
				entityType: 'deal',
				workspaceId: WS,
				workspaceSalt: expect.any(Buffer),
			}),
			['The tokenomics are terrible', 'Team has no experience'],
		);
	});

	it('derives keys from envelope correctly', async () => {
		await processorFn({ data: validJobData });

		// Verify envelope reconstruction: base64 → Buffer
		const envelopeArg = mockUnwrapWrk.mock.calls[0][0];
		expect(envelopeArg).toEqual({
			encryptedWrk: Buffer.from(fakeKeyEnvelope.encryptedWrk, 'base64'),
			kmsContext: fakeKeyEnvelope.kmsContext,
			wrkVersion: 1,
		});
	});

	it('skips extraction when no messages found', async () => {
		mockGetMessagesByContact.mockResolvedValue([]);

		await processorFn({ data: validJobData });

		expect(mockExtractDecisionRationales).not.toHaveBeenCalled();
	});

	it('skips message fetch when contactId is missing', async () => {
		const { contactId: _, ...noContactData } = validJobData;
		await processorFn({ data: noContactData });

		expect(mockGetMessagesByContact).not.toHaveBeenCalled();
		expect(mockExtractDecisionRationales).not.toHaveBeenCalled();
	});

	it('throws when keyEnvelope is missing (SEC-PROV-004)', async () => {
		const { keyEnvelope: _, ...noEnvelopeData } = validJobData;

		await expect(processorFn({ data: noEnvelopeData })).rejects.toThrow(
			'Missing keyEnvelope in job data',
		);
	});

	it('passes BIK as workspaceSalt for ELM masking (SEC-PROV-003)', async () => {
		const fakeBik = Buffer.from('b'.repeat(64), 'hex');
		mockDeriveKeys.mockResolvedValueOnce({
			dek: Buffer.alloc(32),
			bik: fakeBik,
			tsk: Buffer.alloc(32),
		});

		await processorFn({ data: validJobData });

		const decisionContext = mockExtractDecisionRationales.mock.calls[0][0];
		expect(decisionContext.workspaceSalt).toBe(fakeBik);
	});
});

describe('rationale-extraction queue configuration', () => {
	it('uses {ai-flow} prefix to prevent CROSSSLOT errors', () => {
		expect(rationaleQueueCall).toBeDefined();
		expect(rationaleQueueCall?.[1]?.prefix).toBe('{ai-flow}');
	});

	it('worker uses {ai-flow} prefix', () => {
		expect(rationaleWorkerCall).toBeDefined();
		expect(rationaleWorkerCall?.[2]?.prefix).toBe('{ai-flow}');
	});

	it('worker has concurrency of 2', () => {
		expect(rationaleWorkerCall?.[2]?.concurrency).toBe(2);
	});
});
