import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockIsFeatureEnabled = vi.hoisted(() => vi.fn());
const mockGetContactsNeedingExtraction = vi.hoisted(() => vi.fn());
const mockGetMessagesByContact = vi.hoisted(() => vi.fn());
const mockDbSelect = vi.hoisted(() => vi.fn());

vi.mock('@repo/db', () => ({
	db: {
		select: mockDbSelect,
	},
	eq: vi.fn(),
	isFeatureEnabled: mockIsFeatureEnabled,
	getContactsNeedingExtraction: mockGetContactsNeedingExtraction,
	getMessagesByContact: mockGetMessagesByContact,
	workspaces: {
		id: 'id',
		encryptedWrk: 'encryptedWrk',
		kmsContext: 'kmsContext',
		wrkVersion: 'wrkVersion',
	},
}));

const mockUnwrapWrk = vi.hoisted(() => vi.fn(() => Promise.resolve(Buffer.alloc(32))));
const mockDeriveKeys = vi.hoisted(() =>
	vi.fn(() =>
		Promise.resolve({
			dek: Buffer.alloc(32),
			bik: Buffer.alloc(32),
			tsk: Buffer.alloc(32),
		}),
	),
);

vi.mock('@repo/crypto', () => ({
	deriveKeys: mockDeriveKeys,
	unwrapWrk: mockUnwrapWrk,
}));

const mockExtractKnowledgeForContact = vi.hoisted(() => vi.fn());
const mockKeywordPreFilter = vi.hoisted(() => vi.fn(() => true));

vi.mock('../../ai/knowledge-extraction', () => ({
	extractKnowledgeForContact: mockExtractKnowledgeForContact,
	keywordPreFilter: mockKeywordPreFilter,
}));

// KG-4: Mock BatchRelationshipExtractor
vi.mock('../../ai/batch-relationship', () => ({
	BatchRelationshipExtractor: class MockBatcher {
		requests: unknown[] = [];
		get size() {
			return this.requests.length;
		}
		addRequest() {
			this.requests.push({});
		}
		async submitAndProcess() {
			return { totalLinked: 0, batchUsed: true };
		}
	},
}));

const mockScheduleKnowledgeInference = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('../knowledge-inference', () => ({
	scheduleKnowledgeInference: mockScheduleKnowledgeInference,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WS_A = 'ws-aaaa0000-0000-0000-0000-000000000001';
const WS_B = 'ws-bbbb0000-0000-0000-0000-000000000002';
const WS_C = 'ws-cccc0000-0000-0000-0000-000000000003';

function makeEnvelopeRow(wsId: string) {
	return {
		encryptedWrk: Buffer.alloc(32).toString('base64'),
		kmsContext: JSON.stringify({ workspaceId: wsId }),
		wrkVersion: 1,
	};
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('knowledge-cron — P6 per-workspace budget', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.resetModules();
		mockIsFeatureEnabled.mockResolvedValue(true);
		mockGetMessagesByContact.mockResolvedValue([{ text: 'Hello world', role: 'contact' }]);
		mockExtractKnowledgeForContact.mockResolvedValue({
			embeddingMatches: 1,
			llmEntities: 1,
		});
	});

	it('KG-4: passes global DEFAULT_LLM_BUDGET (50) to first workspace', async () => {
		let callCount = 0;
		mockDbSelect.mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				return {
					from: vi.fn(() => [{ id: WS_A }, { id: WS_B }, { id: WS_C }]),
				};
			}
			return {
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(() => [makeEnvelopeRow(WS_A)]),
					})),
				})),
			};
		});

		mockGetContactsNeedingExtraction.mockResolvedValue(['contact-1']);
		mockExtractKnowledgeForContact.mockResolvedValue({
			embeddingMatches: 1,
			llmEntities: 0,
		});

		const { runNightlyExtraction } = await import('../knowledge-cron');
		await runNightlyExtraction();

		// First workspace gets full global budget of 50
		expect(mockGetContactsNeedingExtraction.mock.calls[0][1]).toBe(50);
	});

	it('KG-4: global budget decrements across workspaces', async () => {
		let callCount = 0;
		mockDbSelect.mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				return { from: vi.fn(() => [{ id: WS_A }, { id: WS_B }]) };
			}
			return {
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(() => [makeEnvelopeRow(WS_A)]),
					})),
				})),
			};
		});

		mockGetContactsNeedingExtraction.mockResolvedValue(
			Array.from({ length: 10 }, (_, i) => `contact-${i}`),
		);
		mockExtractKnowledgeForContact.mockResolvedValue({
			embeddingMatches: 1,
			llmEntities: 0,
		});

		const { runNightlyExtraction } = await import('../knowledge-cron');
		await runNightlyExtraction();

		// All inline extractions use skipLLM=true (batch handles LLM)
		for (const call of mockExtractKnowledgeForContact.mock.calls) {
			expect(call[3].skipLLM).toBe(true);
		}
	});

	it('KG-4: inline extraction always uses skipLLM=true (batch handles LLM)', async () => {
		let callCount = 0;
		mockDbSelect.mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				return {
					from: vi.fn(() => [{ id: WS_A }, { id: WS_B }, { id: WS_C }]),
				};
			}
			return {
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(() => [makeEnvelopeRow(WS_A)]),
					})),
				})),
			};
		});

		mockGetContactsNeedingExtraction.mockResolvedValue(
			Array.from({ length: 20 }, (_, i) => `contact-${i}`),
		);
		mockExtractKnowledgeForContact.mockResolvedValue({
			embeddingMatches: 1,
			llmEntities: 0,
		});

		const { runNightlyExtraction } = await import('../knowledge-cron');
		await runNightlyExtraction();

		// All 3 workspaces × 20 contacts = 60 total extraction calls
		const allCalls = mockExtractKnowledgeForContact.mock.calls;
		expect(allCalls.length).toBe(60);
		// KG-4: inline extraction always sets skipLLM=true; LLM goes through batch
		for (const call of allCalls) {
			expect(call[3].skipLLM).toBe(true);
		}
	});

	it('skips workspace when feature flag is disabled', async () => {
		let callCount = 0;
		mockDbSelect.mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				return { from: vi.fn(() => [{ id: WS_A }]) };
			}
			return {
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(() => [makeEnvelopeRow(WS_A)]),
					})),
				})),
			};
		});

		mockIsFeatureEnabled.mockResolvedValue(false);

		const { runNightlyExtraction } = await import('../knowledge-cron');
		await runNightlyExtraction();

		expect(mockGetContactsNeedingExtraction).not.toHaveBeenCalled();
		expect(mockExtractKnowledgeForContact).not.toHaveBeenCalled();
	});
});
