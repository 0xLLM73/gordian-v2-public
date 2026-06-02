import { beforeEach, describe, expect, it, vi } from 'vitest';
import { accounts, sessions } from '../schema/auth';
import { dealCandidates } from '../schema/deal-candidates';
import { goalActions } from '../schema/goal-actions';
import { goalProgressEvents, goals } from '../schema/goals';
import { banditLedger, goldenDataset } from '../schema/golden-dataset';
import { knowledgeContacts, knowledgeEvidence, knowledgeNodes } from '../schema/knowledge';
import { users } from '../schema/users';
import { workspaceMembers, workspaces } from '../schema/workspaces';

const mockDeleteWhere = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
const mockInsertValues = vi.hoisted(() => vi.fn());
const mockInsert = vi.hoisted(() => vi.fn());
const mockTransaction = vi.hoisted(() => vi.fn());

vi.mock('../client', () => ({
	db: {
		transaction: mockTransaction,
	},
}));

describe('deleteAccountData', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDeleteWhere.mockResolvedValue(undefined);
		mockDelete.mockReturnValue({ where: mockDeleteWhere });
		mockInsertValues.mockResolvedValue(undefined);
		mockInsert.mockReturnValue({ values: mockInsertValues });
		mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
			fn({ delete: mockDelete, insert: mockInsert }),
		);
	});

	it('deletes current-schema auth, generated, learning, graph, workspace, and user data', async () => {
		const { deleteAccountData } = await import('../dal/delete-account');

		await deleteAccountData('550e8400-e29b-41d4-a716-446655440000', 'user-1');

		const deletedTables = mockDelete.mock.calls.map(([table]) => table);
		expect(deletedTables).toEqual(
			expect.arrayContaining([
				sessions,
				accounts,
				dealCandidates,
				goalActions,
				goalProgressEvents,
				knowledgeEvidence,
				knowledgeContacts,
				knowledgeNodes,
				banditLedger,
				goldenDataset,
				workspaceMembers,
				workspaces,
				users,
			]),
		);
	});

	it('keeps child/dependent deletes before their parent tables', async () => {
		const { deleteAccountData } = await import('../dal/delete-account');

		await deleteAccountData('550e8400-e29b-41d4-a716-446655440000', 'user-1');

		const deletedTables = mockDelete.mock.calls.map(([table]) => table);
		const indexOf = (table: unknown) => deletedTables.indexOf(table);

		expect(indexOf(goalActions)).toBeGreaterThanOrEqual(0);
		expect(indexOf(goalActions)).toBeLessThan(indexOf(goals));
		expect(indexOf(goalProgressEvents)).toBeLessThan(indexOf(goals));
		expect(indexOf(knowledgeEvidence)).toBeLessThan(indexOf(knowledgeNodes));
		expect(indexOf(workspaceMembers)).toBeLessThan(indexOf(workspaces));
		expect(indexOf(workspaces)).toBeLessThan(indexOf(users));
	});
});
