import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockUnwrapWrk = vi.hoisted(() => vi.fn());
const mockDeriveKeys = vi.hoisted(() => vi.fn());
const mockDecrypt = vi.hoisted(() => vi.fn());
const mockMaskEntities = vi.hoisted(() => vi.fn());

const mockCreateDecision = vi.hoisted(() => vi.fn());
const mockCreateEdge = vi.hoisted(() => vi.fn());
const mockFindRecentDecision = vi.hoisted(() => vi.fn());
const mockFindSimilarDecisions = vi.hoisted(() => vi.fn());
const mockFindDecisionByEntityId = vi.hoisted(() => vi.fn());
const mockGetMessagesByContact = vi.hoisted(() => vi.fn());

const mockGenerateEmbedding = vi.hoisted(() => vi.fn());
const mockPrefilterEntities = vi.hoisted(() => vi.fn());

const processorStore = vi.hoisted(() => ({
	fn: null as ((job: unknown) => Promise<unknown>) | null,
}));

vi.mock('@repo/crypto', () => ({
	unwrapWrk: mockUnwrapWrk,
	deriveKeys: mockDeriveKeys,
	decrypt: mockDecrypt,
	maskEntities: mockMaskEntities,
}));

vi.mock('@repo/db', () => ({
	createDecision: mockCreateDecision,
	createEdge: mockCreateEdge,
	findRecentDecision: mockFindRecentDecision,
	findSimilarDecisions: mockFindSimilarDecisions,
	findDecisionByEntityId: mockFindDecisionByEntityId,
	getMessagesByContact: mockGetMessagesByContact,
}));

vi.mock('bullmq', () => ({
	Worker: vi.fn((_name: string, processor: unknown) => {
		processorStore.fn = processor as (job: unknown) => Promise<unknown>;
		return { on: vi.fn() };
	}),
	Queue: vi.fn(() => ({ add: vi.fn(), on: vi.fn() })),
}));

vi.mock('../../ai/embeddings', () => ({
	generateEmbedding: mockGenerateEmbedding,
}));

vi.mock('../../ai/prefilter', () => ({
	prefilterEntities: mockPrefilterEntities,
}));

vi.mock('../../redis', () => ({
	connection: {},
}));

await import('../decision-recording');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WS = 'ws-00000000-0000-0000-0000-000000000001';
const USER_ID = 'usr-00000000-0000-0000-0000-000000000001';
const CONTACT_ID = 'con-00000000-0000-0000-0000-000000000001';
const DECISION_ID = 'dec-00000000-0000-0000-0000-000000000001';

const fakeKeyEnvelope = {
	encryptedWrk: Buffer.from('fake-wrk').toString('base64'),
	kmsContext: { WorkspaceID: WS },
	wrkVersion: 1,
};

const fakeKeys = {
	dek: Buffer.alloc(32),
	bik: Buffer.alloc(32),
	tsk: Buffer.alloc(32),
};

const fakeEmbedding = [0.1, 0.2, 0.3];

function makeJob(data: Record<string, unknown>) {
	return { data, id: 'job-1' };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('decision-recording worker', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUnwrapWrk.mockResolvedValue(Buffer.alloc(32));
		mockDeriveKeys.mockResolvedValue(fakeKeys);
		mockDecrypt.mockImplementation((content: string) => content);
		mockMaskEntities.mockImplementation((text: string) => ({ maskedText: text, entityMap: [] }));
		mockPrefilterEntities.mockReturnValue([]);
		mockGenerateEmbedding.mockResolvedValue(fakeEmbedding);
		mockCreateDecision.mockResolvedValue({ id: DECISION_ID, workspaceId: WS });
		mockCreateEdge.mockResolvedValue({});
		mockFindRecentDecision.mockResolvedValue(null);
		mockFindSimilarDecisions.mockResolvedValue([]);
	});

	it('captures the worker processor', () => {
		expect(processorStore.fn).not.toBeNull();
	});

	// ── Explicit decision (web hook path) ─────────────────────────────────────

	describe('explicit decision (web hook)', () => {
		it('records an explicit decision with envelope', async () => {
			await processorStore.fn!(
				makeJob({
					workspaceId: WS,
					userId: USER_ID,
					contactId: CONTACT_ID,
					keyEnvelope: fakeKeyEnvelope,
					decisionType: 'commitment',
					label: 'Committed to weekly sync',
				}),
			);

			expect(mockUnwrapWrk).toHaveBeenCalled();
			expect(mockDeriveKeys).toHaveBeenCalled();
			expect(mockCreateDecision).toHaveBeenCalledWith(
				WS,
				expect.objectContaining({
					userId: USER_ID,
					rawContent: 'Committed to weekly sync',
					decisionType: 'commitment',
					embedding: fakeEmbedding,
				}),
				expect.objectContaining({ wrkVersion: 1 }),
			);
		});

		it('ELM-masks label before embedding (SEC-122)', async () => {
			mockPrefilterEntities.mockReturnValue([
				{ text: 'alice@test.com', type: 'EMAIL', start: 0, end: 14 },
			]);
			mockMaskEntities.mockReturnValue({
				maskedText: 'EMAIL_a1b2c3d4 committed to deal',
				entityMap: [],
			});

			await processorStore.fn!(
				makeJob({
					workspaceId: WS,
					userId: USER_ID,
					contactId: CONTACT_ID,
					keyEnvelope: fakeKeyEnvelope,
					decisionType: 'commitment',
					label: 'alice@test.com committed to deal',
				}),
			);

			expect(mockPrefilterEntities).toHaveBeenCalledWith('alice@test.com committed to deal');
			expect(mockMaskEntities).toHaveBeenCalled();
			expect(mockGenerateEmbedding).toHaveBeenCalledWith('EMAIL_a1b2c3d4 committed to deal');
		});

		it('skips when keyEnvelope is missing', async () => {
			await processorStore.fn!(
				makeJob({
					workspaceId: WS,
					userId: USER_ID,
					decisionType: 'commitment',
					label: 'test',
				}),
			);

			expect(mockCreateDecision).not.toHaveBeenCalled();
		});

		it('skips when label is missing', async () => {
			await processorStore.fn!(
				makeJob({
					workspaceId: WS,
					userId: USER_ID,
					contactId: CONTACT_ID,
					keyEnvelope: fakeKeyEnvelope,
					decisionType: 'commitment',
				}),
			);

			expect(mockCreateDecision).not.toHaveBeenCalled();
		});

		it('includes entityId in decision metadata', async () => {
			await processorStore.fn!(
				makeJob({
					workspaceId: WS,
					userId: USER_ID,
					contactId: CONTACT_ID,
					keyEnvelope: fakeKeyEnvelope,
					decisionType: 'purchase',
					label: 'Closed the deal',
					entityId: 'deal-123',
				}),
			);

			expect(mockCreateDecision).toHaveBeenCalledWith(
				WS,
				expect.objectContaining({ entityId: 'deal-123' }),
				expect.anything(),
			);
		});
	});

	// ── Pipeline decision (message classification) ────────────────────────────

	describe('pipeline decision (message classification)', () => {
		const pipelineBase = {
			workspaceId: WS,
			userId: USER_ID,
			contactId: CONTACT_ID,
			keyEnvelope: fakeKeyEnvelope,
			workspaceSalt: Buffer.alloc(32).toString('hex'),
		};

		it('classifies commitment keywords from outgoing messages', async () => {
			await processorStore.fn!(
				makeJob({
					...pipelineBase,
					messages: [
						{
							role: 'user',
							content: 'I will send the proposal tomorrow',
							timestamp: '2026-03-04T10:00:00Z',
						},
					],
				}),
			);

			expect(mockCreateDecision).toHaveBeenCalledWith(
				WS,
				expect.objectContaining({ decisionType: 'commitment' }),
				expect.anything(),
			);
		});

		it('classifies dismissal keywords from outgoing messages', async () => {
			await processorStore.fn!(
				makeJob({
					...pipelineBase,
					messages: [
						{
							role: 'outgoing',
							content: 'No thanks, we decline this one',
							timestamp: '2026-03-04T10:00:00Z',
						},
					],
				}),
			);

			expect(mockCreateDecision).toHaveBeenCalledWith(
				WS,
				expect.objectContaining({ decisionType: 'dismissal' }),
				expect.anything(),
			);
		});

		it('skips incoming messages (only classifies user/outgoing)', async () => {
			await processorStore.fn!(
				makeJob({
					...pipelineBase,
					messages: [
						{ role: 'assistant', content: 'I will do it', timestamp: '2026-03-04T10:00:00Z' },
					],
				}),
			);

			expect(mockCreateDecision).not.toHaveBeenCalled();
		});

		it('skips messages without decision keywords', async () => {
			await processorStore.fn!(
				makeJob({
					...pipelineBase,
					messages: [
						{ role: 'user', content: 'Hello, how are you?', timestamp: '2026-03-04T10:00:00Z' },
					],
				}),
			);

			expect(mockCreateDecision).not.toHaveBeenCalled();
		});

		it('decrypts messages from payload (SEC-006)', async () => {
			await processorStore.fn!(
				makeJob({
					...pipelineBase,
					messages: [
						{
							role: 'user',
							content: 'encrypted-content-will-do',
							timestamp: '2026-03-04T10:00:00Z',
						},
					],
				}),
			);

			expect(mockDecrypt).toHaveBeenCalledWith('encrypted-content-will-do', fakeKeys.dek);
		});

		it('ELM-masks each message before embedding (SEC-122)', async () => {
			mockDecrypt.mockReturnValue('I will handle alice@test.com deal');
			mockPrefilterEntities.mockReturnValue([
				{ text: 'alice@test.com', type: 'EMAIL', start: 15, end: 29 },
			]);

			await processorStore.fn!(
				makeJob({
					...pipelineBase,
					messages: [{ role: 'user', content: 'encrypted', timestamp: '2026-03-04T10:00:00Z' }],
				}),
			);

			expect(mockPrefilterEntities).toHaveBeenCalled();
			expect(mockMaskEntities).toHaveBeenCalled();
		});

		it('skips when no messages provided', async () => {
			await processorStore.fn!(
				makeJob({
					...pipelineBase,
					messages: [],
				}),
			);

			expect(mockCreateDecision).not.toHaveBeenCalled();
		});

		it('skips when no keyEnvelope for pipeline path', async () => {
			await processorStore.fn!(
				makeJob({
					workspaceId: WS,
					userId: USER_ID,
					contactId: CONTACT_ID,
					workspaceSalt: Buffer.alloc(32).toString('hex'),
					messages: [{ role: 'user', content: 'I will do it', timestamp: '2026-03-04T10:00:00Z' }],
				}),
			);

			expect(mockCreateDecision).not.toHaveBeenCalled();
		});

		it('skips when no workspaceSalt', async () => {
			await processorStore.fn!(
				makeJob({
					workspaceId: WS,
					userId: USER_ID,
					contactId: CONTACT_ID,
					keyEnvelope: fakeKeyEnvelope,
					messages: [{ role: 'user', content: 'I will do it', timestamp: '2026-03-04T10:00:00Z' }],
				}),
			);

			expect(mockCreateDecision).not.toHaveBeenCalled();
		});
	});

	// ── Edge creation (Phase 2) ───────────────────────────────────────────────

	describe('edge creation', () => {
		const explicitJob = {
			workspaceId: WS,
			userId: USER_ID,
			contactId: CONTACT_ID,
			keyEnvelope: fakeKeyEnvelope,
			decisionType: 'commitment' as const,
			label: 'Test decision',
		};

		it('creates a temporal edge to the most recent prior decision within 24h', async () => {
			const recentId = 'recent-decision-id';
			mockFindRecentDecision.mockResolvedValue({ id: recentId, createdAt: new Date() });

			await processorStore.fn!(makeJob(explicitJob));

			expect(mockFindRecentDecision).toHaveBeenCalledWith(WS, {
				excludeId: DECISION_ID,
				withinHours: 24,
			});
			expect(mockCreateEdge).toHaveBeenCalledWith(WS, {
				sourceId: recentId,
				targetId: DECISION_ID,
				edgeType: 'temporal',
				weight: 0.3,
				confidenceScore: 0.5,
			});
		});

		it('skips temporal edge when no recent decision found', async () => {
			mockFindRecentDecision.mockResolvedValue(null);

			await processorStore.fn!(makeJob(explicitJob));

			expect(mockCreateEdge).not.toHaveBeenCalledWith(
				WS,
				expect.objectContaining({ edgeType: 'temporal' }),
			);
		});

		it('creates semantic edges for similar decisions (cosine > 0.85)', async () => {
			mockFindSimilarDecisions.mockResolvedValue([
				{ id: 'similar-1', similarity: 0.92 },
				{ id: 'similar-2', similarity: 0.87 },
			]);

			await processorStore.fn!(makeJob(explicitJob));

			expect(mockFindSimilarDecisions).toHaveBeenCalledWith(WS, fakeEmbedding, {
				excludeId: DECISION_ID,
				minSimilarity: 0.85,
				limit: 3,
			});

			// Semantic edge weight = similarity * 0.5
			expect(mockCreateEdge).toHaveBeenCalledWith(WS, {
				sourceId: 'similar-1',
				targetId: DECISION_ID,
				edgeType: 'semantic',
				weight: 0.92 * 0.5,
				confidenceScore: 0.92,
			});
			expect(mockCreateEdge).toHaveBeenCalledWith(WS, {
				sourceId: 'similar-2',
				targetId: DECISION_ID,
				edgeType: 'semantic',
				weight: 0.87 * 0.5,
				confidenceScore: 0.87,
			});
		});

		it('skips semantic edges when no similar decisions found', async () => {
			mockFindSimilarDecisions.mockResolvedValue([]);

			await processorStore.fn!(makeJob(explicitJob));

			expect(mockCreateEdge).not.toHaveBeenCalledWith(
				WS,
				expect.objectContaining({ edgeType: 'semantic' }),
			);
		});

		it('handles temporal edge creation failure gracefully', async () => {
			mockFindRecentDecision.mockRejectedValue(new Error('DB error'));

			// Should not throw
			await processorStore.fn!(makeJob(explicitJob));
			expect(mockCreateDecision).toHaveBeenCalled();
		});

		it('handles semantic edge creation failure gracefully', async () => {
			mockFindSimilarDecisions.mockRejectedValue(new Error('DB error'));

			// Should not throw
			await processorStore.fn!(makeJob(explicitJob));
			expect(mockCreateDecision).toHaveBeenCalled();
		});
	});
});
