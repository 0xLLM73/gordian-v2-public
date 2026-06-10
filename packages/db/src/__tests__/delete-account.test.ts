import { beforeEach, describe, expect, it, vi } from 'vitest';
import { accounts, sessions, verifications } from '../schema/auth';
import { contactHealthFeedback } from '../schema/contact-health-feedback';
import { contacts } from '../schema/contacts';
import { dealAiRuns } from '../schema/deal-ai-runs';
import { dealCandidates } from '../schema/deal-candidates';
import { dealDecisions } from '../schema/deal-decisions';
import { dealEvidenceLinks } from '../schema/deal-evidence-links';
import { dealStageEvents } from '../schema/deal-stage-events';
import { deals } from '../schema/deals';
import {
	followUpPlanActivityEvents,
	followUpPlanDraftRevisions,
	followUpPlanSendRecords,
	followUpPlanSteps,
	followUpPlanUserTemplateVersions,
	followUpPlans,
} from '../schema/follow-up-plans';
import { goalActions } from '../schema/goal-actions';
import { goalProgressEvents, goals } from '../schema/goals';
import { banditLedger, goldenDataset } from '../schema/golden-dataset';
import { knowledgeContacts, knowledgeEvidence, knowledgeNodes } from '../schema/knowledge';
import {
	telegramChatImportState,
	telegramImportRunChats,
	telegramImportRuns,
} from '../schema/telegram-imports';
import { users } from '../schema/users';
import { workspaceMembers, workspaces } from '../schema/workspaces';

const mockDeleteWhere = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
const mockInsertValues = vi.hoisted(() => vi.fn());
const mockInsert = vi.hoisted(() => vi.fn());
const mockSelectLimit = vi.hoisted(() => vi.fn());
const mockSelectWhere = vi.hoisted(() => vi.fn());
const mockSelectFrom = vi.hoisted(() => vi.fn());
const mockSelect = vi.hoisted(() => vi.fn());
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
		mockSelectLimit.mockResolvedValue([]);
		mockSelectWhere.mockReturnValue({ limit: mockSelectLimit });
		mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
		mockSelect.mockReturnValue({ from: mockSelectFrom });
		mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
			fn({ delete: mockDelete, insert: mockInsert, select: mockSelect }),
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
				verifications,
				telegramImportRunChats,
				telegramChatImportState,
				telegramImportRuns,
				followUpPlanDraftRevisions,
				followUpPlanSendRecords,
				followUpPlanActivityEvents,
				followUpPlanSteps,
				followUpPlanUserTemplateVersions,
				followUpPlans,
				contactHealthFeedback,
				dealCandidates,
				dealAiRuns,
				dealEvidenceLinks,
				dealDecisions,
				dealStageEvents,
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
		expect(indexOf(followUpPlanDraftRevisions)).toBeLessThan(indexOf(followUpPlanSteps));
		expect(indexOf(followUpPlanSendRecords)).toBeLessThan(indexOf(followUpPlanSteps));
		expect(indexOf(followUpPlanActivityEvents)).toBeLessThan(indexOf(followUpPlanSteps));
		expect(indexOf(followUpPlanSteps)).toBeLessThan(indexOf(followUpPlans));
		expect(indexOf(followUpPlanUserTemplateVersions)).toBeLessThan(indexOf(workspaces));
		expect(indexOf(telegramImportRunChats)).toBeLessThan(indexOf(telegramImportRuns));
		expect(indexOf(telegramChatImportState)).toBeLessThan(indexOf(telegramImportRuns));
		expect(indexOf(telegramImportRuns)).toBeLessThan(indexOf(users));
		expect(indexOf(dealAiRuns)).toBeLessThan(indexOf(deals));
		expect(indexOf(dealEvidenceLinks)).toBeLessThan(indexOf(dealDecisions));
		expect(indexOf(dealDecisions)).toBeLessThan(indexOf(deals));
		expect(indexOf(dealStageEvents)).toBeLessThan(indexOf(deals));
		expect(indexOf(contactHealthFeedback)).toBeLessThan(indexOf(contacts));
		expect(indexOf(knowledgeEvidence)).toBeLessThan(indexOf(knowledgeNodes));
		expect(indexOf(workspaceMembers)).toBeLessThan(indexOf(workspaces));
		expect(indexOf(workspaces)).toBeLessThan(indexOf(users));
	});

	it('deletes scoped verification tokens for account-only deletion', async () => {
		const { deleteUserAccountOnly } = await import('../dal/delete-account');

		await deleteUserAccountOnly('550e8400-e29b-41d4-a716-446655440001');

		const deletedTables = mockDelete.mock.calls.map(([table]) => table);
		expect(deletedTables).toEqual(expect.arrayContaining([workspaceMembers, verifications, users]));
		expect(deletedTables.indexOf(verifications)).toBeLessThan(deletedTables.indexOf(users));
	});
});
