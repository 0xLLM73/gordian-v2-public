import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
	headers: vi.fn(() => Promise.resolve(new Headers())),
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

vi.mock('@/lib/workspace', () => ({
	getUserWorkspaceId: vi.fn(() => Promise.resolve(WORKSPACE_ID)),
	getWorkspaceEnvelope: vi.fn(() =>
		Promise.resolve({
			encryptedWrk: Buffer.from('mock'),
			kmsContext: { WorkspaceID: 'mock' },
			wrkVersion: 1,
		}),
	),
}));

const mockGetAllRelationships = vi.fn();
const mockGetHealthScoresByWorkspace = vi.fn();
const mockListContacts = vi.fn();
const mockDeriveGroupChatRelationships = vi.fn().mockResolvedValue(0);

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	getAllRelationships: mockGetAllRelationships,
	getHealthScoresByWorkspace: mockGetHealthScoresByWorkspace,
	listContacts: mockListContacts,
	deriveGroupChatRelationships: mockDeriveGroupChatRelationships,
}));

const CONTACT_A = '00000000-0000-0000-0000-000000000001';
const CONTACT_B = '00000000-0000-0000-0000-000000000002';
const CONTACT_C = '00000000-0000-0000-0000-000000000003';

const mockRelationship = {
	id: 'rel-1',
	workspaceId: WORKSPACE_ID,
	sourceContactId: CONTACT_A,
	targetContactId: CONTACT_B,
	relationshipType: 'professional',
	strength: 0.8,
	source: 'ai_extracted',
	evidence: {},
	notes: null,
	sharingLevel: 'private',
	createdAt: new Date(),
	updatedAt: new Date(),
};

const mockContacts = [
	{ id: CONTACT_A, firstName: 'Alice', lastName: 'Smith' },
	{ id: CONTACT_B, firstName: 'Bob', lastName: null },
	{ id: CONTACT_C, firstName: null, lastName: null },
];

const mockHealthScores = [
	{ contactId: CONTACT_A, label: 'thriving', composite: 0.9 },
	{ contactId: CONTACT_B, label: 'healthy', composite: 0.6 },
];

describe('getNetworkGraphAction', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockListContacts.mockResolvedValue(mockContacts);
		mockGetHealthScoresByWorkspace.mockResolvedValue(mockHealthScores);
	});

	it('returns empty graph when no relationships exist', async () => {
		mockGetAllRelationships.mockResolvedValue([]);
		const { getNetworkGraphAction } = await import('@/app/actions/network');
		const result = await getNetworkGraphAction({});
		expect(result?.data).toEqual({ nodes: [], links: [] });
	});

	it('returns nodes and links for existing relationships', async () => {
		mockGetAllRelationships.mockResolvedValue([mockRelationship]);
		const { getNetworkGraphAction } = await import('@/app/actions/network');
		const result = await getNetworkGraphAction({});
		expect(result?.data?.nodes).toHaveLength(2);
		expect(result?.data?.links).toHaveLength(1);
	});

	it('builds link with correct source, target, strength, and type', async () => {
		mockGetAllRelationships.mockResolvedValue([mockRelationship]);
		const { getNetworkGraphAction } = await import('@/app/actions/network');
		const result = await getNetworkGraphAction({});
		const link = result?.data?.links[0];
		expect(link?.source).toBe(CONTACT_A);
		expect(link?.target).toBe(CONTACT_B);
		expect(link?.strength).toBe(0.8);
		expect(link?.relationshipType).toBe('professional');
	});

	it('applies health label from Phase 14 scores', async () => {
		mockGetAllRelationships.mockResolvedValue([mockRelationship]);
		const { getNetworkGraphAction } = await import('@/app/actions/network');
		const result = await getNetworkGraphAction({});
		const nodeA = result?.data?.nodes.find((n) => n.id === CONTACT_A);
		expect(nodeA?.healthLabel).toBe('thriving');
		expect(nodeA?.composite).toBe(0.9);
		const nodeB = result?.data?.nodes.find((n) => n.id === CONTACT_B);
		expect(nodeB?.healthLabel).toBe('healthy');
	});

	it('falls back to unknown label when no health score exists', async () => {
		mockGetAllRelationships.mockResolvedValue([
			{ ...mockRelationship, sourceContactId: CONTACT_C, targetContactId: CONTACT_A },
		]);
		mockGetHealthScoresByWorkspace.mockResolvedValue([]); // no scores
		const { getNetworkGraphAction } = await import('@/app/actions/network');
		const result = await getNetworkGraphAction({});
		const nodeC = result?.data?.nodes.find((n) => n.id === CONTACT_C);
		expect(nodeC?.healthLabel).toBe('unknown');
		expect(nodeC?.composite).toBe(0);
	});

	it('degrades gracefully when relationships query fails', async () => {
		mockGetAllRelationships.mockRejectedValue(new Error('DB error'));
		const { getNetworkGraphAction } = await import('@/app/actions/network');
		const result = await getNetworkGraphAction({});
		expect(result?.data).toEqual({ nodes: [], links: [] });
	});

	it('degrades gracefully when health scores query fails', async () => {
		mockGetAllRelationships.mockResolvedValue([mockRelationship]);
		mockGetHealthScoresByWorkspace.mockRejectedValue(new Error('DB error'));
		const { getNetworkGraphAction } = await import('@/app/actions/network');
		const result = await getNetworkGraphAction({});
		// Should still return graph data, just without health labels
		expect(result?.data?.nodes).toHaveLength(2);
		expect(result?.data?.links).toHaveLength(1);
	});

	it('counts connections per node correctly', async () => {
		const rel2 = {
			...mockRelationship,
			id: 'rel-2',
			sourceContactId: CONTACT_A,
			targetContactId: CONTACT_C,
		};
		mockGetAllRelationships.mockResolvedValue([mockRelationship, rel2]);
		mockListContacts.mockResolvedValue([...mockContacts]);
		const { getNetworkGraphAction } = await import('@/app/actions/network');
		const result = await getNetworkGraphAction({});
		const nodeA = result?.data?.nodes.find((n) => n.id === CONTACT_A);
		// A appears in both relationships
		expect(nodeA?.connectionCount).toBe(2);
	});

	it('passes minStrength filter through to getAllRelationships', async () => {
		mockGetAllRelationships.mockResolvedValue([]);
		const { getNetworkGraphAction } = await import('@/app/actions/network');
		await getNetworkGraphAction({ minStrength: 0.7 });
		expect(mockGetAllRelationships).toHaveBeenCalledWith(
			WORKSPACE_ID,
			expect.any(Object), // envelope
			expect.objectContaining({ minStrength: 0.7 }),
		);
	});

	it('uses decrypted contact name from listContacts', async () => {
		mockGetAllRelationships.mockResolvedValue([mockRelationship]);
		const { getNetworkGraphAction } = await import('@/app/actions/network');
		const result = await getNetworkGraphAction({});
		const nodeA = result?.data?.nodes.find((n) => n.id === CONTACT_A);
		expect(nodeA?.name).toBe('Alice Smith');
		// Bob has no last name
		const nodeB = result?.data?.nodes.find((n) => n.id === CONTACT_B);
		expect(nodeB?.name).toBe('Bob');
	});
});
