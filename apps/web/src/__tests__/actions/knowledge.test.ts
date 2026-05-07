import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
	headers: vi.fn(() => Promise.resolve(new Headers())),
}));

vi.mock('@/lib/track', () => ({
	track: vi.fn(),
	trackEvent: vi.fn(),
}));

vi.mock('@repo/crypto', () => ({
	withKeys: vi.fn((_envelope: unknown, fn: () => unknown) => fn()),
	unwrapWrk: vi.fn(() => Promise.resolve(Buffer.from('mock-wrk'))),
	deriveKeys: vi.fn(() => Promise.resolve({ bik: Buffer.from('mock-bik') })),
	prefilterEntities: vi.fn(() => []),
	maskEntities: vi.fn((text: string) => ({ maskedText: text })),
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
const mockListKnowledgeByContact = vi.fn();
const mockGetKnowledgeNeighbors = vi.fn();
const mockGetSharedKnowledge = vi.fn();
const mockMergeKnowledgeNodes = vi.fn();
const mockGetGraphData = vi.fn();

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	listKnowledgeNodes: mockListKnowledgeNodes,
	searchKnowledgeNodes: mockSearchKnowledgeNodes,
	getKnowledgeNode: mockGetKnowledgeNode,
	listContactsByKnowledge: mockListContactsByKnowledge,
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

describe('knowledge actions', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		vi.stubEnv('OPENAI_API_KEY', 'test-key');
	});

	describe('listKnowledgeNodesAction', () => {
		it('returns all nodes when no filter or query', async () => {
			mockListKnowledgeNodes.mockResolvedValue([mockNode]);

			const { listKnowledgeNodesAction } = await import('@/app/actions/knowledge');
			const result = await listKnowledgeNodesAction({ limit: 20, offset: 0 });

			expect(result?.data).toEqual([{ ...mockNode, contactCount: 0, contactPreviews: [] }]);
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

		it('calls searchKnowledgeNodes when query is provided', async () => {
			mockSearchKnowledgeNodes.mockResolvedValue([mockNode]);

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

				expect(result?.data).toEqual([{ ...mockNode, contactCount: 0, contactPreviews: [] }]);
				expect(mockSearchKnowledgeNodes).toHaveBeenCalledWith(
					WORKSPACE_ID,
					'defi',
					mockEmbedding,
					MOCK_ENVELOPE,
				);
				expect(mockListKnowledgeNodes).not.toHaveBeenCalled();
			} finally {
				globalThis.fetch = originalFetch;
			}
		});

		it('falls back to text search when embeddings are not configured', async () => {
			vi.stubEnv('OPENAI_API_KEY', '');
			mockSearchKnowledgeNodes.mockResolvedValue([mockNode]);
			const fetchSpy = vi.spyOn(globalThis, 'fetch');

			const { listKnowledgeNodesAction } = await import('@/app/actions/knowledge');
			const result = await listKnowledgeNodesAction({ query: 'defi', limit: 20, offset: 0 });

			expect(result?.data).toEqual([{ ...mockNode, contactCount: 0, contactPreviews: [] }]);
			expect(mockSearchKnowledgeNodes).toHaveBeenCalledWith(
				WORKSPACE_ID,
				'defi',
				undefined,
				MOCK_ENVELOPE,
			);
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
