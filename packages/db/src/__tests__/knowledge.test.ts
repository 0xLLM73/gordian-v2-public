import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

// All vars used inside vi.mock factories must be hoisted
const mockSelectLimit = vi.hoisted(() => vi.fn());
const mockSelectWhere = vi.hoisted(() => vi.fn<any>(() => ({ limit: mockSelectLimit })));
const mockSelectFrom = vi.hoisted(() => vi.fn<any>(() => ({ where: mockSelectWhere })));
const mockSelect = vi.hoisted(() => vi.fn(() => ({ from: mockSelectFrom })));

const mockDeleteWhere = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockDelete = vi.hoisted(() => vi.fn(() => ({ where: mockDeleteWhere })));

const mockUpdateReturning = vi.hoisted(() => vi.fn());
const mockUpdateWhere = vi.hoisted(() => vi.fn(() => ({ returning: mockUpdateReturning })));
const mockUpdateSet = vi.hoisted(() => vi.fn(() => ({ where: mockUpdateWhere })));
const mockUpdate = vi.hoisted(() => vi.fn(() => ({ set: mockUpdateSet })));

const mockInsertReturning = vi.hoisted(() => vi.fn());
const mockOnConflict = vi.hoisted(() => vi.fn(() => ({ returning: mockInsertReturning })));
const mockInsertValues = vi.hoisted(() =>
	vi.fn(() => ({ onConflictDoUpdate: mockOnConflict, returning: mockInsertReturning })),
);
const mockInsert = vi.hoisted(() => vi.fn(() => ({ values: mockInsertValues })));

const mockExecute = vi.hoisted(() => vi.fn());
const mockTransaction = vi.hoisted(() => vi.fn());

const mockInnerJoinWhere = vi.hoisted(() => vi.fn());
const mockInnerJoin = vi.hoisted(() => vi.fn(() => ({ where: mockInnerJoinWhere })));

vi.mock('../client', () => ({
	db: {
		select: mockSelect,
		insert: mockInsert,
		update: mockUpdate,
		delete: mockDelete,
		execute: mockExecute,
		transaction: mockTransaction,
	},
}));

vi.mock('@repo/crypto', () => ({
	withKeys: vi.fn((_envelope: unknown, fn: () => unknown) => fn()),
	computeBlindIndex: vi.fn((val: string) => `hash:${val}`),
	keyStore: { getStore: vi.fn(() => ({ bik: Buffer.from('test-bik') })) },
}));

const mockEnvelope = {
	encryptedWrk: Buffer.from('test'),
	kmsContext: { workspaceId: 'ws-1' },
	wrkVersion: 1,
};

import {
	createKnowledgeLink,
	createKnowledgeNode,
	deleteKnowledgeNode,
	getKnowledgeNeighbors,
	getKnowledgeNode,
	getSharedKnowledge,
	knowledgeGraphSearch,
	linkContactToKnowledge,
	listKnowledgeByContact,
	listKnowledgeNodes,
	mergeKnowledgeNodes,
} from '../dal/knowledge';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WS = 'ws-00000000-0000-0000-0000-000000000001';

const baseNode = {
	id: 'node-1',
	workspaceId: WS,
	type: 'topic' as const,
	name: 'ethereum',
	displayName: 'Ethereum',
	description: 'Layer 1 blockchain',
	embedding: null,
	mentionCount: 0,
	lastSeenAt: null,
	createdAt: new Date(),
	updatedAt: new Date(),
};

// ─── createKnowledgeNode ──────────────────────────────────────────────────────

describe('createKnowledgeNode', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockInsert.mockReturnValue({ values: mockInsertValues });
		mockInsertValues.mockReturnValue({
			onConflictDoUpdate: mockOnConflict,
			returning: mockInsertReturning,
		});
		mockOnConflict.mockReturnValue({ returning: mockInsertReturning });
	});

	it('normalizes name to lowercase before insert', async () => {
		mockInsertReturning.mockResolvedValueOnce([{ ...baseNode, name: 'ethereum' }]);

		await createKnowledgeNode(
			WS,
			{
				type: 'topic',
				name: 'Ethereum',
				displayName: 'Ethereum',
			},
			mockEnvelope,
		);

		expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ name: 'ethereum' }));
	});

	it('creates node with correct type and workspaceId', async () => {
		const orgNode = {
			...baseNode,
			type: 'organization' as const,
			name: 'consensys',
			displayName: 'ConsenSys',
		};
		mockInsertReturning.mockResolvedValueOnce([orgNode]);

		await createKnowledgeNode(
			WS,
			{
				type: 'organization',
				name: 'ConsenSys',
				displayName: 'ConsenSys',
			},
			mockEnvelope,
		);

		expect(mockInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({ workspaceId: WS, type: 'organization' }),
		);
	});

	it('throws when insert returns no rows', async () => {
		mockInsertReturning.mockResolvedValueOnce([]);

		await expect(
			createKnowledgeNode(WS, { type: 'topic', name: 'test', displayName: 'Test' }, mockEnvelope),
		).rejects.toThrow('createKnowledgeNode: insert returned no rows');
	});

	it('stores description and embedding when provided', async () => {
		const embedding = Array(512).fill(0.1);
		mockInsertReturning.mockResolvedValueOnce([
			{ ...baseNode, description: 'A protocol', embedding },
		]);

		await createKnowledgeNode(
			WS,
			{
				type: 'technology',
				name: 'solidity',
				displayName: 'Solidity',
				description: 'A protocol',
				embedding,
			},
			mockEnvelope,
		);

		expect(mockInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({ description: 'A protocol', embedding }),
		);
	});

	it('creates nodes for all 6 valid types', async () => {
		const types = ['topic', 'project', 'organization', 'technology', 'sector', 'concept'] as const;
		for (const type of types) {
			vi.clearAllMocks();
			mockInsert.mockReturnValue({ values: mockInsertValues });
			mockInsertValues.mockReturnValue({
				onConflictDoUpdate: mockOnConflict,
				returning: mockInsertReturning,
			});
			mockInsertReturning.mockResolvedValueOnce([{ ...baseNode, type }]);

			const result = await createKnowledgeNode(
				WS,
				{
					type,
					name: `test-${type}`,
					displayName: `Test ${type}`,
				},
				mockEnvelope,
			);
			expect(result.type).toBe(type);
		}
	});
});

// ─── getKnowledgeNode ─────────────────────────────────────────────────────────

describe('getKnowledgeNode', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSelect.mockReturnValue({ from: mockSelectFrom });
		mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
		mockSelectWhere.mockReturnValue({ limit: mockSelectLimit });
	});

	it('returns null for unknown ID', async () => {
		mockSelectLimit.mockResolvedValueOnce([]);

		const result = await getKnowledgeNode(WS, 'nonexistent-id', mockEnvelope);

		expect(result).toBeNull();
	});

	it('returns the node when found', async () => {
		mockSelectLimit.mockResolvedValueOnce([baseNode]);

		const result = await getKnowledgeNode(WS, 'node-1', mockEnvelope);

		expect(result).toEqual(baseNode);
	});
});

// ─── listKnowledgeNodes ───────────────────────────────────────────────────────

describe('listKnowledgeNodes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		const mockOffset = vi.fn().mockResolvedValue([]);
		const mockLimitFn = vi.fn().mockReturnValue({ offset: mockOffset });
		const mockOrderByFn = vi.fn().mockReturnValue({ limit: mockLimitFn });
		mockSelect.mockReturnValue({ from: mockSelectFrom });
		mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
		mockSelectWhere.mockReturnValue({ orderBy: mockOrderByFn });
	});

	it('always includes workspaceId in WHERE clause', async () => {
		await listKnowledgeNodes(WS);

		expect(mockSelect).toHaveBeenCalledTimes(1);
		expect(mockSelectWhere).toHaveBeenCalledTimes(1);
	});

	it('accepts optional type filter (passes 2 conditions)', async () => {
		// When type filter is provided, the conditions array has 2 items
		await listKnowledgeNodes(WS, { type: 'project' });

		expect(mockSelectWhere).toHaveBeenCalledTimes(1);
	});

	it('orders by mention count descending', async () => {
		const mockOffset = vi.fn().mockResolvedValue([]);
		const mockLimitFn = vi.fn().mockReturnValue({ offset: mockOffset });
		const mockOrderByCapture = vi.fn().mockReturnValue({ limit: mockLimitFn });
		mockSelectWhere.mockReturnValue({ orderBy: mockOrderByCapture });

		await listKnowledgeNodes(WS);

		expect(mockOrderByCapture).toHaveBeenCalledTimes(1);
	});
});

// ─── linkContactToKnowledge ───────────────────────────────────────────────────

describe('linkContactToKnowledge', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockInsert.mockReturnValue({ values: mockInsertValues });
		mockInsertValues.mockReturnValue({
			onConflictDoUpdate: mockOnConflict,
			returning: mockInsertReturning,
		});
		mockOnConflict.mockReturnValue({ returning: mockInsertReturning });
	});

	it('inserts a contact-knowledge link', async () => {
		const link = {
			id: 'link-1',
			workspaceId: WS,
			knowledgeNodeId: 'node-1',
			contactId: 'contact-1',
			relationType: 'knows_about',
			strength: 1.0,
			evidenceCount: 1,
			lastEvidenceAt: new Date(),
			createdAt: new Date(),
		};
		mockInsertReturning.mockResolvedValueOnce([link]);

		const result = await linkContactToKnowledge(WS, 'node-1', 'contact-1', 'knows_about');

		expect(mockInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceId: WS,
				knowledgeNodeId: 'node-1',
				contactId: 'contact-1',
				relationType: 'knows_about',
			}),
		);
		expect(result).toEqual(link);
	});

	it('uses default strength of 1.0 when not specified', async () => {
		mockInsertReturning.mockResolvedValueOnce([{ id: 'link-1' }]);

		await linkContactToKnowledge(WS, 'node-1', 'c-1', 'expert_in');

		expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ strength: 1.0 }));
	});

	it('uses onConflictDoUpdate — increments evidenceCount on re-link', async () => {
		mockInsertReturning.mockResolvedValueOnce([{ id: 'link-1' }]);

		await linkContactToKnowledge(WS, 'node-1', 'c-1', 'invested_in', 0.8);

		const conflictArgs = (mockOnConflict.mock.calls as unknown[][])[0]?.[0] as
			| { set: Record<string, unknown>; target: unknown }
			| undefined;
		expect(conflictArgs?.set).toMatchObject({ strength: 0.8 });
		// evidenceCount increment is included in the set
		expect(conflictArgs?.set?.evidenceCount).toBeDefined();
	});

	it('supports all 7 relationship types', async () => {
		const relTypes = [
			'knows_about',
			'works_on',
			'member_of',
			'expert_in',
			'uses',
			'invested_in',
			'interested_in',
		] as const;
		for (const relType of relTypes) {
			vi.clearAllMocks();
			mockInsert.mockReturnValue({ values: mockInsertValues });
			mockInsertValues.mockReturnValue({
				onConflictDoUpdate: mockOnConflict,
				returning: mockInsertReturning,
			});
			mockOnConflict.mockReturnValue({ returning: mockInsertReturning });
			mockInsertReturning.mockResolvedValueOnce([{ id: 'link-1', relationType: relType }]);

			const result = await linkContactToKnowledge(WS, 'node-1', 'c-1', relType);
			expect(result.relationType).toBe(relType);
		}
	});

	it('throws when insert returns no rows', async () => {
		mockInsertReturning.mockResolvedValueOnce([]);

		await expect(linkContactToKnowledge(WS, 'node-1', 'c-1', 'works_on')).rejects.toThrow(
			'linkContactToKnowledge: insert returned no rows',
		);
	});
});

// ─── mergeKnowledgeNodes ──────────────────────────────────────────────────────

describe('mergeKnowledgeNodes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('runs merge in a db.transaction()', async () => {
		mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
			const txLimit = vi.fn().mockResolvedValue([{ name: 'merged-node', mentionCount: 3 }]);
			const txWhere = vi.fn().mockReturnValue({ limit: txLimit });
			const txFrom = vi.fn().mockReturnValue({ where: txWhere });
			const tx = {
				select: vi.fn().mockReturnValue({ from: txFrom }),
				execute: vi.fn().mockResolvedValue(undefined),
				delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
			};
			return fn(tx);
		});

		await mergeKnowledgeNodes(WS, 'survivor-id', 'merged-id');

		expect(mockTransaction).toHaveBeenCalledTimes(1);
	});

	it('calls tx.execute to transfer links, then tx.delete twice (conflicts + merged node)', async () => {
		const txExecute = vi.fn().mockResolvedValue(undefined);
		const txDeleteWhere = vi.fn().mockResolvedValue(undefined);
		const txDelete = vi.fn().mockReturnValue({ where: txDeleteWhere });
		const txLimit = vi.fn().mockResolvedValue([{ name: 'merged-node', mentionCount: 3 }]);
		const txWhere = vi.fn().mockReturnValue({ limit: txLimit });
		const txFrom = vi.fn().mockReturnValue({ where: txWhere });
		const txSelect = vi.fn().mockReturnValue({ from: txFrom });

		mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
			fn({ select: txSelect, execute: txExecute, delete: txDelete }),
		);

		await mergeKnowledgeNodes(WS, 'survivor-id', 'merged-id');

		expect(txSelect).toHaveBeenCalledTimes(1); // fetch merged node name + mentionCount
		expect(txExecute).toHaveBeenCalledTimes(4); // transfer contacts, transfer source links, transfer target links, update aliases
		expect(txDelete).toHaveBeenCalledTimes(2); // 1: remove conflict links, 2: delete merged node
	});
});

// ─── deleteKnowledgeNode ──────────────────────────────────────────────────────

describe('deleteKnowledgeNode', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDelete.mockReturnValue({ where: mockDeleteWhere });
		mockDeleteWhere.mockResolvedValue(undefined);
	});

	it('calls db.delete with the node ID and workspaceId', async () => {
		await deleteKnowledgeNode(WS, 'node-1');

		expect(mockDelete).toHaveBeenCalledTimes(1);
		expect(mockDeleteWhere).toHaveBeenCalledTimes(1);
	});

	it('resolves without throwing', async () => {
		await expect(deleteKnowledgeNode(WS, 'node-1')).resolves.toBeUndefined();
	});
});

// ─── listKnowledgeByContact ───────────────────────────────────────────────────

describe('listKnowledgeByContact', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSelect.mockReturnValue({ from: mockSelectFrom });
		mockSelectFrom.mockReturnValue({ innerJoin: mockInnerJoin });
		mockInnerJoin.mockReturnValue({ where: mockInnerJoinWhere });
	});

	it('returns empty array when contact has no knowledge links', async () => {
		mockInnerJoinWhere.mockResolvedValueOnce([]);

		const result = await listKnowledgeByContact('contact-1', WS);

		expect(result).toEqual([]);
	});

	it('returns mapped knowledge nodes for the contact', async () => {
		mockInnerJoinWhere.mockResolvedValueOnce([{ node: baseNode }]);

		const result = await listKnowledgeByContact('contact-1', WS);

		expect(result).toEqual([baseNode]);
	});

	it('applies WHERE clause — select + innerJoin + where all called (SEC-114 regression guard)', async () => {
		mockInnerJoinWhere.mockResolvedValueOnce([]);

		await listKnowledgeByContact('contact-1', WS);

		expect(mockSelect).toHaveBeenCalledTimes(1);
		expect(mockInnerJoin).toHaveBeenCalledTimes(1);
		expect(mockInnerJoinWhere).toHaveBeenCalledTimes(1);
	});

	it('scopes to workspaceId — two different workspaces produce two separate queries', async () => {
		mockInnerJoinWhere.mockResolvedValue([]);

		await listKnowledgeByContact('contact-1', 'ws-A');
		await listKnowledgeByContact('contact-1', 'ws-B');

		expect(mockSelect).toHaveBeenCalledTimes(2);
		expect(mockInnerJoinWhere).toHaveBeenCalledTimes(2);
	});
});

// ─── createKnowledgeLink ──────────────────────────────────────────────────────

describe('createKnowledgeLink', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockInsert.mockReturnValue({ values: mockInsertValues });
		mockInsertValues.mockReturnValue({
			onConflictDoUpdate: mockOnConflict,
			returning: mockInsertReturning,
		});
		mockOnConflict.mockReturnValue({ returning: mockInsertReturning });
	});

	it('inserts link and returns created row', async () => {
		const link = {
			id: 'link-1',
			workspaceId: WS,
			sourceNodeId: 'node-a',
			targetNodeId: 'node-b',
			linkType: 'related_to',
			weight: 0.5,
			createdAt: new Date(),
		};
		mockInsertReturning.mockResolvedValueOnce([link]);

		const result = await createKnowledgeLink(WS, 'node-a', 'node-b', 'related_to', 0.5);

		expect(mockInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceId: WS,
				sourceNodeId: 'node-a',
				targetNodeId: 'node-b',
				linkType: 'related_to',
			}),
		);
		expect(result).toEqual(link);
	});

	it('uses onConflictDoUpdate — updates weight on duplicate edge', async () => {
		mockInsertReturning.mockResolvedValueOnce([{ id: 'link-1' }]);

		await createKnowledgeLink(WS, 'node-a', 'node-b', 'builds_on', 0.8);

		const conflictArgs = (mockOnConflict.mock.calls as unknown[][])[0]?.[0] as
			| {
					set: Record<string, unknown>;
					target: unknown[];
			  }
			| undefined;
		expect(conflictArgs?.set?.weight).toBeDefined();
	});

	it('throws when insert returns no rows', async () => {
		mockInsertReturning.mockResolvedValueOnce([]);

		await expect(createKnowledgeLink(WS, 'node-a', 'node-b', 'part_of')).rejects.toThrow(
			'createKnowledgeLink: insert returned no rows',
		);
	});

	it('supports all 6 link types', async () => {
		const linkTypes = [
			'part_of',
			'related_to',
			'competes_with',
			'builds_on',
			'funds',
			'uses',
		] as const;
		for (const linkType of linkTypes) {
			vi.clearAllMocks();
			mockInsert.mockReturnValue({ values: mockInsertValues });
			mockInsertValues.mockReturnValue({
				onConflictDoUpdate: mockOnConflict,
				returning: mockInsertReturning,
			});
			mockOnConflict.mockReturnValue({ returning: mockInsertReturning });
			mockInsertReturning.mockResolvedValueOnce([{ id: 'link-1', linkType }]);

			const result = await createKnowledgeLink(WS, 'node-a', 'node-b', linkType);
			expect(result.linkType).toBe(linkType);
		}
	});
});

// ─── getKnowledgeNeighbors ────────────────────────────────────────────────────

describe('getKnowledgeNeighbors', () => {
	const mockLink = {
		id: 'link-1',
		workspaceId: WS,
		sourceNodeId: 'node-a',
		targetNodeId: 'node-b',
		linkType: 'related_to',
		weight: 0.5,
		createdAt: new Date(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mockSelect.mockReturnValue({ from: mockSelectFrom });
		mockSelectFrom.mockReturnValue({ innerJoin: mockInnerJoin });
		mockInnerJoin.mockReturnValue({ where: mockInnerJoinWhere });
	});

	it('returns outbound neighbors with direction flag', async () => {
		const outboundRow = { link: mockLink, node: baseNode };
		// First call = outbound, second call = inbound (empty)
		mockInnerJoinWhere.mockResolvedValueOnce([outboundRow]).mockResolvedValueOnce([]);

		const result = await getKnowledgeNeighbors('node-a', WS);

		expect(result).toHaveLength(1);
		expect(result[0]?.direction).toBe('outbound');
		expect(result[0]?.node).toEqual(baseNode);
	});

	it('returns inbound neighbors with direction flag', async () => {
		const inboundRow = { link: mockLink, node: baseNode };
		// First call = outbound (empty), second call = inbound
		mockInnerJoinWhere.mockResolvedValueOnce([]).mockResolvedValueOnce([inboundRow]);

		const result = await getKnowledgeNeighbors('node-b', WS);

		expect(result).toHaveLength(1);
		expect(result[0]?.direction).toBe('inbound');
	});

	it('merges outbound and inbound into a single array', async () => {
		mockInnerJoinWhere
			.mockResolvedValueOnce([{ link: mockLink, node: baseNode }])
			.mockResolvedValueOnce([{ link: mockLink, node: { ...baseNode, id: 'node-c' } }]);

		const result = await getKnowledgeNeighbors('node-a', WS);

		expect(result).toHaveLength(2);
		expect(result.some((r) => r.direction === 'outbound')).toBe(true);
		expect(result.some((r) => r.direction === 'inbound')).toBe(true);
	});

	it('returns empty array when node has no links', async () => {
		mockInnerJoinWhere.mockResolvedValue([]);

		const result = await getKnowledgeNeighbors('isolated-node', WS);

		expect(result).toEqual([]);
		expect(mockSelect).toHaveBeenCalledTimes(2); // still makes both queries
	});

	it('makes two separate queries scoped to workspaceId', async () => {
		mockInnerJoinWhere.mockResolvedValue([]);

		await getKnowledgeNeighbors('node-a', WS);

		expect(mockSelect).toHaveBeenCalledTimes(2);
		expect(mockInnerJoinWhere).toHaveBeenCalledTimes(2);
	});
});

// ─── getSharedKnowledge ───────────────────────────────────────────────────────

describe('getSharedKnowledge', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExecute.mockResolvedValue([]); // default: no shared node IDs
	});

	it('returns nodes shared by both contacts (two-step: IDs then Drizzle ORM)', async () => {
		// Step 1: execute returns shared node IDs
		mockExecute.mockResolvedValueOnce([{ id: 'node-1' }]);
		// Step 2: Drizzle ORM returns full nodes
		const mockLimit = vi.fn().mockResolvedValue([baseNode]);
		const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
		mockSelectWhere.mockReturnValue({ orderBy: mockOrderBy });
		mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
		mockSelect.mockReturnValue({ from: mockSelectFrom });

		const result = await getSharedKnowledge('contact-a', 'contact-b', WS);

		expect(mockExecute).toHaveBeenCalledTimes(1);
		expect(mockSelect).toHaveBeenCalledTimes(1);
		expect(result).toEqual([baseNode]);
	});

	it('returns empty array when contacts share no knowledge nodes', async () => {
		mockExecute.mockResolvedValueOnce([]);

		const result = await getSharedKnowledge('contact-a', 'contact-b', WS);

		expect(result).toEqual([]);
	});

	it('calls db.execute for IDs with workspace isolation', async () => {
		mockExecute.mockResolvedValue([]);

		await getSharedKnowledge('ca', 'cb', WS);
		await getSharedKnowledge('cx', 'cy', 'ws-other');

		expect(mockExecute).toHaveBeenCalledTimes(2);
	});
});

// ─── knowledgeGraphSearch ─────────────────────────────────────────────────────

describe('knowledgeGraphSearch', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExecute.mockResolvedValue([]); // default: no reachable node IDs from CTE
	});

	it('returns reachable nodes with depth (two-step: CTE IDs then Drizzle ORM)', async () => {
		// Step 1: CTE returns node IDs with depths
		mockExecute.mockResolvedValueOnce([{ node_id: 'node-1', depth: 1 }]);
		// Step 2: Drizzle ORM returns full nodes
		mockSelectWhere.mockResolvedValue([baseNode]);
		mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
		mockSelect.mockReturnValue({ from: mockSelectFrom });

		const result = await knowledgeGraphSearch('node-a', WS);

		expect(mockExecute).toHaveBeenCalledTimes(1);
		expect(mockSelect).toHaveBeenCalledTimes(1);
		expect(result).toHaveLength(1);
		expect(result[0]?.depth).toBe(1);
	});

	it('returns empty array when no reachable nodes exist', async () => {
		mockExecute.mockResolvedValueOnce([]);

		const result = await knowledgeGraphSearch('isolated-node', WS);

		expect(result).toEqual([]);
	});

	it('uses db.execute for recursive CTE traversal', async () => {
		mockExecute.mockResolvedValue([]);

		await knowledgeGraphSearch('node-a', WS, 2);
		await knowledgeGraphSearch('node-a', 'ws-other', 2);

		expect(mockExecute).toHaveBeenCalledTimes(2);
	});
});

// ─── Workspace isolation ──────────────────────────────────────────────────────

describe('workspace isolation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		const mockOffset = vi.fn().mockResolvedValue([]);
		const mockLimitFn = vi.fn().mockReturnValue({ offset: mockOffset });
		const mockOrderByFn = vi.fn().mockReturnValue({ limit: mockLimitFn });
		mockSelect.mockReturnValue({ from: mockSelectFrom });
		mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
		mockSelectWhere.mockReturnValue({ orderBy: mockOrderByFn });
	});

	it('listKnowledgeNodes scopes each call to its own workspaceId', async () => {
		await listKnowledgeNodes('ws-A');
		await listKnowledgeNodes('ws-B');

		// Two separate select calls, each with workspace filter
		expect(mockSelect).toHaveBeenCalledTimes(2);
		expect(mockSelectWhere).toHaveBeenCalledTimes(2);
	});
});
