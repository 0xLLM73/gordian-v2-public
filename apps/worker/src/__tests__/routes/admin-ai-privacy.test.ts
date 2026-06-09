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
const mockEstimateConnectionReprocess = vi.hoisted(() => vi.fn());
const mockQueueConnectionReprocess = vi.hoisted(() => vi.fn());
const mockEstimateIntroductionReprocess = vi.hoisted(() => vi.fn());
const mockQueueIntroductionReprocess = vi.hoisted(() => vi.fn());
const mockGetRelationshipExtractionQueueStatus = vi.hoisted(() => vi.fn());
const mockCleanupResolvedRelationshipExtractionFailures = vi.hoisted(() => vi.fn());
const mockSql = vi.hoisted(() =>
	vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
);

function makeSelectLimitChain(rows: unknown[]) {
	const chain = {
		from: vi.fn(() => chain),
		innerJoin: vi.fn(() => chain),
		where: vi.fn(() => chain),
		groupBy: vi.fn(() => chain),
		orderBy: vi.fn(() => chain),
		limit: vi.fn(() => Promise.resolve(rows)),
	};
	return chain;
}

vi.mock('@repo/db', () => ({
	and: vi.fn((...conditions: unknown[]) => ({ conditions, op: 'and' })),
	appendAuditLog: mockAppendAuditLog,
	chats: { id: 'chatId', sourceAccountId: 'sourceAccountId' },
	contacts: { id: 'id', workspaceId: 'workspaceId' },
	db: { select: mockDbSelect },
	desc: vi.fn((value: unknown) => ({ direction: 'desc', value })),
	eq: vi.fn((left: unknown, right: unknown) => ({ left, op: 'eq', right })),
	getMessageCount: mockGetMessageCount,
	getMessagesByContact: vi.fn(),
	hasUserAiAnalysisConsent: mockHasUserAiAnalysisConsent,
	inArray: vi.fn((left: unknown, right: unknown) => ({ left, op: 'inArray', right })),
	isWorkspaceMember: mockIsWorkspaceMember,
	messages: {
		chatId: 'chatId',
		contactId: 'contactId',
		id: 'messageId',
		isOutgoing: 'isOutgoing',
		sentAt: 'sentAt',
		text: 'text',
		workspaceId: 'workspaceId',
	},
	sql: mockSql,
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

vi.mock('../../queues/connection-reprocess', () => ({
	estimateConnectionReprocess: mockEstimateConnectionReprocess,
	normalizeConnectionReprocessBatchSize: (value: unknown) =>
		Math.min(Math.max(Number(value ?? 200), 1), 200),
	normalizeConnectionReprocessContactIds: (value: unknown) =>
		Array.isArray(value)
			? [...new Set(value.filter((item): item is string => typeof item === 'string'))]
			: undefined,
	normalizeConnectionReprocessContactLimit: (value: unknown) =>
		Math.min(Math.max(Number(value ?? 25), 1), 100),
	normalizeConnectionReprocessMaxAgeDays: (value: unknown) => {
		if (value === undefined || value === null || value === '') return undefined;
		const numeric = Number(value);
		return Number.isFinite(numeric) ? Math.min(Math.max(Math.trunc(numeric), 1), 3650) : undefined;
	},
	queueConnectionReprocess: mockQueueConnectionReprocess,
}));

vi.mock('../../queues/introduction-reprocess', () => ({
	estimateIntroductionReprocess: mockEstimateIntroductionReprocess,
	normalizeIntroductionReprocessBatchSize: (value: unknown) =>
		Math.min(Math.max(Number(value ?? 200), 1), 200),
	normalizeIntroductionReprocessChatIds: (value: unknown) =>
		Array.isArray(value)
			? [...new Set(value.filter((item): item is string => typeof item === 'string'))]
			: undefined,
	normalizeIntroductionReprocessChatLimit: (value: unknown) =>
		Math.min(Math.max(Number(value ?? 25), 1), 100),
	normalizeIntroductionReprocessMaxAgeDays: (value: unknown) => {
		if (value === undefined || value === null || value === '') return undefined;
		const numeric = Number(value);
		return Number.isFinite(numeric) ? Math.min(Math.max(Math.trunc(numeric), 1), 3650) : undefined;
	},
	queueIntroductionReprocess: mockQueueIntroductionReprocess,
}));

vi.mock('../../queues/relationship-extraction', () => ({
	cleanupResolvedRelationshipExtractionFailures: mockCleanupResolvedRelationshipExtractionFailures,
	getRelationshipExtractionQueueStatus: mockGetRelationshipExtractionQueueStatus,
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

function get(path: string) {
	return admin.request(path, {
		headers: {
			'X-Internal-Secret': SECRET,
		},
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

	it('returns workspace-scoped relationship extraction status', async () => {
		const workspaceId = '550e8400-e29b-41d4-a716-446655440000';
		const userId = '660e8400-e29b-41d4-a716-446655440001';
		mockGetRelationshipExtractionQueueStatus.mockResolvedValueOnce({
			active: 1,
			waiting: 3,
			delayed: 0,
			retainedFailed: 0,
			resolvedFailed: 0,
			failed: 0,
			total: 4,
			introductionJobs: 2,
			connectionJobs: 2,
			unknownJobs: 0,
			progressReports: 0,
			diagnostics: {
				messagesInBatch: 0,
				freshSourceMessages: 0,
				relationshipModelCalls: 0,
				introductionKeywordMatches: 0,
				introductionModelCalls: 0,
				introductionRejected: 0,
				connectionKeywordMatches: 0,
				connectionModelCalls: 0,
				connectionRejected: 0,
			},
			oldestJobAt: '2026-06-08T12:00:00.000Z',
			newestJobAt: '2026-06-08T12:05:00.000Z',
			sampledAt: '2026-06-08T12:10:00.000Z',
		});

		const res = await get(
			`/relationship-extraction-status?workspaceId=${workspaceId}&userId=${userId}`,
		);

		expect(res.status).toBe(200);
		expect(mockIsWorkspaceMember).toHaveBeenCalledWith(workspaceId, userId);
		expect(mockGetRelationshipExtractionQueueStatus).toHaveBeenCalledWith({ workspaceId, userId });
		await expect(res.json()).resolves.toEqual(
			expect.objectContaining({
				active: 1,
				waiting: 3,
				introductionJobs: 2,
				connectionJobs: 2,
			}),
		);
	});

	it('clears resolved relationship extraction failures for workspace members', async () => {
		const workspaceId = '550e8400-e29b-41d4-a716-446655440000';
		const userId = '660e8400-e29b-41d4-a716-446655440001';
		mockCleanupResolvedRelationshipExtractionFailures.mockResolvedValueOnce({
			scanned: 50,
			removed: 49,
			retained: 1,
			sampledAt: '2026-06-08T12:15:00.000Z',
		});

		const res = await post('/relationship-extraction-cleanup', { workspaceId, userId });

		expect(res.status).toBe(200);
		expect(mockIsWorkspaceMember).toHaveBeenCalledWith(workspaceId, userId);
		expect(mockCleanupResolvedRelationshipExtractionFailures).toHaveBeenCalledWith({
			workspaceId,
			userId,
			limit: undefined,
		});
		await expect(res.json()).resolves.toEqual(
			expect.objectContaining({
				scanned: 50,
				removed: 49,
				retained: 1,
			}),
		);
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

	it('dry-runs message reprocessing within the requested recent window', async () => {
		vi.stubEnv('ADMIN_AI_REPROCESS_ENABLED', 'true');
		vi.stubEnv('AI_PROCESSING_ENABLED', 'true');
		mockDbSelect.mockReturnValueOnce(
			makeSelectLimitChain([
				{ id: 'contact-1', messageCount: 20 },
				{ id: 'contact-2', messageCount: 5 },
			]),
		);

		const res = await post('/reprocess-messages', {
			workspaceId: '550e8400-e29b-41d4-a716-446655440000',
			userId: '660e8400-e29b-41d4-a716-446655440001',
			batchSize: 10,
			contactLimit: 3,
			maxAgeDays: 14,
			dryRun: true,
		});

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual(
			expect.objectContaining({
				status: 'dry_run',
				batchSize: 10,
				contactLimit: 3,
				maxAgeDays: 14,
				wouldProcessContacts: 2,
				wouldProcessMessages: 15,
				confirmToken: expect.any(String),
			}),
		);
		expect(mockSql.mock.calls.some((call) => call.includes(14))).toBe(true);
		expect(mockScheduleAIPipeline).not.toHaveBeenCalled();
	});

	it('binds message reprocessing confirmation tokens to the recent window', async () => {
		vi.stubEnv('ADMIN_AI_REPROCESS_ENABLED', 'true');
		vi.stubEnv('AI_PROCESSING_ENABLED', 'true');
		mockDbSelect.mockReturnValueOnce(makeSelectLimitChain([{ id: 'contact-1', messageCount: 20 }]));

		const dryRun = await post('/reprocess-messages', {
			workspaceId: '550e8400-e29b-41d4-a716-446655440000',
			userId: '660e8400-e29b-41d4-a716-446655440001',
			batchSize: 10,
			contactLimit: 3,
			maxAgeDays: 14,
			dryRun: true,
		});
		const dryRunBody = (await dryRun.json()) as { confirmToken: string };
		mockDbSelect.mockReturnValueOnce(makeSelectLimitChain([{ id: 'contact-1', messageCount: 20 }]));

		const res = await post('/reprocess-messages', {
			workspaceId: '550e8400-e29b-41d4-a716-446655440000',
			userId: '660e8400-e29b-41d4-a716-446655440001',
			batchSize: 10,
			contactLimit: 3,
			maxAgeDays: 7,
			confirm: true,
			confirmToken: dryRunBody.confirmToken,
		});

		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({
			error: 'Valid dry-run confirmToken is required to queue jobs.',
		});
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

	it('rejects introduction reprocessing before loading group messages when AI is disabled', async () => {
		vi.stubEnv('ADMIN_AI_REPROCESS_ENABLED', 'true');

		const res = await post('/reprocess-introductions', {
			workspaceId: '550e8400-e29b-41d4-a716-446655440000',
			userId: '660e8400-e29b-41d4-a716-446655440001',
		});

		expect(res.status).toBe(403);
		expect(mockEstimateIntroductionReprocess).not.toHaveBeenCalled();
		expect(mockQueueIntroductionReprocess).not.toHaveBeenCalled();
	});

	it('dry-runs introduction reprocessing within the requested recent group window', async () => {
		vi.stubEnv('ADMIN_AI_REPROCESS_ENABLED', 'true');
		vi.stubEnv('AI_PROCESSING_ENABLED', 'true');
		mockEstimateIntroductionReprocess.mockResolvedValueOnce({
			workspaceId: '550e8400-e29b-41d4-a716-446655440000',
			chatLimit: 20,
			batchSize: 50,
			wouldProcessChats: 3,
			wouldProcessMessages: 120,
			maxAgeDays: 30,
		});

		const res = await post('/reprocess-introductions', {
			workspaceId: '550e8400-e29b-41d4-a716-446655440000',
			userId: '660e8400-e29b-41d4-a716-446655440001',
			batchSize: 50,
			chatLimit: 20,
			maxAgeDays: 30,
			dryRun: true,
		});

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual(
			expect.objectContaining({
				status: 'dry_run',
				batchSize: 50,
				chatLimit: 20,
				maxAgeDays: 30,
				wouldProcessChats: 3,
				wouldProcessMessages: 120,
				confirmToken: expect.any(String),
			}),
		);
		expect(mockEstimateIntroductionReprocess).toHaveBeenCalledWith(
			expect.objectContaining({
				batchSize: 50,
				chatLimit: 20,
				maxAgeDays: 30,
			}),
		);
		expect(mockQueueIntroductionReprocess).not.toHaveBeenCalled();
	});

	it('binds introduction reprocessing confirmation tokens to the recent window', async () => {
		vi.stubEnv('ADMIN_AI_REPROCESS_ENABLED', 'true');
		vi.stubEnv('AI_PROCESSING_ENABLED', 'true');
		mockEstimateIntroductionReprocess.mockResolvedValueOnce({
			workspaceId: '550e8400-e29b-41d4-a716-446655440000',
			chatLimit: 20,
			batchSize: 50,
			wouldProcessChats: 3,
			wouldProcessMessages: 120,
			maxAgeDays: 30,
		});

		const dryRun = await post('/reprocess-introductions', {
			workspaceId: '550e8400-e29b-41d4-a716-446655440000',
			userId: '660e8400-e29b-41d4-a716-446655440001',
			batchSize: 50,
			chatLimit: 20,
			maxAgeDays: 30,
			dryRun: true,
		});
		const dryRunBody = (await dryRun.json()) as { confirmToken: string };

		const res = await post('/reprocess-introductions', {
			workspaceId: '550e8400-e29b-41d4-a716-446655440000',
			userId: '660e8400-e29b-41d4-a716-446655440001',
			batchSize: 50,
			chatLimit: 20,
			maxAgeDays: 7,
			confirm: true,
			confirmToken: dryRunBody.confirmToken,
		});

		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({
			error: 'Valid dry-run confirmToken is required to queue jobs.',
		});
		expect(mockQueueIntroductionReprocess).not.toHaveBeenCalled();
	});

	it('rejects connection reprocessing before loading contact messages when AI is disabled', async () => {
		vi.stubEnv('ADMIN_AI_REPROCESS_ENABLED', 'true');

		const res = await post('/reprocess-connections', {
			workspaceId: '550e8400-e29b-41d4-a716-446655440000',
			userId: '660e8400-e29b-41d4-a716-446655440001',
		});

		expect(res.status).toBe(403);
		expect(mockEstimateConnectionReprocess).not.toHaveBeenCalled();
		expect(mockQueueConnectionReprocess).not.toHaveBeenCalled();
	});

	it('dry-runs connection reprocessing within the requested recent contact window', async () => {
		vi.stubEnv('ADMIN_AI_REPROCESS_ENABLED', 'true');
		vi.stubEnv('AI_PROCESSING_ENABLED', 'true');
		mockEstimateConnectionReprocess.mockResolvedValueOnce({
			workspaceId: '550e8400-e29b-41d4-a716-446655440000',
			contactLimit: 20,
			batchSize: 50,
			wouldProcessContacts: 4,
			wouldProcessMessages: 140,
			maxAgeDays: 30,
		});

		const res = await post('/reprocess-connections', {
			workspaceId: '550e8400-e29b-41d4-a716-446655440000',
			userId: '660e8400-e29b-41d4-a716-446655440001',
			batchSize: 50,
			contactLimit: 20,
			maxAgeDays: 30,
			dryRun: true,
		});

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual(
			expect.objectContaining({
				status: 'dry_run',
				batchSize: 50,
				contactLimit: 20,
				maxAgeDays: 30,
				wouldProcessContacts: 4,
				wouldProcessMessages: 140,
				confirmToken: expect.any(String),
			}),
		);
		expect(mockEstimateConnectionReprocess).toHaveBeenCalledWith(
			expect.objectContaining({
				batchSize: 50,
				contactLimit: 20,
				maxAgeDays: 30,
			}),
		);
		expect(mockQueueConnectionReprocess).not.toHaveBeenCalled();
	});

	it('binds connection reprocessing confirmation tokens to the recent window', async () => {
		vi.stubEnv('ADMIN_AI_REPROCESS_ENABLED', 'true');
		vi.stubEnv('AI_PROCESSING_ENABLED', 'true');
		mockEstimateConnectionReprocess.mockResolvedValueOnce({
			workspaceId: '550e8400-e29b-41d4-a716-446655440000',
			contactLimit: 20,
			batchSize: 50,
			wouldProcessContacts: 4,
			wouldProcessMessages: 140,
			maxAgeDays: 30,
		});

		const dryRun = await post('/reprocess-connections', {
			workspaceId: '550e8400-e29b-41d4-a716-446655440000',
			userId: '660e8400-e29b-41d4-a716-446655440001',
			batchSize: 50,
			contactLimit: 20,
			maxAgeDays: 30,
			dryRun: true,
		});
		const dryRunBody = (await dryRun.json()) as { confirmToken: string };

		const res = await post('/reprocess-connections', {
			workspaceId: '550e8400-e29b-41d4-a716-446655440000',
			userId: '660e8400-e29b-41d4-a716-446655440001',
			batchSize: 50,
			contactLimit: 20,
			maxAgeDays: 7,
			confirm: true,
			confirmToken: dryRunBody.confirmToken,
		});

		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({
			error: 'Valid dry-run confirmToken is required to queue jobs.',
		});
		expect(mockQueueConnectionReprocess).not.toHaveBeenCalled();
	});
});
