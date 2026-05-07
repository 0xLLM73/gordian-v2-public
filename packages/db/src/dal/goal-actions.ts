import { withKeys } from '@repo/crypto';
import type { SealedEnvelope } from '@repo/crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { goalActions } from '../schema/goal-actions';

export type GoalAction = typeof goalActions.$inferSelect;

export interface CreateGoalActionInput {
	goalId: string;
	title: string;
	description?: string;
	contactId?: string;
	actionType:
		| 'contact_outreach'
		| 'information_gathering'
		| 'document_creation'
		| 'meeting_scheduling'
		| 'decision_making';
	domainTag: 'financial' | 'networking' | 'legal' | 'technical' | 'operational' | 'other';
	effort?: 'quick' | 'medium' | 'deep';
}

export async function createGoalAction(
	workspaceId: string,
	input: CreateGoalActionInput,
	envelope: SealedEnvelope,
): Promise<GoalAction> {
	return withKeys(envelope, async () => {
		const result = await db
			.insert(goalActions)
			.values({
				workspaceId,
				goalId: input.goalId,
				title: input.title,
				description: input.description,
				contactId: input.contactId,
				actionType: input.actionType,
				domainTag: input.domainTag,
				effort: input.effort,
			})
			.returning();
		const row = result[0];
		if (!row) throw new Error('createGoalAction: insert returned no rows');
		return row;
	});
}

export async function listGoalActions(
	workspaceId: string,
	goalId: string,
	envelope: SealedEnvelope,
): Promise<GoalAction[]> {
	return withKeys(envelope, async () =>
		db
			.select()
			.from(goalActions)
			.where(and(eq(goalActions.workspaceId, workspaceId), eq(goalActions.goalId, goalId)))
			.orderBy(asc(goalActions.createdAt)),
	);
}

export async function updateGoalAction(
	workspaceId: string,
	actionId: string,
	input: Partial<
		Pick<
			CreateGoalActionInput,
			'title' | 'description' | 'contactId' | 'actionType' | 'domainTag' | 'effort'
		>
	> & { status?: 'pending' | 'in_progress' | 'completed' | 'skipped' },
	envelope: SealedEnvelope,
): Promise<GoalAction | null> {
	return withKeys(envelope, async () => {
		const set: Record<string, unknown> = {};
		if (input.title !== undefined) set.title = input.title;
		if (input.description !== undefined) set.description = input.description;
		if (input.contactId !== undefined) set.contactId = input.contactId;
		if (input.actionType !== undefined) set.actionType = input.actionType;
		if (input.domainTag !== undefined) set.domainTag = input.domainTag;
		if (input.effort !== undefined) set.effort = input.effort;
		if (input.status !== undefined) set.status = input.status;

		if (Object.keys(set).length === 0) return null;

		const result = await db
			.update(goalActions)
			.set(set)
			.where(and(eq(goalActions.id, actionId), eq(goalActions.workspaceId, workspaceId)))
			.returning();
		return result[0] ?? null;
	});
}

export async function completeGoalAction(
	workspaceId: string,
	actionId: string,
): Promise<{ id: string; status: string; completedAt: Date | null } | null> {
	const result = await db
		.update(goalActions)
		.set({ status: 'completed', completedAt: sql`now()` })
		.where(and(eq(goalActions.id, actionId), eq(goalActions.workspaceId, workspaceId)))
		.returning({
			id: goalActions.id,
			status: goalActions.status,
			completedAt: goalActions.completedAt,
		});
	return result[0] ?? null;
}

export async function deleteGoalAction(
	workspaceId: string,
	actionId: string,
): Promise<{ id: string } | null> {
	const result = await db
		.delete(goalActions)
		.where(and(eq(goalActions.id, actionId), eq(goalActions.workspaceId, workspaceId)))
		.returning({ id: goalActions.id });
	return result[0] ?? null;
}
