import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockInsert = vi.hoisted(() => vi.fn());
const mockSelect = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
const mockWithKeys = vi.hoisted(() => vi.fn());

const mockValues = vi.hoisted(() => vi.fn());
const mockReturning = vi.hoisted(() => vi.fn());
const mockWhere = vi.hoisted(() => vi.fn());
const mockOrderBy = vi.hoisted(() => vi.fn());
const mockSet = vi.hoisted(() => vi.fn());
const mockFrom = vi.hoisted(() => vi.fn());

vi.mock('../client', () => ({
	db: {
		insert: mockInsert,
		select: mockSelect,
		update: mockUpdate,
		delete: mockDelete,
	},
}));

vi.mock('@repo/crypto', () => ({
	withKeys: mockWithKeys,
}));

vi.mock('../schema/goal-actions', () => ({
	goalActions: {
		id: 'id',
		goalId: 'goal_id',
		workspaceId: 'workspace_id',
		title: 'title',
		description: 'description',
		contactId: 'contact_id',
		status: 'status',
		actionType: 'action_type',
		domainTag: 'domain_tag',
		effort: 'effort',
		createdAt: 'created_at',
		completedAt: 'completed_at',
	},
}));

import {
	completeGoalAction,
	createGoalAction,
	deleteGoalAction,
	listGoalActions,
	updateGoalAction,
} from '../dal/goal-actions';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WS = 'ws-00000000-0000-0000-0000-000000000001';
const GOAL_ID = 'goal-00000000-0000-0000-0000-000000000001';
const ACTION_ID = 'action-00000000-0000-0000-0000-000000000001';
const fakeEnvelope = { encryptedWrk: Buffer.from('fake'), kmsContext: {}, wrkVersion: 1 };

const fakeAction = {
	id: ACTION_ID,
	goalId: GOAL_ID,
	workspaceId: WS,
	title: 'Reach out to LP contacts',
	description: 'Email top 5 LP contacts about Series A',
	contactId: null,
	status: 'pending',
	actionType: 'contact_outreach',
	domainTag: 'networking',
	effort: 'medium',
	createdAt: new Date(),
	completedAt: null,
};

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();

	// withKeys executes the callback
	mockWithKeys.mockImplementation((_env: unknown, fn: () => unknown) => fn());

	// Default chain: insert().values().returning()
	mockReturning.mockResolvedValue([fakeAction]);
	mockValues.mockReturnValue({ returning: mockReturning });
	mockInsert.mockReturnValue({ values: mockValues });

	// Default chain: select().from().where().orderBy()
	mockOrderBy.mockResolvedValue([fakeAction]);
	mockWhere.mockReturnValue({ orderBy: mockOrderBy });
	mockFrom.mockReturnValue({ where: mockWhere });
	mockSelect.mockReturnValue({ from: mockFrom });

	// Default chain: update().set().where().returning()
	mockSet.mockReturnValue({ where: vi.fn().mockReturnValue({ returning: mockReturning }) });
	mockUpdate.mockReturnValue({ set: mockSet });

	// Default chain: delete().where().returning()
	mockDelete.mockReturnValue({
		where: vi.fn().mockReturnValue({ returning: mockReturning }),
	});
});

// ─── createGoalAction ─────────────────────────────────────────────────────────

describe('createGoalAction', () => {
	it('inserts with workspace_id and returns the row', async () => {
		const result = await createGoalAction(
			WS,
			{
				goalId: GOAL_ID,
				title: 'Reach out to LP contacts',
				description: 'Email top 5 LP contacts about Series A',
				actionType: 'contact_outreach',
				domainTag: 'networking',
			},
			fakeEnvelope,
		);

		expect(result).toEqual(fakeAction);
		expect(mockWithKeys).toHaveBeenCalledWith(fakeEnvelope, expect.any(Function));
		expect(mockInsert).toHaveBeenCalled();
	});

	it('throws when insert returns no rows', async () => {
		mockReturning.mockResolvedValue([]);

		await expect(
			createGoalAction(
				WS,
				{
					goalId: GOAL_ID,
					title: 'Test',
					actionType: 'decision_making',
					domainTag: 'other',
				},
				fakeEnvelope,
			),
		).rejects.toThrow('insert returned no rows');
	});

	it('passes optional fields when provided', async () => {
		await createGoalAction(
			WS,
			{
				goalId: GOAL_ID,
				title: 'Schedule meeting',
				contactId: 'c-1',
				actionType: 'meeting_scheduling',
				domainTag: 'financial',
				effort: 'quick',
			},
			fakeEnvelope,
		);

		expect(mockInsert).toHaveBeenCalled();
		const valuesArg = (mockValues.mock.calls as any[])[0][0] as Record<string, unknown>;
		expect(valuesArg.contactId).toBe('c-1');
		expect(valuesArg.effort).toBe('quick');
	});
});

// ─── listGoalActions ──────────────────────────────────────────────────────────

describe('listGoalActions', () => {
	it('returns actions for a goal ordered by createdAt', async () => {
		const result = await listGoalActions(WS, GOAL_ID, fakeEnvelope);

		expect(result).toEqual([fakeAction]);
		expect(mockWithKeys).toHaveBeenCalledWith(fakeEnvelope, expect.any(Function));
		expect(mockSelect).toHaveBeenCalled();
	});

	it('returns empty array when no actions exist', async () => {
		mockOrderBy.mockResolvedValue([]);

		const result = await listGoalActions(WS, GOAL_ID, fakeEnvelope);
		expect(result).toEqual([]);
	});
});

// ─── updateGoalAction ─────────────────────────────────────────────────────────

describe('updateGoalAction', () => {
	it('updates title and returns the row', async () => {
		const result = await updateGoalAction(WS, ACTION_ID, { title: 'Updated title' }, fakeEnvelope);

		expect(result).toEqual(fakeAction);
		expect(mockWithKeys).toHaveBeenCalledWith(fakeEnvelope, expect.any(Function));
		expect(mockUpdate).toHaveBeenCalled();
	});

	it('returns null when no fields provided', async () => {
		const result = await updateGoalAction(WS, ACTION_ID, {}, fakeEnvelope);
		expect(result).toBeNull();
	});

	it('returns null when action not found', async () => {
		mockSet.mockReturnValue({
			where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
		});

		const result = await updateGoalAction(
			WS,
			'nonexistent',
			{ status: 'in_progress' },
			fakeEnvelope,
		);
		expect(result).toBeNull();
	});
});

// ─── completeGoalAction ───────────────────────────────────────────────────────

describe('completeGoalAction', () => {
	it('sets status to completed with timestamp', async () => {
		mockReturning.mockResolvedValue([
			{ id: ACTION_ID, status: 'completed', completedAt: new Date() },
		]);

		const result = await completeGoalAction(WS, ACTION_ID);

		expect(result).toBeTruthy();
		expect(result?.status).toBe('completed');
		expect(mockUpdate).toHaveBeenCalled();
	});

	it('returns null when action not found', async () => {
		mockSet.mockReturnValue({
			where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
		});

		const result = await completeGoalAction(WS, 'nonexistent');
		expect(result).toBeNull();
	});
});

// ─── deleteGoalAction ─────────────────────────────────────────────────────────

describe('deleteGoalAction', () => {
	it('deletes and returns the id', async () => {
		mockDelete.mockReturnValue({
			where: vi.fn().mockReturnValue({
				returning: vi.fn().mockResolvedValue([{ id: ACTION_ID }]),
			}),
		});

		const result = await deleteGoalAction(WS, ACTION_ID);
		expect(result).toEqual({ id: ACTION_ID });
		expect(mockDelete).toHaveBeenCalled();
	});

	it('returns null when action not found', async () => {
		mockDelete.mockReturnValue({
			where: vi.fn().mockReturnValue({
				returning: vi.fn().mockResolvedValue([]),
			}),
		});

		const result = await deleteGoalAction(WS, 'nonexistent');
		expect(result).toBeNull();
	});
});
