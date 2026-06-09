import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockIsFeatureEnabled = vi.hoisted(() => vi.fn());
const mockHasWorkspaceAiAnalysisConsent = vi.hoisted(() => vi.fn());
const mockGetContactsNeedingExtraction = vi.hoisted(() => vi.fn());
const mockGetKnowledgeAnalysisContactCandidates = vi.hoisted(() => vi.fn());
const mockGetMessagesByContact = vi.hoisted(() => vi.fn());
const mockGetKnowledgeNode = vi.hoisted(() => vi.fn());
const mockLinkContactToKnowledge = vi.hoisted(() => vi.fn());
const mockUpdateKnowledgeBackfillProgress = vi.hoisted(() => vi.fn());
const mockUpsertExtractionLog = vi.hoisted(() => vi.fn());
const mockDbSelect = vi.hoisted(() => vi.fn());
const mockDbExecute = vi.hoisted(() => vi.fn());
const mockWithWorkspaceRLS = vi.hoisted(() => vi.fn());
const mockKnowledgeAnalysisQueueAdd = vi.hoisted(() => vi.fn());
const mockKnowledgeAnalysisWorkerOn = vi.hoisted(() => vi.fn());
const workerState = vi.hoisted(() => ({
	knowledgeAnalysisProcessor: undefined as undefined | ((job: unknown) => Promise<unknown>),
}));

vi.mock('bullmq', () => ({
	// biome-ignore lint/complexity/useArrowFunction: Vitest 4 class mocks must be constructible.
	Queue: vi.fn(function () {
		return { add: mockKnowledgeAnalysisQueueAdd };
	}),
	// biome-ignore lint/complexity/useArrowFunction: Vitest 4 class mocks must be constructible.
	Worker: vi.fn(function (_name: string, processor: (job: unknown) => Promise<unknown>) {
		workerState.knowledgeAnalysisProcessor = processor;
		return { on: mockKnowledgeAnalysisWorkerOn };
	}),
}));

vi.mock('../../redis', () => ({ connection: {} }));

vi.mock('@repo/db', () => ({
	db: {
		select: mockDbSelect,
		execute: mockDbExecute,
	},
	and: vi.fn((...conditions: unknown[]) => conditions),
	eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
	isFeatureEnabled: mockIsFeatureEnabled,
	hasWorkspaceAiAnalysisConsent: mockHasWorkspaceAiAnalysisConsent,
	getContactsNeedingExtraction: mockGetContactsNeedingExtraction,
	getKnowledgeAnalysisContactCandidates: mockGetKnowledgeAnalysisContactCandidates,
	getKnowledgeNode: mockGetKnowledgeNode,
	getMessagesByContact: mockGetMessagesByContact,
	updateKnowledgeBackfillProgress: mockUpdateKnowledgeBackfillProgress,
	upsertExtractionLog: mockUpsertExtractionLog,
	knowledgeEvidence: {
		workspaceId: 'workspaceId',
		knowledgeNodeId: 'knowledgeNodeId',
		messageId: 'messageId',
		contactId: 'contactId',
	},
	linkContactToKnowledge: mockLinkContactToKnowledge,
	sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
	withWorkspaceRLS: mockWithWorkspaceRLS,
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
const mockKeywordPreFilter = vi.hoisted(() => vi.fn((_texts: string[]) => true));

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
		vi.unstubAllEnvs();
		vi.resetModules();
		mockIsFeatureEnabled.mockResolvedValue(true);
		mockHasWorkspaceAiAnalysisConsent.mockResolvedValue(true);
		mockGetKnowledgeAnalysisContactCandidates.mockResolvedValue([]);
		mockGetMessagesByContact.mockResolvedValue([{ text: 'Hello world', role: 'contact' }]);
		mockUpdateKnowledgeBackfillProgress.mockResolvedValue(undefined);
		mockUpsertExtractionLog.mockResolvedValue(undefined);
		mockGetKnowledgeNode.mockResolvedValue(null);
		mockLinkContactToKnowledge.mockResolvedValue(undefined);
		mockDbExecute.mockResolvedValue([]);
		mockWithWorkspaceRLS.mockImplementation(
			async (_workspaceId: string, fn: () => Promise<unknown>) => fn(),
		);
		mockKnowledgeAnalysisQueueAdd.mockResolvedValue({ id: 'queued-job' });
		workerState.knowledgeAnalysisProcessor = undefined;
		mockDbSelect.mockImplementation(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					limit: vi.fn(() => [makeEnvelopeRow(WS_A)]),
				})),
			})),
		}));
		mockExtractKnowledgeForContact.mockResolvedValue({
			embeddingMatches: 1,
			llmEntities: 1,
		});
	});

	it('queues debounced incremental analysis for small syncs', async () => {
		vi.stubEnv('KNOWLEDGE_SYNC_INCREMENTAL_DELAY_MS', '1234');
		vi.stubEnv('KNOWLEDGE_SYNC_INCREMENTAL_CONTACT_LIMIT', '12');

		const { scheduleKnowledgeAnalysis } = await import('../knowledge-cron');
		const result = await scheduleKnowledgeAnalysis({
			workspaceId: WS_A,
			reason: 'small_sync',
		});

		expect(result).toEqual({
			jobId: 'knowledge-analysis-small-sync-ws-aaaa0000-0000-0000-0000-000000000001',
			mode: 'incremental',
			limit: 12,
		});
		expect(mockKnowledgeAnalysisQueueAdd).toHaveBeenCalledWith(
			'run-knowledge-analysis',
			expect.objectContaining({
				workspaceId: WS_A,
				mode: 'incremental',
				limit: 12,
				reason: 'small_sync',
			}),
			expect.objectContaining({
				jobId: 'knowledge-analysis-small-sync-ws-aaaa0000-0000-0000-0000-000000000001',
				delay: 1234,
			}),
		);
	});

	it('queues one full analysis per completed import run', async () => {
		vi.stubEnv('KNOWLEDGE_IMPORT_COMPLETION_DELAY_MS', '5');
		vi.stubEnv('KNOWLEDGE_IMPORT_FULL_CONTACT_LIMIT', '321');

		const { scheduleKnowledgeAnalysis } = await import('../knowledge-cron');
		const result = await scheduleKnowledgeAnalysis({
			workspaceId: WS_A,
			reason: 'history_import_completed',
			runId: 'run:with:colons',
		});

		expect(result).toEqual({
			jobId:
				'knowledge-analysis-history_import_completed-ws-aaaa0000-0000-0000-0000-000000000001-run_with_colons',
			mode: 'full',
			limit: 321,
		});
		expect(mockKnowledgeAnalysisQueueAdd).toHaveBeenCalledWith(
			'run-knowledge-analysis',
			expect.objectContaining({
				workspaceId: WS_A,
				mode: 'full',
				limit: 321,
				reason: 'history_import_completed',
				runId: 'run:with:colons',
			}),
			expect.objectContaining({
				jobId:
					'knowledge-analysis-history_import_completed-ws-aaaa0000-0000-0000-0000-000000000001-run_with_colons',
				delay: 5,
			}),
		);
	});

	it('adds batch suffixes for resumable import backfill continuations', async () => {
		const { scheduleKnowledgeAnalysis } = await import('../knowledge-cron');
		const result = await scheduleKnowledgeAnalysis({
			workspaceId: WS_A,
			reason: 'history_import_completed',
			runId: 'run-1',
			batch: 2,
			delayMs: 0,
		});

		expect(result?.jobId).toBe(
			'knowledge-analysis-history_import_completed-ws-aaaa0000-0000-0000-0000-000000000001-run-1-batch-2',
		);
		expect(mockKnowledgeAnalysisQueueAdd).toHaveBeenCalledWith(
			'run-knowledge-analysis',
			expect.objectContaining({
				workspaceId: WS_A,
				mode: 'full',
				reason: 'history_import_completed',
				runId: 'run-1',
				batch: 2,
			}),
			expect.objectContaining({
				jobId:
					'knowledge-analysis-history_import_completed-ws-aaaa0000-0000-0000-0000-000000000001-run-1-batch-2',
			}),
		);
	});

	it('resumes full backfill from the oldest scanned message cursor', async () => {
		vi.stubEnv('KNOWLEDGE_IMPORT_FULL_MESSAGES_PER_CONTACT_LIMIT', '200');
		const cursor = new Date('2026-06-02T12:00:00.000Z');
		const olderMessageAt = new Date('2026-06-01T12:00:00.000Z');
		mockGetKnowledgeAnalysisContactCandidates.mockResolvedValue([
			{
				id: 'contact-old',
				messageCount: 350,
				stale: false,
				backfillOldestMessageAt: cursor,
				backfillCompletedAt: null,
			},
		]);
		mockGetMessagesByContact.mockResolvedValue([
			{
				id: 'msg-old',
				text: 'term sheet diligence next week',
				sentAt: olderMessageAt,
			},
		]);

		const { runKnowledgeAnalysis } = await import('../knowledge-cron');
		const result = await runKnowledgeAnalysis({
			workspaceId: WS_A,
			mode: 'full',
			limit: 10,
		});

		expect(mockGetMessagesByContact).toHaveBeenCalledWith(
			WS_A,
			'contact-old',
			expect.anything(),
			expect.objectContaining({
				limit: 200,
				beforeSentAt: cursor,
			}),
		);
		expect(mockUpdateKnowledgeBackfillProgress).toHaveBeenCalledWith(
			WS_A,
			'contact-old',
			expect.objectContaining({
				oldestMessageAt: olderMessageAt,
				messagesScanned: 1,
				completedAt: expect.any(Date),
			}),
		);
		expect(result.messagesScanned).toBe(1);
		expect(result.backfillContactsCompleted).toBe(1);
		expect(result.backfillRemainingContacts).toBe(0);
	});

	it('uses the full backfill cursor even when the contact is still stale', async () => {
		vi.stubEnv('KNOWLEDGE_IMPORT_FULL_MESSAGES_PER_CONTACT_LIMIT', '200');
		const cursor = new Date('2026-06-02T12:00:00.000Z');
		const olderMessageAt = new Date('2026-06-01T12:00:00.000Z');
		mockGetKnowledgeAnalysisContactCandidates.mockResolvedValue([
			{
				id: 'contact-stale-old',
				messageCount: 500,
				stale: true,
				backfillOldestMessageAt: cursor,
				backfillOldestMessageId: '00000000-0000-0000-0000-000000000123',
				backfillCompletedAt: null,
			},
		]);
		mockGetMessagesByContact.mockResolvedValue([
			{
				id: 'msg-stale-old',
				text: 'term sheet diligence next week',
				sentAt: olderMessageAt,
			},
		]);

		const { runKnowledgeAnalysis } = await import('../knowledge-cron');
		await runKnowledgeAnalysis({
			workspaceId: WS_A,
			mode: 'full',
			limit: 10,
		});

		expect(mockGetMessagesByContact).toHaveBeenCalledWith(
			WS_A,
			'contact-stale-old',
			expect.anything(),
			expect.objectContaining({
				limit: 200,
				beforeSentAt: cursor,
				beforeMessageId: '00000000-0000-0000-0000-000000000123',
			}),
		);
	});

	it('does not advance historical backfill progress for completed stale contacts', async () => {
		vi.stubEnv('KNOWLEDGE_IMPORT_FULL_MESSAGES_PER_CONTACT_LIMIT', '200');
		const cursor = new Date('2026-06-02T12:00:00.000Z');
		mockGetKnowledgeAnalysisContactCandidates.mockResolvedValue([
			{
				id: 'contact-complete-stale',
				messageCount: 500,
				stale: true,
				backfillOldestMessageAt: cursor,
				backfillCompletedAt: new Date('2026-06-02T12:30:00.000Z'),
			},
		]);
		mockGetMessagesByContact.mockResolvedValue([
			{
				id: 'msg-latest',
				text: 'term sheet diligence next week',
				sentAt: new Date('2026-06-03T12:00:00.000Z'),
			},
		]);

		const { runKnowledgeAnalysis } = await import('../knowledge-cron');
		await runKnowledgeAnalysis({
			workspaceId: WS_A,
			mode: 'full',
			limit: 10,
		});

		expect(mockGetMessagesByContact).toHaveBeenCalledWith(
			WS_A,
			'contact-complete-stale',
			expect.anything(),
			expect.objectContaining({
				limit: 200,
				beforeSentAt: undefined,
			}),
		);
		expect(mockUpdateKnowledgeBackfillProgress).not.toHaveBeenCalled();
	});

	it('runs import continuation batches without defaulting to another LLM budget', async () => {
		vi.stubEnv('KNOWLEDGE_LLM_PROVIDER', 'local');
		mockGetKnowledgeAnalysisContactCandidates.mockResolvedValue([
			{
				id: 'contact-continuation',
				messageCount: 250,
				stale: false,
				backfillOldestMessageAt: new Date('2026-06-02T12:00:00.000Z'),
				backfillCompletedAt: null,
			},
		]);
		mockGetMessagesByContact.mockResolvedValue([
			{
				id: 'msg-continuation',
				text: 'term sheet diligence next week',
				sentAt: new Date('2026-06-01T12:00:00.000Z'),
			},
		]);

		await import('../knowledge-cron');
		const processor = workerState.knowledgeAnalysisProcessor;
		expect(processor).toBeDefined();
		const result = (await processor?.({
			data: {
				workspaceId: WS_A,
				mode: 'full',
				limit: 10,
				reason: 'history_import_completed',
				runId: 'run-1',
				batch: 1,
				requestedAt: new Date().toISOString(),
			},
		})) as { llmQueued?: number };

		expect(result.llmQueued).toBe(0);
	});

	it('can disable post-sync analysis scheduling without blocking manual analysis', async () => {
		vi.stubEnv('KNOWLEDGE_POST_SYNC_ANALYSIS_ENABLED', 'false');

		const { scheduleKnowledgeAnalysis } = await import('../knowledge-cron');
		const skipped = await scheduleKnowledgeAnalysis({
			workspaceId: WS_A,
			reason: 'small_sync',
		});
		const manual = await scheduleKnowledgeAnalysis({
			workspaceId: WS_A,
			reason: 'manual',
			mode: 'full',
			delayMs: 0,
		});

		expect(skipped).toBeNull();
		expect(manual).toEqual(
			expect.objectContaining({
				mode: 'full',
				limit: 50,
			}),
		);
		expect(mockKnowledgeAnalysisQueueAdd).toHaveBeenCalledTimes(1);
		expect(mockKnowledgeAnalysisQueueAdd).toHaveBeenCalledWith(
			'run-knowledge-analysis',
			expect.objectContaining({ reason: 'manual', mode: 'full' }),
			expect.objectContaining({ delay: 0 }),
		);
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

	it('reports local LLM estimates without cloud wording', async () => {
		vi.stubEnv('KNOWLEDGE_LLM_PROVIDER', 'local');
		mockGetKnowledgeAnalysisContactCandidates.mockResolvedValue([
			{ id: 'contact-1', messageCount: 10, stale: true },
			{ id: 'contact-2', messageCount: 3, stale: true },
		]);

		const { estimateKnowledgeAnalysis } = await import('../knowledge-cron');
		const estimate = await estimateKnowledgeAnalysis(WS_A, {
			mode: 'incremental',
			limit: 10,
		});

		expect(estimate.llmRequestsEstimated).toBe(2);
		expect(estimate.embeddingProviderMode).toBe('cloud');
		expect(estimate.embeddingProviderLabel).toBe('OpenAI cloud embeddings');
		expect(estimate.llmProviderMode).toBe('local');
		expect(estimate.llmProviderLabel).toBe('local LLM');
	});

	it('uses the keyword filter for LLM estimates so progress does not over-wait', async () => {
		vi.stubEnv('KNOWLEDGE_LLM_PROVIDER', 'local');
		mockGetKnowledgeAnalysisContactCandidates.mockResolvedValue([
			{ id: 'contact-1', messageCount: 10, stale: true },
			{ id: 'contact-2', messageCount: 7, stale: true },
			{ id: 'contact-3', messageCount: 4, stale: true },
		]);
		mockGetMessagesByContact.mockImplementation(async (_workspaceId, contactId) => {
			if (contactId === 'contact-2') return [{ text: 'general catch up', role: 'contact' }];
			return [{ text: 'term sheet diligence next week', role: 'contact' }];
		});
		mockKeywordPreFilter.mockImplementation((texts: string[]) =>
			texts.some((text) => text.includes('term sheet')),
		);

		const { estimateKnowledgeAnalysis } = await import('../knowledge-cron');
		const estimate = await estimateKnowledgeAnalysis(WS_A, {
			mode: 'incremental',
			limit: 10,
		});

		expect(estimate.llmRequestsEstimated).toBe(2);
		expect(mockGetMessagesByContact).toHaveBeenCalledTimes(3);
	});

	it('reports Nomic local embedding estimates for local KG setup', async () => {
		vi.stubEnv('KNOWLEDGE_EMBEDDING_PROVIDER', 'local');
		vi.stubEnv('KNOWLEDGE_EMBEDDING_MODEL', 'nomic-embed-text');
		mockGetKnowledgeAnalysisContactCandidates.mockResolvedValue([
			{ id: 'contact-1', messageCount: 10, stale: true },
		]);

		const { estimateKnowledgeAnalysis } = await import('../knowledge-cron');
		const estimate = await estimateKnowledgeAnalysis(WS_A, {
			mode: 'incremental',
			limit: 10,
		});

		expect(estimate.embeddingProviderMode).toBe('local');
		expect(estimate.embeddingProviderLabel).toBe('Nomic local embeddings');
	});

	it('does not estimate LLM calls when KG LLM extraction is disabled', async () => {
		vi.stubEnv('KNOWLEDGE_LLM_PROVIDER', 'disabled');
		mockGetKnowledgeAnalysisContactCandidates.mockResolvedValue([
			{ id: 'contact-1', messageCount: 10, stale: true },
		]);

		const { estimateKnowledgeAnalysis } = await import('../knowledge-cron');
		const estimate = await estimateKnowledgeAnalysis(WS_A, {
			mode: 'incremental',
			limit: 10,
		});

		expect(estimate.llmRequestsEstimated).toBe(0);
		expect(estimate.llmProviderMode).toBe('disabled');
		expect(estimate.llmProviderLabel).toBe('LLM disabled');
	});

	it('retries manual evidence node lookup before treating the node as missing', async () => {
		const nodeId = 'node-lookup-retry';
		const node = {
			id: nodeId,
			workspaceId: WS_A,
			type: 'topic',
			name: 'local ai testing',
			displayName: 'Local AI Testing',
			description: null,
		};
		mockGetKnowledgeNode.mockResolvedValueOnce(null).mockResolvedValueOnce(node);
		mockGetKnowledgeAnalysisContactCandidates.mockResolvedValue([]);
		mockDbExecute.mockResolvedValue([
			{
				total_evidence_rows: 1,
				total_evidence_contacts: 0,
				total_evidence_messages: 0,
			},
		]);
		mockDbSelect.mockImplementation((selection?: Record<string, unknown>) => {
			if (selection && 'messageId' in selection) {
				return {
					from: vi.fn(() => ({
						where: vi.fn(() => []),
					})),
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

		const { runManualKnowledgeEvidenceBuild } = await import('../knowledge-cron');
		const result = await runManualKnowledgeEvidenceBuild({
			workspaceId: WS_A,
			nodeId,
			limit: 5,
			maxEvidence: 5,
		});

		expect(mockGetKnowledgeNode).toHaveBeenCalledTimes(2);
		expect(result.skippedReason).toBeUndefined();
		expect(result.totalEvidenceRows).toBe(1);
	});
});
