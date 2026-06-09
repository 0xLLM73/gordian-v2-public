import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetOpenAIApiKey = vi.hoisted(() =>
	vi.fn(async () => process.env.OPENAI_API_KEY?.trim() || undefined),
);
const mockMaskEntities = vi.hoisted(() => vi.fn((text: string) => ({ maskedText: text })));

vi.mock('next/headers', () => ({
	headers: vi.fn(() => Promise.resolve(new Headers())),
}));

vi.mock('@/lib/track', () => ({
	track: vi.fn(),
	trackEvent: vi.fn(),
}));

vi.mock('@repo/crypto/local-secrets', () => ({
	getOpenAIApiKey: mockGetOpenAIApiKey,
}));

vi.mock('@repo/crypto', () => ({
	withKeys: vi.fn((_envelope: unknown, fn: () => unknown) => fn()),
	unwrapWrk: vi.fn(() => Promise.resolve(Buffer.from('mock-wrk'))),
	deriveKeys: vi.fn(() => Promise.resolve({ bik: Buffer.from('mock-bik') })),
	prefilterEntities: vi.fn(() => []),
	maskEntities: mockMaskEntities,
}));

vi.mock('@/lib/auth', () => ({
	auth: {
		api: {
			getSession: vi.fn(() =>
				Promise.resolve({
					user: { id: 'user-1', email: 'test@test.com', name: 'Test' },
					session: { id: 'session-1' },
				}),
			),
		},
	},
}));

const WORKSPACE_ID = '550e8400-e29b-41d4-a716-446655440000';
const MOCK_ENVELOPE = {
	encryptedWrk: Buffer.from('mock'),
	kmsContext: { WorkspaceID: 'mock' },
	wrkVersion: 1,
};

// SEC-119: All ID fixtures must be valid RFC 4122 UUIDs (4th group must start with 8/9/a/b)
const NODE_ID_1 = '11111111-1111-4111-8111-111111111111';
const NODE_ID_2 = '22222222-2222-4222-8222-222222222222';
const NODE_ID_ISOLATED = '33333333-3333-4333-8333-333333333333';
const NODE_ID_NONEXISTENT = '44444444-4444-4444-8444-444444444444';
const CONTACT_ID_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONTACT_ID_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONTACT_ID_3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CONTACT_ID_4 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

vi.mock('@/lib/workspace', () => ({
	getUserWorkspaceId: vi.fn(() => Promise.resolve(WORKSPACE_ID)),
	getWorkspaceEnvelope: vi.fn(() => Promise.resolve(MOCK_ENVELOPE)),
}));

const mockListKnowledgeNodes = vi.fn();
const mockSearchKnowledgeNodes = vi.fn();
const mockGetKnowledgeNode = vi.fn();
const mockListContactsByKnowledge = vi.fn();
const mockListEvidenceForKnowledgeLink = vi.fn();
const mockListEvidenceForKnowledgeNode = vi.fn();
const mockListEvidenceForKnowledgeNodes = vi.fn();
const mockListEvidenceForKnowledgeContact = vi.fn();
const mockListContactsWithEvidenceForKnowledgeNode = vi.fn();
const mockSearchKnowledgeNodesWithEvidence = vi.fn();
const mockNormalizeKnowledgeSearchQuery = vi.fn((query: string) =>
	query.replace(/^who talked about\s+/i, '').trim(),
);
const mockListKnowledgeByContact = vi.fn();
const mockGetKnowledgeNeighbors = vi.fn();
const mockGetSharedKnowledge = vi.fn();
const mockMergeKnowledgeNodes = vi.fn();
const mockGetGraphData = vi.fn();
const mockGetCalibration = vi.fn();
const mockCreateKnowledgeNode = vi.fn();
const mockCreateKnowledgeEvidence = vi.fn();
const mockUpdateKnowledgeNode = vi.fn();
const mockGetKnowledgeNodeEvidenceStats = vi.fn();

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	createKnowledgeEvidence: mockCreateKnowledgeEvidence,
	createKnowledgeNode: mockCreateKnowledgeNode,
	updateKnowledgeNode: mockUpdateKnowledgeNode,
	getCalibration: mockGetCalibration,
	getKnowledgeNodeEvidenceStats: mockGetKnowledgeNodeEvidenceStats,
	listKnowledgeNodes: mockListKnowledgeNodes,
	searchKnowledgeNodes: mockSearchKnowledgeNodes,
	getKnowledgeNode: mockGetKnowledgeNode,
	listContactsByKnowledge: mockListContactsByKnowledge,
	listEvidenceForKnowledgeLink: mockListEvidenceForKnowledgeLink,
	listEvidenceForKnowledgeNode: mockListEvidenceForKnowledgeNode,
	listEvidenceForKnowledgeNodes: mockListEvidenceForKnowledgeNodes,
	listEvidenceForKnowledgeContact: mockListEvidenceForKnowledgeContact,
	listContactsWithEvidenceForKnowledgeNode: mockListContactsWithEvidenceForKnowledgeNode,
	searchKnowledgeNodesWithEvidence: mockSearchKnowledgeNodesWithEvidence,
	normalizeKnowledgeSearchQuery: mockNormalizeKnowledgeSearchQuery,
	listKnowledgeByContact: mockListKnowledgeByContact,
	getKnowledgeNeighbors: mockGetKnowledgeNeighbors,
	getSharedKnowledge: mockGetSharedKnowledge,
	mergeKnowledgeNodes: mockMergeKnowledgeNodes,
	getGraphData: mockGetGraphData,
	getContactsByIds: vi.fn(() => Promise.resolve([])),
	listContactIdsByKnowledge: vi.fn(() => Promise.resolve([])),
	trackBehavior: vi.fn(() => Promise.resolve()),
	hasAnalyticsConsent: vi.fn(() => Promise.resolve(true)),
	db: {
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				innerJoin: vi.fn(() => ({
					where: vi.fn(() => ({ orderBy: vi.fn(() => Promise.resolve([])) })),
				})),
				where: vi.fn(() => ({ orderBy: vi.fn(() => Promise.resolve([])) })),
			})),
		})),
	},
	and: vi.fn((...args: unknown[]) => args),
	eq: vi.fn((...args: unknown[]) => args),
	sql: Object.assign((strings: TemplateStringsArray, ..._values: unknown[]) => strings.join(''), {
		raw: vi.fn(),
	}),
	desc: vi.fn(),
	knowledgeNodes: {
		id: 'id',
		workspaceId: 'workspaceId',
		type: 'type',
		displayName: 'displayName',
		description: 'description',
		metadata: 'metadata',
		createdAt: 'createdAt',
	},
	knowledgeContacts: {
		knowledgeNodeId: 'knowledgeNodeId',
		contactId: 'contactId',
		workspaceId: 'workspaceId',
		relationType: 'relationType',
	},
	knowledgeLinks: {
		sourceNodeId: 'sourceNodeId',
		targetNodeId: 'targetNodeId',
		workspaceId: 'workspaceId',
		linkType: 'linkType',
	},
}));

const mockNode = {
	id: NODE_ID_1,
	workspaceId: WORKSPACE_ID,
	type: 'topic' as const,
	name: 'defi',
	displayName: 'DeFi',
	description: 'Decentralised finance protocols',
	mentionCount: 5,
	embedding: null,
	lastSeenAt: null,
	createdAt: new Date(),
	updatedAt: new Date(),
};

const mockNodeB = {
	id: NODE_ID_2,
	workspaceId: WORKSPACE_ID,
	type: 'technology' as const,
	name: 'ethereum',
	displayName: 'Ethereum',
	description: 'Ethereum network',
	mentionCount: 10,
	embedding: null,
	lastSeenAt: null,
	createdAt: new Date(),
	updatedAt: new Date(),
};

const projectedMockNode = {
	id: NODE_ID_1,
	type: 'topic',
	name: 'defi',
	displayName: 'DeFi',
	description: 'Decentralised finance protocols',
	mentionCount: 5,
	firstSeenAt: null,
	lastSeenAt: null,
	createdAt: mockNode.createdAt,
	reviewStatus: null,
	reviewedAt: null,
};

const projectedMockNodeWithEmptyStats = {
	...projectedMockNode,
	contactCount: 0,
	contactPreviews: [],
	evidenceCount: 0,
	distinctEvidenceMessages: 0,
	distinctEvidenceContacts: 0,
	aggregateEvidenceCount: 0,
	directEvidenceRows: 0,
	directEvidenceMessages: 0,
	directEvidenceContacts: 0,
	possibleEvidenceRows: 0,
	weakEvidenceRows: 0,
};

describe('knowledge actions', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		mockMaskEntities.mockImplementation((text: string) => ({ maskedText: text }));
		mockGetCalibration.mockResolvedValue({ consentAiAnalysis: true });
		mockGetKnowledgeNodeEvidenceStats.mockResolvedValue(new Map());
		mockListEvidenceForKnowledgeNodes.mockResolvedValue([]);
		vi.stubEnv('OPENAI_API_KEY', 'test-key');
		vi.stubEnv('WORKER_INTERNAL_SECRET', 'test-secret');
		vi.stubEnv('WORKER_URL', 'http://localhost:3001');
	});

	describe('listKnowledgeNodesAction', () => {
		it('returns all nodes when no filter or query', async () => {
			mockListKnowledgeNodes.mockResolvedValue([mockNode]);

			const { listKnowledgeNodesAction } = await import('@/app/actions/knowledge');
			const result = await listKnowledgeNodesAction({ limit: 20, offset: 0 });

			expect(result?.data).toEqual([projectedMockNodeWithEmptyStats]);
			expect(JSON.stringify(result?.data)).not.toContain('workspaceId');
			expect(JSON.stringify(result?.data)).not.toContain('embedding');
			expect(mockListKnowledgeNodes).toHaveBeenCalledWith(
				WORKSPACE_ID,
				expect.objectContaining({ limit: 20, offset: 0 }),
				MOCK_ENVELOPE,
			);
		});

		it('filters by type when provided', async () => {
			mockListKnowledgeNodes.mockResolvedValue([mockNode]);

			const { listKnowledgeNodesAction } = await import('@/app/actions/knowledge');
			await listKnowledgeNodesAction({ type: 'topic', limit: 20, offset: 0 });

			expect(mockListKnowledgeNodes).toHaveBeenCalledWith(
				WORKSPACE_ID,
				expect.objectContaining({ type: 'topic' }),
				MOCK_ENVELOPE,
			);
		});

		it('uses confidence-filtered knowledge search when query is provided', async () => {
			mockSearchKnowledgeNodesWithEvidence.mockResolvedValue([{ node: mockNode }]);

			const mockEmbedding = Array(512).fill(0.1);
			const originalFetch = globalThis.fetch;
			globalThis.fetch = vi.fn(() =>
				Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ data: [{ embedding: mockEmbedding }] }),
				}),
			) as unknown as typeof fetch;

			try {
				const { listKnowledgeNodesAction } = await import('@/app/actions/knowledge');
				const result = await listKnowledgeNodesAction({ query: 'defi', limit: 20, offset: 0 });

				expect(result?.data).toEqual([projectedMockNodeWithEmptyStats]);
				expect(mockSearchKnowledgeNodesWithEvidence).toHaveBeenCalledWith(
					WORKSPACE_ID,
					'defi',
					mockEmbedding,
					MOCK_ENVELOPE,
					expect.objectContaining({
						limit: 20,
						minSimilarity: 0.62,
					}),
				);
				expect(mockListKnowledgeNodes).not.toHaveBeenCalled();
				expect(mockSearchKnowledgeNodes).not.toHaveBeenCalled();
			} finally {
				globalThis.fetch = originalFetch;
			}
		});

		it('uses exact knowledge search when embeddings are not configured', async () => {
			vi.stubEnv('OPENAI_API_KEY', '');
			mockSearchKnowledgeNodesWithEvidence.mockResolvedValue([{ node: mockNode }]);
			const fetchSpy = vi.spyOn(globalThis, 'fetch');

			const { listKnowledgeNodesAction } = await import('@/app/actions/knowledge');
			const result = await listKnowledgeNodesAction({ query: 'defi', limit: 20, offset: 0 });

			expect(result?.data).toEqual([projectedMockNodeWithEmptyStats]);
			expect(mockSearchKnowledgeNodesWithEvidence).toHaveBeenCalledWith(
				WORKSPACE_ID,
				'defi',
				undefined,
				MOCK_ENVELOPE,
				expect.objectContaining({
					limit: 20,
					minSimilarity: 0.62,
				}),
			);
			expect(mockSearchKnowledgeNodes).not.toHaveBeenCalled();
			expect(fetchSpy).not.toHaveBeenCalled();
			fetchSpy.mockRestore();
		});

		it('rejects invalid node type', async () => {
			const { listKnowledgeNodesAction } = await import('@/app/actions/knowledge');
			const result = await listKnowledgeNodesAction({
				type: 'invalid' as 'topic',
				limit: 20,
				offset: 0,
			});
			expect(result?.validationErrors).toBeDefined();
			expect(mockListKnowledgeNodes).not.toHaveBeenCalled();
		});
	});

	describe('searchKnowledgeNodesWithEvidenceAction', () => {
		it('returns evidence-aware node results with safe projected fields', async () => {
			const evidenceDate = new Date('2026-05-02T12:00:00Z');
			const mockEmbedding = Array(512).fill(0.1);
			mockSearchKnowledgeNodesWithEvidence.mockResolvedValue([
				{
					node: {
						...mockNode,
						firstSeenAt: null,
						nameBlindIndex: 'secret-bidx',
						aliases: ['defi'],
						metadata: { internal: true },
					},
					similarity: 0.82,
					matchScore: 0.91,
					matchReasons: ['semantic similarity', 'message evidence'],
					exactMatch: false,
					aliasMatch: false,
					messageRecallScore: 0.84,
					messageHitCount: 1,
					messageMatchedEvidenceIds: ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'],
					messageMatchedAt: evidenceDate,
					messageRecallReasons: ['evidence_message_match', 'memory_semantic'],
					evidenceCount: 2,
					aggregateEvidenceCount: 4,
					latestEvidenceAt: evidenceDate,
					topConfidence: 0.93,
					connectedContactCount: 2,
					connectedContactsWithEvidence: 1,
					contacts: [
						{
							id: CONTACT_ID_1,
							firstName: 'Alice',
							lastName: 'Smith',
							relationType: 'knows_about',
							strength: 0.9,
							evidenceCount: 2,
							lastEvidenceAt: evidenceDate,
							evidence: [
								{
									id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
									contactId: CONTACT_ID_1,
									messageId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
									relationType: 'knows_about',
									evidenceKind: 'llm_extracted',
									confidence: 0.93,
									snippet: 'Alice talked about DeFi liquidity.',
									occurredAt: evidenceDate,
									createdAt: evidenceDate,
								},
							],
						},
					],
					evidence: [
						{
							id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
							contactId: CONTACT_ID_1,
							messageId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
							relationType: 'knows_about',
							evidenceKind: 'llm_extracted',
							confidence: 0.93,
							snippet: 'Alice talked about DeFi liquidity.',
							occurredAt: evidenceDate,
							createdAt: evidenceDate,
						},
					],
				},
			]);
			const originalFetch = globalThis.fetch;
			globalThis.fetch = vi.fn(() =>
				Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ data: [{ embedding: mockEmbedding }] }),
				}),
			) as unknown as typeof fetch;

			try {
				const { searchKnowledgeNodesWithEvidenceAction } = await import('@/app/actions/knowledge');
				const result = await searchKnowledgeNodesWithEvidenceAction({
					query: 'who talked about DeFi',
					limit: 10,
				});

				expect(mockNormalizeKnowledgeSearchQuery).toHaveBeenCalledWith('who talked about DeFi');
				expect(mockSearchKnowledgeNodesWithEvidence).toHaveBeenCalledWith(
					WORKSPACE_ID,
					'DeFi',
					mockEmbedding,
					MOCK_ENVELOPE,
					expect.objectContaining({
						limit: 10,
						minSimilarity: 0.62,
						messageRecallQueryText: 'DeFi',
					}),
				);
				expect(result?.data).toEqual({
					query: 'who talked about DeFi',
					normalizedQuery: 'DeFi',
					minSimilarity: 0.62,
					noConfidentResults: false,
					answer: {
						title: 'DeFi is the strongest local match for "DeFi".',
						summary:
							'1 topic matched with 1 connected contact and 2 source evidence rows. Top match confidence is 91%.',
						support: [
							'1 contact connected',
							'2 evidence rows stored',
							'1 explicit source in the visible preview',
						],
						suggestedAction:
							'Open the top topic to inspect the supporting contacts and source snippets.',
					},
					results: [
						{
							node: projectedMockNode,
							similarity: 0.82,
							matchScore: 0.91,
							matchReasons: ['semantic similarity', 'message evidence'],
							exactMatch: false,
							aliasMatch: false,
							messageRecallScore: 0.84,
							messageHitCount: 1,
							messageMatchedEvidenceIds: ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'],
							messageMatchedAt: evidenceDate,
							messageRecallReasons: ['evidence_message_match', 'memory_semantic'],
							evidenceCount: 2,
							aggregateEvidenceCount: 4,
							latestEvidenceAt: evidenceDate,
							topConfidence: 0.93,
							connectedContactCount: 2,
							connectedContactsWithEvidence: 1,
							directEvidenceRows: 0,
							directEvidenceMessages: 0,
							directEvidenceContacts: 0,
							possibleEvidenceRows: 0,
							weakEvidenceRows: 0,
							contacts: [
								{
									id: CONTACT_ID_1,
									firstName: 'Alice',
									lastName: 'Smith',
									relationType: 'knows_about',
									strength: 0.9,
									evidenceCount: 2,
									lastEvidenceAt: evidenceDate,
									evidence: [
										{
											id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
											contactId: CONTACT_ID_1,
											messageId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
											relationType: 'knows_about',
											evidenceKind: 'llm_extracted',
											claimLabel: 'explicit',
											confidence: 0.93,
											snippet: 'Alice talked about DeFi liquidity.',
											occurredAt: evidenceDate,
											createdAt: evidenceDate,
										},
									],
								},
							],
							evidence: [
								{
									id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
									contactId: CONTACT_ID_1,
									messageId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
									relationType: 'knows_about',
									evidenceKind: 'llm_extracted',
									claimLabel: 'explicit',
									confidence: 0.93,
									snippet: 'Alice talked about DeFi liquidity.',
									occurredAt: evidenceDate,
									createdAt: evidenceDate,
								},
							],
						},
					],
				});
				const serialized = JSON.stringify(result?.data);
				expect(serialized).not.toContain(WORKSPACE_ID);
				expect(serialized).not.toContain('embedding');
				expect(serialized).not.toContain('secret-bidx');
				expect(serialized).not.toContain('internal');
			} finally {
				globalThis.fetch = originalFetch;
			}
		});

		it('returns noConfidentResults for negative searches with no candidates', async () => {
			mockSearchKnowledgeNodesWithEvidence.mockResolvedValue([]);
			const originalFetch = globalThis.fetch;
			globalThis.fetch = vi.fn(() =>
				Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ data: [{ embedding: Array(512).fill(0.1) }] }),
				}),
			) as unknown as typeof fetch;

			try {
				const { searchKnowledgeNodesWithEvidenceAction } = await import('@/app/actions/knowledge');
				const result = await searchKnowledgeNodesWithEvidenceAction({
					query: 'totally unrelated query',
					limit: 10,
				});

				expect(result?.data?.noConfidentResults).toBe(true);
				expect(result?.data?.results).toEqual([]);
			} finally {
				globalThis.fetch = originalFetch;
			}
		});

		it('uses the masked query for message recall instead of the raw normalized query', async () => {
			mockMaskEntities.mockImplementation((text: string) => ({ maskedText: `masked:${text}` }));
			mockSearchKnowledgeNodesWithEvidence.mockResolvedValue([]);
			const originalFetch = globalThis.fetch;
			globalThis.fetch = vi.fn(() =>
				Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ data: [{ embedding: Array(512).fill(0.1) }] }),
				}),
			) as unknown as typeof fetch;

			try {
				const { searchKnowledgeNodesWithEvidenceAction } = await import('@/app/actions/knowledge');
				await searchKnowledgeNodesWithEvidenceAction({
					query: 'who talked about Alice and AI agents',
					limit: 10,
				});

				expect(mockSearchKnowledgeNodesWithEvidence).toHaveBeenCalledWith(
					WORKSPACE_ID,
					'Alice and AI agents',
					Array(512).fill(0.1),
					MOCK_ENVELOPE,
					expect.objectContaining({
						messageRecallQueryText: 'masked:Alice and AI agents',
					}),
				);
			} finally {
				globalThis.fetch = originalFetch;
			}
		});
	});

	describe('local knowledge build actions', () => {
		it('runs relationship inference through the worker without accepting a client workspace id', async () => {
			const originalFetch = globalThis.fetch;
			globalThis.fetch = vi.fn(() =>
				Promise.resolve({
					ok: true,
					json: () =>
						Promise.resolve({
							status: 'complete',
							nodesProcessed: 7,
							coOccurrenceLinks: 2,
							similarityLinks: 3,
							totalLinks: 5,
						}),
				}),
			) as unknown as typeof fetch;

			try {
				const { runLocalKnowledgeInferenceAction } = await import('@/app/actions/knowledge');
				const result = await runLocalKnowledgeInferenceAction({});

				expect(result?.data).toEqual({
					status: 'complete',
					nodesProcessed: 7,
					coOccurrenceLinks: 2,
					similarityLinks: 3,
					totalLinks: 5,
					skippedReason: null,
				});
				expect(globalThis.fetch).toHaveBeenCalledWith(
					'http://localhost:3001/admin/infer-knowledge',
					expect.objectContaining({
						method: 'POST',
						headers: expect.objectContaining({
							'X-Internal-Secret': 'test-secret',
						}),
						body: JSON.stringify({ workspaceId: WORKSPACE_ID }),
					}),
				);
			} finally {
				globalThis.fetch = originalFetch;
			}
		});

		it('does not run relationship inference when AI analysis consent is disabled', async () => {
			mockGetCalibration.mockResolvedValueOnce({ consentAiAnalysis: false });
			const fetchSpy = vi.spyOn(globalThis, 'fetch');

			const { runLocalKnowledgeInferenceAction } = await import('@/app/actions/knowledge');
			const result = await runLocalKnowledgeInferenceAction({});

			expect(result?.data).toEqual({
				status: 'skipped',
				error: 'AI analysis consent is not enabled',
				nodesProcessed: 0,
				coOccurrenceLinks: 0,
				similarityLinks: 0,
				totalLinks: 0,
			});
			expect(fetchSpy).not.toHaveBeenCalled();
			fetchSpy.mockRestore();
		});

		it('creates a manual local knowledge node and runs targeted message evidence build', async () => {
			vi.stubEnv('KNOWLEDGE_EMBEDDING_PROVIDER', 'local');
			vi.stubEnv('KNOWLEDGE_EMBEDDING_MODEL', 'nomic-embed-text');
			const manualNode = {
				...mockNode,
				id: NODE_ID_2,
				type: 'project' as const,
				name: 'berachain',
				displayName: 'Berachain',
				description: 'Ecosystem context',
				mentionCount: 1,
			};
			mockCreateKnowledgeNode.mockResolvedValue(manualNode);
			mockCreateKnowledgeEvidence.mockResolvedValue({
				id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
				workspaceId: WORKSPACE_ID,
			});
			const originalFetch = globalThis.fetch;
			globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
				const url = String(input);
				if (url === 'http://localhost:11434/v1/embeddings') {
					return Promise.resolve({
						ok: true,
						json: () => Promise.resolve({ data: [{ embedding: Array(512).fill(0.2) }] }),
					});
				}
				if (url === 'http://localhost:3001/admin/build-manual-knowledge-evidence') {
					return Promise.resolve({
						ok: true,
						json: () =>
							Promise.resolve({
								status: 'complete',
								workspaceId: WORKSPACE_ID,
								nodeId: NODE_ID_2,
								manualEvidence: {
									workspaceId: WORKSPACE_ID,
									nodeId: NODE_ID_2,
									contactsScanned: 13,
									messagesScanned: 1200,
									evidenceCreated: 2,
									contactsLinked: 2,
									totalEvidenceRows: 7,
									totalEvidenceContacts: 3,
									totalEvidenceMessages: 6,
									elapsedMs: 1200,
								},
								inference: {
									workspaceId: WORKSPACE_ID,
									nodesProcessed: 8,
									coOccurrenceLinks: 4,
									similarityLinks: 15,
									totalLinks: 19,
								},
							}),
					});
				}
				throw new Error(`Unexpected fetch: ${url}`);
			}) as unknown as typeof fetch;

			try {
				const { createManualKnowledgeNodeAction } = await import('@/app/actions/knowledge');
				const result = await createManualKnowledgeNodeAction({
					type: 'project',
					name: 'Berachain',
					description: 'Ecosystem context',
					buildNow: true,
				});

				expect(result?.data).toEqual({
					created: true,
					buildQueued: false,
					buildError: undefined,
					buildStatus: 'complete',
					analysis: {
						mode: 'manual_evidence',
						workspaceId: WORKSPACE_ID,
						contactsProcessed: 13,
						embeddingMatches: 2,
						batchLinked: 2,
						elapsedMs: 1200,
					},
					manualEvidence: {
						workspaceId: WORKSPACE_ID,
						nodeId: NODE_ID_2,
						contactsScanned: 13,
						messagesScanned: 1200,
						evidenceCreated: 2,
						contactsLinked: 2,
						totalEvidenceRows: 7,
						totalEvidenceContacts: 3,
						totalEvidenceMessages: 6,
						elapsedMs: 1200,
					},
					inference: {
						workspaceId: WORKSPACE_ID,
						nodesProcessed: 8,
						coOccurrenceLinks: 4,
						similarityLinks: 15,
						totalLinks: 19,
					},
					node: {
						id: NODE_ID_2,
						type: 'project',
						name: 'berachain',
						displayName: 'Berachain',
						description: 'Ecosystem context',
						mentionCount: 1,
						firstSeenAt: null,
						lastSeenAt: null,
						createdAt: manualNode.createdAt,
						reviewStatus: null,
						reviewedAt: null,
					},
				});
				expect(mockCreateKnowledgeNode).toHaveBeenCalledWith(
					WORKSPACE_ID,
					expect.objectContaining({
						type: 'project',
						name: 'Berachain',
						displayName: 'Berachain',
						description: 'Ecosystem context',
						embedding: Array(512).fill(0.2),
						metadata: {
							source: 'manual',
							localBuildRequested: true,
						},
					}),
					MOCK_ENVELOPE,
				);
				expect(mockCreateKnowledgeEvidence).toHaveBeenCalledWith(
					WORKSPACE_ID,
					expect.objectContaining({
						knowledgeNodeId: NODE_ID_2,
						relationType: 'manual',
						evidenceKind: 'manual',
						confidence: 1,
					}),
					MOCK_ENVELOPE,
				);
				expect(globalThis.fetch).toHaveBeenCalledWith(
					'http://localhost:11434/v1/embeddings',
					expect.objectContaining({
						body: expect.stringContaining('search_document: Type: project'),
					}),
				);
				expect(globalThis.fetch).toHaveBeenCalledWith(
					'http://localhost:3001/admin/build-manual-knowledge-evidence',
					expect.objectContaining({
						body: JSON.stringify({
							workspaceId: WORKSPACE_ID,
							nodeId: NODE_ID_2,
							limit: 500,
							maxEvidence: 200,
							runInference: true,
							waitForResult: true,
						}),
					}),
				);
			} finally {
				globalThis.fetch = originalFetch;
			}
		});
	});

	describe('reviewKnowledgeNodeAction', () => {
		it('updates safe correction fields, refreshes the local embedding, and stores review metadata', async () => {
			vi.stubEnv('KNOWLEDGE_EMBEDDING_PROVIDER', 'local');
			vi.stubEnv('KNOWLEDGE_EMBEDDING_MODEL', 'nomic-embed-text');
			const updatedNode = {
				...mockNode,
				displayName: 'DeFi Networks',
				description: 'Reviewed decentralized finance context',
			};
			mockGetKnowledgeNode.mockResolvedValue({
				...mockNode,
				metadata: { source: 'llm_extracted' },
			});
			mockUpdateKnowledgeNode.mockResolvedValue(updatedNode);
			const originalFetch = globalThis.fetch;
			globalThis.fetch = vi.fn(() =>
				Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ data: [{ embedding: Array(512).fill(0.4) }] }),
				}),
			) as unknown as typeof fetch;

			try {
				const { reviewKnowledgeNodeAction } = await import('@/app/actions/knowledge');
				const result = await reviewKnowledgeNodeAction({
					nodeId: NODE_ID_1,
					type: 'topic',
					displayName: 'DeFi Networks',
					description: 'Reviewed decentralized finance context',
					status: 'reviewed',
				});

				expect(mockUpdateKnowledgeNode).toHaveBeenCalledWith(
					WORKSPACE_ID,
					NODE_ID_1,
					expect.objectContaining({
						type: 'topic',
						name: 'DeFi Networks',
						displayName: 'DeFi Networks',
						description: 'Reviewed decentralized finance context',
						embedding: Array(512).fill(0.4),
						metadata: expect.objectContaining({
							source: 'llm_extracted',
							review: expect.objectContaining({
								status: 'reviewed',
								source: 'manual',
							}),
						}),
					}),
					MOCK_ENVELOPE,
				);
				expect(result?.data?.updated).toBe(true);
				expect(result?.data?.node).toEqual(
					expect.objectContaining({
						displayName: 'DeFi Networks',
						reviewStatus: 'reviewed',
					}),
				);
			} finally {
				globalThis.fetch = originalFetch;
			}
		});
	});

	describe('getKnowledgeRelationshipExplanationsAction', () => {
		it('returns safe relationship explanations with decrypted evidence snippets', async () => {
			const evidenceDate = new Date('2026-05-02T12:00:00Z');
			mockGetKnowledgeNode.mockResolvedValue(mockNode);
			mockGetKnowledgeNeighbors.mockResolvedValue([
				{
					direction: 'outbound',
					link: {
						id: '99999999-9999-4999-8999-999999999999',
						workspaceId: WORKSPACE_ID,
						sourceNodeId: NODE_ID_1,
						targetNodeId: NODE_ID_2,
						linkType: 'related_to',
						weight: 0.84,
						createdAt: evidenceDate,
					},
					node: mockNodeB,
				},
			]);
			mockListEvidenceForKnowledgeLink.mockResolvedValue([
				{
					id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
					contactId: CONTACT_ID_1,
					messageId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
					relationType: 'related_to',
					evidenceKind: 'contact_cooccurrence',
					confidence: 0.84,
					snippet: 'Alice connected DeFi and Ethereum in one thread.',
					occurredAt: evidenceDate,
					createdAt: evidenceDate,
				},
			]);

			const { getKnowledgeRelationshipExplanationsAction } = await import(
				'@/app/actions/knowledge'
			);
			const result = await getKnowledgeRelationshipExplanationsAction({
				nodeId: NODE_ID_1,
				limit: 4,
			});

			expect(mockListEvidenceForKnowledgeLink).toHaveBeenCalledWith(
				WORKSPACE_ID,
				NODE_ID_1,
				NODE_ID_2,
				MOCK_ENVELOPE,
				expect.objectContaining({ relationType: 'related_to', limit: 2 }),
			);
			expect(result?.data?.explanations).toEqual([
				expect.objectContaining({
					direction: 'outbound',
					linkType: 'related_to',
					weight: 0.84,
					neighbor: expect.objectContaining({ displayName: 'Ethereum' }),
					explanation: 'Connected by related to with 1 supporting evidence row.',
					evidence: [
						expect.objectContaining({
							claimLabel: 'inferred',
							snippet: 'Alice connected DeFi and Ethereum in one thread.',
						}),
					],
				}),
			]);
		});
	});

	describe('getKnowledgeNodeAction', () => {
		it('returns node and linked contacts for correct workspace', async () => {
			const mockContact = {
				id: CONTACT_ID_1,
				workspaceId: WORKSPACE_ID,
				firstName: 'Alice',
				lastName: 'Smith',
			};
			mockGetKnowledgeNode.mockResolvedValue(mockNode);
			mockListContactsByKnowledge.mockResolvedValue([{ contact: mockContact }]);

			const { getKnowledgeNodeAction } = await import('@/app/actions/knowledge');
			const result = await getKnowledgeNodeAction({ id: NODE_ID_1 });

			expect(result?.data?.node).toEqual(mockNode);
			// SEC-006: Only projected fields (id, firstName, lastName) should be returned — no phone/email/notes/blind indexes
			expect(result?.data?.contacts).toEqual([
				{ id: CONTACT_ID_1, firstName: 'Alice', lastName: 'Smith' },
			]);
			// SEC-W04: workspaceId must be first arg so DAL enforces isolation at query level
			expect(mockGetKnowledgeNode).toHaveBeenCalledWith(WORKSPACE_ID, NODE_ID_1, MOCK_ENVELOPE);
			expect(mockListContactsByKnowledge).toHaveBeenCalledWith(
				NODE_ID_1,
				WORKSPACE_ID,
				expect.anything(),
			);
		});

		it('returns null when node does not exist in workspace (BOLA prevention — DAL returns null)', async () => {
			// DAL now enforces workspace_id in WHERE clause, so cross-workspace access returns null
			mockGetKnowledgeNode.mockResolvedValue(null);

			const { getKnowledgeNodeAction } = await import('@/app/actions/knowledge');
			const result = await getKnowledgeNodeAction({ id: NODE_ID_1 });

			expect(result?.data).toBeNull();
			expect(mockListContactsByKnowledge).not.toHaveBeenCalled();
		});

		it('returns null when node does not exist', async () => {
			mockGetKnowledgeNode.mockResolvedValue(null);

			const { getKnowledgeNodeAction } = await import('@/app/actions/knowledge');
			const result = await getKnowledgeNodeAction({ id: NODE_ID_NONEXISTENT });

			expect(result?.data).toBeNull();
		});

		it('SEC-119: rejects non-UUID node id', async () => {
			const { getKnowledgeNodeAction } = await import('@/app/actions/knowledge');
			const result = await getKnowledgeNodeAction({ id: 'not-a-uuid' });
			expect(result?.validationErrors).toBeDefined();
			expect(mockGetKnowledgeNode).not.toHaveBeenCalled();
		});
	});

	describe('knowledge evidence actions', () => {
		it('returns node evidence with workspace-scoped node verification', async () => {
			const evidence = [
				{
					id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
					workspaceId: WORKSPACE_ID,
					knowledgeNodeId: NODE_ID_1,
					contactId: CONTACT_ID_1,
					relationType: 'knows_about',
					evidenceKind: 'llm_extracted',
					confidence: 0.9,
					snippet: 'We talked about DeFi liquidity.',
					occurredAt: new Date(),
					createdAt: new Date(),
				},
			];
			mockGetKnowledgeNode.mockResolvedValue(mockNode);
			mockListEvidenceForKnowledgeNode.mockResolvedValue(evidence);

			const { getKnowledgeEvidenceAction } = await import('@/app/actions/knowledge');
			const result = await getKnowledgeEvidenceAction({ nodeId: NODE_ID_1, limit: 10 });

			expect(result?.data).toEqual([
				{
					id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
					knowledgeNodeId: NODE_ID_1,
					relatedKnowledgeNodeId: undefined,
					contactId: CONTACT_ID_1,
					messageId: undefined,
					relationType: 'knows_about',
					evidenceKind: 'llm_extracted',
					claimLabel: 'explicit',
					confidence: 0.9,
					snippet: 'We talked about DeFi liquidity.',
					occurredAt: evidence[0]?.occurredAt,
					createdAt: evidence[0]?.createdAt,
					metadata: undefined,
				},
			]);
			expect(JSON.stringify(result?.data)).not.toContain(WORKSPACE_ID);
			expect(mockGetKnowledgeNode).toHaveBeenCalledWith(WORKSPACE_ID, NODE_ID_1, MOCK_ENVELOPE);
			expect(mockListEvidenceForKnowledgeNode).toHaveBeenCalledWith(
				WORKSPACE_ID,
				NODE_ID_1,
				MOCK_ENVELOPE,
				{ limit: 10 },
			);
		});

		it('returns node/contact evidence when contactId is provided', async () => {
			mockGetKnowledgeNode.mockResolvedValue(mockNode);
			mockListEvidenceForKnowledgeContact.mockResolvedValue([]);

			const { getKnowledgeEvidenceAction } = await import('@/app/actions/knowledge');
			await getKnowledgeEvidenceAction({
				nodeId: NODE_ID_1,
				contactId: CONTACT_ID_1,
				limit: 5,
			});

			expect(mockListEvidenceForKnowledgeContact).toHaveBeenCalledWith(
				WORKSPACE_ID,
				NODE_ID_1,
				CONTACT_ID_1,
				MOCK_ENVELOPE,
				{ limit: 5 },
			);
		});

		it('does not read evidence when node is outside the workspace', async () => {
			mockGetKnowledgeNode.mockResolvedValue(null);

			const { getKnowledgeEvidenceAction } = await import('@/app/actions/knowledge');
			const result = await getKnowledgeEvidenceAction({ nodeId: NODE_ID_1 });

			expect(result?.data).toEqual([]);
			expect(mockListEvidenceForKnowledgeNode).not.toHaveBeenCalled();
			expect(mockListEvidenceForKnowledgeContact).not.toHaveBeenCalled();
		});

		it('returns contacts with projected evidence fields', async () => {
			const evidenceDate = new Date('2026-05-01T00:00:00Z');
			mockGetKnowledgeNode.mockResolvedValue(mockNode);
			mockListContactsWithEvidenceForKnowledgeNode.mockResolvedValue([
				{
					contact: {
						id: CONTACT_ID_1,
						workspaceId: WORKSPACE_ID,
						firstName: 'Alice',
						lastName: 'Smith',
						phone: '+15555555555',
					},
					link: {
						relationType: 'knows_about',
						strength: 0.9,
						evidenceCount: 1,
						lastEvidenceAt: evidenceDate,
					},
					evidence: [
						{
							id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
							messageId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
							relationType: 'knows_about',
							evidenceKind: 'llm_extracted',
							claimLabel: 'explicit',
							confidence: 0.9,
							snippet: 'Alice mentioned DeFi liquidity.',
							occurredAt: evidenceDate,
							createdAt: evidenceDate,
							metadata: { source: 'test' },
						},
					],
				},
			]);

			const { getKnowledgeContactsWithEvidenceAction } = await import('@/app/actions/knowledge');
			const result = await getKnowledgeContactsWithEvidenceAction({ nodeId: NODE_ID_1 });

			expect(result?.data).toEqual([
				{
					contact: { id: CONTACT_ID_1, firstName: 'Alice', lastName: 'Smith' },
					relationType: 'knows_about',
					strength: 0.9,
					evidenceCount: 1,
					lastEvidenceAt: evidenceDate,
					evidence: [
						{
							id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
							messageId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
							relationType: 'knows_about',
							evidenceKind: 'llm_extracted',
							claimLabel: 'explicit',
							confidence: 0.9,
							snippet: 'Alice mentioned DeFi liquidity.',
							occurredAt: evidenceDate,
							createdAt: evidenceDate,
							metadata: { source: 'test' },
						},
					],
				},
			]);
			expect(JSON.stringify(result?.data)).not.toContain('+15555555555');
			expect(JSON.stringify(result?.data)).not.toContain('workspaceId');
			expect(JSON.stringify(result?.data)).not.toContain('embedding');
		});

		it('does not read contacts with evidence when node is outside the workspace', async () => {
			mockGetKnowledgeNode.mockResolvedValue(null);

			const { getKnowledgeContactsWithEvidenceAction } = await import('@/app/actions/knowledge');
			const result = await getKnowledgeContactsWithEvidenceAction({ nodeId: NODE_ID_1 });

			expect(result?.data).toEqual([]);
			expect(mockListContactsWithEvidenceForKnowledgeNode).not.toHaveBeenCalled();
		});
	});

	describe('getContactKnowledgeAction', () => {
		it('returns knowledge nodes linked to the contact, scoped to workspace (SEC-114)', async () => {
			mockListKnowledgeByContact.mockResolvedValue([mockNode]);

			const { getContactKnowledgeAction } = await import('@/app/actions/knowledge');
			const result = await getContactKnowledgeAction({ contactId: CONTACT_ID_1 });

			expect(result?.data).toEqual([mockNode]);
			// workspaceId MUST be passed — prevents BOLA cross-workspace data access
			expect(mockListKnowledgeByContact).toHaveBeenCalledWith(
				CONTACT_ID_1,
				WORKSPACE_ID,
				MOCK_ENVELOPE,
			);
		});

		it('returns empty array when contact has no knowledge links', async () => {
			mockListKnowledgeByContact.mockResolvedValue([]);

			const { getContactKnowledgeAction } = await import('@/app/actions/knowledge');
			const result = await getContactKnowledgeAction({ contactId: CONTACT_ID_2 });

			expect(result?.data).toEqual([]);
			expect(mockListKnowledgeByContact).toHaveBeenCalledWith(
				CONTACT_ID_2,
				WORKSPACE_ID,
				MOCK_ENVELOPE,
			);
		});
	});

	describe('getKnowledgeNeighborsAction', () => {
		const mockLink = {
			id: '77777777-7777-4777-8777-777777777777',
			workspaceId: WORKSPACE_ID,
			sourceNodeId: NODE_ID_1,
			targetNodeId: NODE_ID_2,
			linkType: 'related_to',
			weight: 1.0,
			createdAt: new Date(),
		};

		it('returns outbound and inbound neighbors scoped to workspace', async () => {
			const mockNeighbors = [{ link: mockLink, node: mockNodeB, direction: 'outbound' as const }];
			mockGetKnowledgeNeighbors.mockResolvedValue(mockNeighbors);

			const { getKnowledgeNeighborsAction } = await import('@/app/actions/knowledge');
			const result = await getKnowledgeNeighborsAction({ nodeId: NODE_ID_1 });

			expect(result?.data).toEqual(mockNeighbors);
			expect(mockGetKnowledgeNeighbors).toHaveBeenCalledWith(
				NODE_ID_1,
				WORKSPACE_ID,
				MOCK_ENVELOPE,
			);
		});

		it('returns empty array when node has no links', async () => {
			mockGetKnowledgeNeighbors.mockResolvedValue([]);

			const { getKnowledgeNeighborsAction } = await import('@/app/actions/knowledge');
			const result = await getKnowledgeNeighborsAction({ nodeId: NODE_ID_ISOLATED });

			expect(result?.data).toEqual([]);
			expect(mockGetKnowledgeNeighbors).toHaveBeenCalledWith(
				NODE_ID_ISOLATED,
				WORKSPACE_ID,
				MOCK_ENVELOPE,
			);
		});

		it('SEC-119: rejects non-UUID nodeId', async () => {
			const { getKnowledgeNeighborsAction } = await import('@/app/actions/knowledge');
			const result = await getKnowledgeNeighborsAction({ nodeId: 'node-1' });
			expect(result?.validationErrors).toBeDefined();
			expect(mockGetKnowledgeNeighbors).not.toHaveBeenCalled();
		});
	});

	describe('getSharedKnowledgeAction', () => {
		it('returns knowledge nodes shared between two contacts', async () => {
			mockGetSharedKnowledge.mockResolvedValue([mockNode, mockNodeB]);

			const { getSharedKnowledgeAction } = await import('@/app/actions/knowledge');
			const result = await getSharedKnowledgeAction({
				contactIdA: CONTACT_ID_1,
				contactIdB: CONTACT_ID_2,
			});

			expect(result?.data).toEqual([mockNode, mockNodeB]);
			expect(mockGetSharedKnowledge).toHaveBeenCalledWith(
				CONTACT_ID_1,
				CONTACT_ID_2,
				WORKSPACE_ID,
				MOCK_ENVELOPE,
			);
		});

		it('returns empty array when contacts share no knowledge', async () => {
			mockGetSharedKnowledge.mockResolvedValue([]);

			const { getSharedKnowledgeAction } = await import('@/app/actions/knowledge');
			const result = await getSharedKnowledgeAction({
				contactIdA: CONTACT_ID_3,
				contactIdB: CONTACT_ID_4,
			});

			expect(result?.data).toEqual([]);
			expect(mockGetSharedKnowledge).toHaveBeenCalledWith(
				CONTACT_ID_3,
				CONTACT_ID_4,
				WORKSPACE_ID,
				MOCK_ENVELOPE,
			);
		});

		it('passes workspaceId — prevents cross-workspace shared knowledge leakage', async () => {
			mockGetSharedKnowledge.mockResolvedValue([mockNode]);

			const { getSharedKnowledgeAction } = await import('@/app/actions/knowledge');
			await getSharedKnowledgeAction({ contactIdA: CONTACT_ID_1, contactIdB: CONTACT_ID_2 });

			const call = mockGetSharedKnowledge.mock.calls[0];
			expect(call[2]).toBe(WORKSPACE_ID);
		});

		it('SEC-119: rejects non-UUID contactIdA', async () => {
			const { getSharedKnowledgeAction } = await import('@/app/actions/knowledge');
			const result = await getSharedKnowledgeAction({
				contactIdA: 'contact-1',
				contactIdB: CONTACT_ID_2,
			});
			expect(result?.validationErrors).toBeDefined();
			expect(mockGetSharedKnowledge).not.toHaveBeenCalled();
		});
	});

	describe('mergeKnowledgeNodesAction', () => {
		it('merges two nodes successfully', async () => {
			mockGetKnowledgeNode.mockImplementation((_ws: string, id: string) => {
				if (id === NODE_ID_1) return Promise.resolve(mockNode);
				if (id === NODE_ID_2) return Promise.resolve(mockNodeB);
				return Promise.resolve(null);
			});
			mockMergeKnowledgeNodes.mockResolvedValue(undefined);

			const { mergeKnowledgeNodesAction } = await import('@/app/actions/knowledge');
			const result = await mergeKnowledgeNodesAction({
				survivorId: NODE_ID_1,
				mergedId: NODE_ID_2,
			});

			expect(result?.data).toEqual({ success: true });
			expect(mockMergeKnowledgeNodes).toHaveBeenCalledWith(
				WORKSPACE_ID,
				NODE_ID_1,
				NODE_ID_2,
				MOCK_ENVELOPE,
			);
		});

		it('rejects self-merge', async () => {
			const { mergeKnowledgeNodesAction } = await import('@/app/actions/knowledge');
			const result = await mergeKnowledgeNodesAction({
				survivorId: NODE_ID_1,
				mergedId: NODE_ID_1,
			});

			expect(result?.serverError).toBeDefined();
			expect(mockMergeKnowledgeNodes).not.toHaveBeenCalled();
		});

		it('BOLA: rejects when survivor node not in workspace', async () => {
			mockGetKnowledgeNode.mockImplementation((_ws: string, id: string) => {
				if (id === NODE_ID_1) return Promise.resolve(null);
				if (id === NODE_ID_2) return Promise.resolve(mockNodeB);
				return Promise.resolve(null);
			});

			const { mergeKnowledgeNodesAction } = await import('@/app/actions/knowledge');
			const result = await mergeKnowledgeNodesAction({
				survivorId: NODE_ID_1,
				mergedId: NODE_ID_2,
			});

			expect(result?.serverError).toBeDefined();
			expect(mockMergeKnowledgeNodes).not.toHaveBeenCalled();
		});

		it('SEC-119: rejects non-UUID survivorId', async () => {
			const { mergeKnowledgeNodesAction } = await import('@/app/actions/knowledge');
			const result = await mergeKnowledgeNodesAction({
				survivorId: 'not-a-uuid',
				mergedId: NODE_ID_2,
			});

			expect(result?.validationErrors).toBeDefined();
			expect(mockMergeKnowledgeNodes).not.toHaveBeenCalled();
		});
	});

	describe('findMergeCandidatesAction', () => {
		it('returns similar nodes excluding self', async () => {
			mockGetKnowledgeNode.mockResolvedValue(mockNode);
			mockSearchKnowledgeNodes.mockResolvedValue([mockNode, mockNodeB]);

			const { findMergeCandidatesAction } = await import('@/app/actions/knowledge');
			const result = await findMergeCandidatesAction({ nodeId: NODE_ID_1 });

			expect(result?.data).toHaveLength(1);
			expect(result?.data?.[0]?.id).toBe(NODE_ID_2);
			expect(mockSearchKnowledgeNodes).toHaveBeenCalledWith(
				WORKSPACE_ID,
				'defi',
				undefined,
				MOCK_ENVELOPE,
			);
		});

		it('returns empty when node not found', async () => {
			mockGetKnowledgeNode.mockResolvedValue(null);

			const { findMergeCandidatesAction } = await import('@/app/actions/knowledge');
			const result = await findMergeCandidatesAction({ nodeId: NODE_ID_NONEXISTENT });

			expect(result?.data).toEqual([]);
			expect(mockSearchKnowledgeNodes).not.toHaveBeenCalled();
		});
	});

	describe('getGraphDataAction', () => {
		it('returns graph data with nodes and links', async () => {
			const graphData = {
				nodes: [mockNode, mockNodeB],
				links: [
					{
						id: '77777777-7777-4777-8777-777777777777',
						workspaceId: WORKSPACE_ID,
						sourceNodeId: NODE_ID_1,
						targetNodeId: NODE_ID_2,
						linkType: 'related_to',
						weight: 0.8,
						createdAt: new Date(),
					},
				],
			};
			mockGetGraphData.mockResolvedValue(graphData);

			const { getGraphDataAction } = await import('@/app/actions/knowledge');
			const result = await getGraphDataAction({ maxNodes: 100 });

			expect(result?.data).toEqual(graphData);
			expect(mockGetGraphData).toHaveBeenCalledWith(WORKSPACE_ID, 100, MOCK_ENVELOPE);
		});

		it('uses default maxNodes of 200', async () => {
			mockGetGraphData.mockResolvedValue({ nodes: [], links: [] });

			const { getGraphDataAction } = await import('@/app/actions/knowledge');
			await getGraphDataAction({});

			expect(mockGetGraphData).toHaveBeenCalledWith(WORKSPACE_ID, 200, MOCK_ENVELOPE);
		});
	});
});
