import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockDbSelect = vi.hoisted(() => vi.fn());
const mockGenerateEmbedding = vi.hoisted(() => vi.fn());
const mockHasUserAiAnalysisConsent = vi.hoisted(() => vi.fn());
const mockIsWorkspaceMember = vi.hoisted(() => vi.fn());
const mockAppendAuditLog = vi.hoisted(() => vi.fn());
const mockGetMessageCount = vi.hoisted(() => vi.fn());
const mockRunKnowledgeAnalysis = vi.hoisted(() => vi.fn());
const mockRunManualKnowledgeEvidenceBuild = vi.hoisted(() => vi.fn());
const mockRunKnowledgeInference = vi.hoisted(() => vi.fn());
const mockScheduleAIPipeline = vi.hoisted(() => vi.fn());

vi.mock('@repo/db', () => ({
	appendAuditLog: mockAppendAuditLog,
	contacts: { id: 'id', workspaceId: 'workspaceId' },
	db: { select: mockDbSelect },
	eq: vi.fn(),
	getMessageCount: mockGetMessageCount,
	getMessagesByContact: vi.fn(),
	hasUserAiAnalysisConsent: mockHasUserAiAnalysisConsent,
	isWorkspaceMember: mockIsWorkspaceMember,
	sql: vi.fn(),
	workspaces: {
		id: 'id',
		encryptedWrk: 'encryptedWrk',
		kmsContext: 'kmsContext',
		wrkVersion: 'wrkVersion',
	},
}));

vi.mock('../../ai/embeddings', () => ({
	generateEmbedding: mockGenerateEmbedding,
}));

vi.mock('../../queues/ai-flow', () => ({
	scheduleAIPipeline: mockScheduleAIPipeline,
}));

vi.mock('../../queues/knowledge-cron', () => ({
	runKnowledgeAnalysis: mockRunKnowledgeAnalysis,
	runManualKnowledgeEvidenceBuild: mockRunManualKnowledgeEvidenceBuild,
}));

vi.mock('../../ai/knowledge-inference', () => ({
	runKnowledgeInference: mockRunKnowledgeInference,
}));

vi.mock('../../queues/backfill', () => ({
	embeddingBackfillQueue: { add: vi.fn() },
}));

vi.mock('../../queues/health-scoring', () => ({
	healthScoringQueue: { add: vi.fn() },
}));

vi.mock('../../queues/sync', () => ({
	syncQueue: { add: vi.fn() },
}));

import { admin } from '../../routes/admin';

const SECRET = 'test-secret';

function post(path: string, body: object) {
	return admin.request(path, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Internal-Secret': SECRET,
		},
		body: JSON.stringify(body),
	});
}

describe('admin AI privacy gates', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubEnv('WORKER_INTERNAL_SECRET', SECRET);
		vi.stubEnv('NODE_ENV', 'development');
		vi.stubEnv('AI_PROCESSING_ENABLED', 'false');
		vi.stubEnv('ADMIN_AI_REPROCESS_ENABLED', 'false');
		mockHasUserAiAnalysisConsent.mockResolvedValue(true);
		mockIsWorkspaceMember.mockResolvedValue(true);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('rejects direct embedding when AI processing is not enabled', async () => {
		const res = await post('/embed', { text: 'masked query' });

		expect(res.status).toBe(403);
		expect(mockGenerateEmbedding).not.toHaveBeenCalled();
	});

	it('allows local direct embedding without enabling vendor egress', async () => {
		vi.stubEnv('KNOWLEDGE_EMBEDDING_PROVIDER', 'local');
		vi.stubEnv('KNOWLEDGE_EMBEDDING_PRESET', 'qwen');
		vi.stubEnv('KNOWLEDGE_EMBEDDING_MODEL', 'qwen3-embedding:0.6b');
		vi.stubEnv('KNOWLEDGE_EMBEDDING_BASE_URL', 'http://localhost:11434/v1');
		mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);

		const res = await post('/embed', { text: 'masked query' });

		expect(res.status).toBe(200);
		expect(mockGenerateEmbedding).toHaveBeenCalledWith('masked query');
		await expect(res.json()).resolves.toEqual({ embedding: [0.1, 0.2, 0.3] });
	});

	it('rejects message reprocessing before loading workspace messages when AI is disabled', async () => {
		vi.stubEnv('ADMIN_AI_REPROCESS_ENABLED', 'true');
		const res = await post('/reprocess-messages', {
			workspaceId: '550e8400-e29b-41d4-a716-446655440000',
			userId: '660e8400-e29b-41d4-a716-446655440001',
		});

		expect(res.status).toBe(403);
		expect(mockDbSelect).not.toHaveBeenCalled();
		expect(mockScheduleAIPipeline).not.toHaveBeenCalled();
	});

	it('rejects message reprocessing when the admin reprocess flag is disabled', async () => {
		vi.stubEnv('AI_PROCESSING_ENABLED', 'true');
		const res = await post('/reprocess-messages', {
			workspaceId: '550e8400-e29b-41d4-a716-446655440000',
			userId: '660e8400-e29b-41d4-a716-446655440001',
		});

		expect(res.status).toBe(403);
		expect(mockDbSelect).not.toHaveBeenCalled();
		expect(mockScheduleAIPipeline).not.toHaveBeenCalled();
	});

	it('rejects message reprocessing when user AI consent is absent', async () => {
		vi.stubEnv('ADMIN_AI_REPROCESS_ENABLED', 'true');
		vi.stubEnv('AI_PROCESSING_ENABLED', 'true');
		mockHasUserAiAnalysisConsent.mockResolvedValue(false);

		const res = await post('/reprocess-messages', {
			workspaceId: '550e8400-e29b-41d4-a716-446655440000',
			userId: '660e8400-e29b-41d4-a716-446655440001',
		});

		expect(res.status).toBe(403);
		expect(mockDbSelect).not.toHaveBeenCalled();
		expect(mockScheduleAIPipeline).not.toHaveBeenCalled();
	});

	it('runs knowledge extraction synchronously when waitForResult is requested', async () => {
		const workspaceId = '550e8400-e29b-41d4-a716-446655440000';
		mockRunKnowledgeAnalysis.mockResolvedValue({
			mode: 'evidence',
			workspaceId,
			workspacesScanned: 1,
			contactsProcessed: 13,
			embeddingMatches: 2,
			embeddingProviderMode: 'local',
			embeddingProviderLabel: 'Nomic local embeddings',
			llmQueued: 0,
			batchLinked: 0,
			batchUsed: false,
			llmProviderMode: 'local',
			llmProviderLabel: 'local LLM',
			elapsedMs: 1200,
			skippedWorkspaces: [],
		});
		mockRunKnowledgeInference.mockResolvedValue({
			workspaceId,
			nodesProcessed: 8,
			coOccurrenceLinks: 4,
			similarityLinks: 15,
			totalLinks: 19,
		});

		const res = await post('/extract-knowledge', {
			workspaceId,
			mode: 'evidence',
			limit: 500,
			runInference: true,
			waitForResult: true,
		});

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({
			status: 'complete',
			mode: 'evidence',
			workspaceId,
			analysis: expect.objectContaining({
				contactsProcessed: 13,
				embeddingMatches: 2,
			}),
			inference: expect.objectContaining({
				nodesProcessed: 8,
				totalLinks: 19,
			}),
		});
		expect(mockRunKnowledgeAnalysis).toHaveBeenCalledWith({
			workspaceId,
			mode: 'evidence',
			limit: 500,
		});
		expect(mockRunKnowledgeInference).toHaveBeenCalledWith(workspaceId, {
			requireFeatureFlag: false,
		});
	});

	it('runs manual knowledge evidence builds synchronously when waitForResult is requested', async () => {
		const workspaceId = '550e8400-e29b-41d4-a716-446655440000';
		const nodeId = '660e8400-e29b-41d4-a716-446655440001';
		mockRunManualKnowledgeEvidenceBuild.mockResolvedValue({
			workspaceId,
			nodeId,
			contactsScanned: 13,
			messagesScanned: 1200,
			evidenceCreated: 2,
			contactsLinked: 2,
			totalEvidenceRows: 7,
			totalEvidenceContacts: 3,
			totalEvidenceMessages: 6,
			elapsedMs: 1200,
		});
		mockRunKnowledgeInference.mockResolvedValue({
			workspaceId,
			nodesProcessed: 8,
			coOccurrenceLinks: 4,
			similarityLinks: 15,
			totalLinks: 19,
		});

		const res = await post('/build-manual-knowledge-evidence', {
			workspaceId,
			nodeId,
			limit: 500,
			maxEvidence: 200,
			runInference: true,
			waitForResult: true,
		});

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({
			status: 'complete',
			workspaceId,
			nodeId,
			manualEvidence: expect.objectContaining({
				contactsScanned: 13,
				messagesScanned: 1200,
				evidenceCreated: 2,
				contactsLinked: 2,
				totalEvidenceRows: 7,
				totalEvidenceContacts: 3,
				totalEvidenceMessages: 6,
			}),
			inference: expect.objectContaining({
				nodesProcessed: 8,
				totalLinks: 19,
			}),
		});
		expect(mockRunManualKnowledgeEvidenceBuild).toHaveBeenCalledWith({
			workspaceId,
			nodeId,
			limit: 500,
			maxEvidence: 200,
		});
		expect(mockRunKnowledgeInference).toHaveBeenCalledWith(workspaceId, {
			requireFeatureFlag: false,
		});
	});
});
