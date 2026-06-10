import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '../client';
import { contactHealthScores } from '../schema/health-scores';

export interface UpsertHealthScoreInput {
	contactId: string;
	recency: number;
	frequency: number;
	fulfillment: number;
	responsiveness: number;
	reciprocity: number;
	depth: number;
	composite: number;
	label: string;
	trend: string;
	previousComposite?: number | null;
	computationData?: Record<string, unknown>;
}

export async function upsertHealthScore(workspaceId: string, input: UpsertHealthScoreInput) {
	const result = await db
		.insert(contactHealthScores)
		.values({
			workspaceId,
			contactId: input.contactId,
			recency: input.recency,
			frequency: input.frequency,
			fulfillment: input.fulfillment,
			responsiveness: input.responsiveness,
			reciprocity: input.reciprocity,
			depth: input.depth,
			composite: input.composite,
			label: input.label,
			trend: input.trend,
			previousComposite: input.previousComposite ?? null,
			computationData: input.computationData ?? {},
			computedAt: new Date(),
		})
		.onConflictDoUpdate({
			target: [contactHealthScores.workspaceId, contactHealthScores.contactId],
			set: {
				recency: input.recency,
				frequency: input.frequency,
				fulfillment: input.fulfillment,
				responsiveness: input.responsiveness,
				reciprocity: input.reciprocity,
				depth: input.depth,
				composite: input.composite,
				label: input.label,
				trend: input.trend,
				previousComposite: input.previousComposite ?? null,
				computationData: input.computationData ?? {},
				computedAt: new Date(),
				updatedAt: sql`now()`,
			},
		})
		.returning();
	return result[0] ?? null;
}

export async function getHealthScore(workspaceId: string, contactId: string) {
	const result = await db
		.select()
		.from(contactHealthScores)
		.where(
			and(
				eq(contactHealthScores.workspaceId, workspaceId),
				eq(contactHealthScores.contactId, contactId),
			),
		)
		.limit(1);
	return result[0] ?? null;
}

export interface GetHealthScoresOptions {
	minComposite?: number;
	label?: string;
	labels?: string[];
	limit?: number;
	sort?: 'composite_asc' | 'composite_desc';
}

export async function getHealthScoresByWorkspace(
	workspaceId: string,
	options?: GetHealthScoresOptions,
) {
	const limit = options?.limit ?? 100;
	const conditions = [eq(contactHealthScores.workspaceId, workspaceId)];

	if (options?.minComposite !== undefined) {
		conditions.push(gte(contactHealthScores.composite, options.minComposite));
	}
	if (options?.label) {
		conditions.push(eq(contactHealthScores.label, options.label));
	} else if (options?.labels?.length) {
		conditions.push(inArray(contactHealthScores.label, options.labels));
	}

	return db
		.select()
		.from(contactHealthScores)
		.where(and(...conditions))
		.orderBy(
			options?.sort === 'composite_asc'
				? asc(contactHealthScores.composite)
				: desc(contactHealthScores.composite),
		)
		.limit(limit);
}

export async function getHealthScoresByContactIds(workspaceId: string, contactIds: string[]) {
	if (contactIds.length === 0) return [];

	return db
		.select()
		.from(contactHealthScores)
		.where(
			and(
				eq(contactHealthScores.workspaceId, workspaceId),
				inArray(contactHealthScores.contactId, contactIds),
			),
		)
		.orderBy(asc(contactHealthScores.composite));
}

export interface GetDecliningContactsOptions {
	limit?: number;
}

export async function getDecliningContacts(
	workspaceId: string,
	options?: GetDecliningContactsOptions,
) {
	const limit = options?.limit ?? 50;
	return db
		.select()
		.from(contactHealthScores)
		.where(
			and(
				eq(contactHealthScores.workspaceId, workspaceId),
				eq(contactHealthScores.trend, 'declining'),
			),
		)
		.orderBy(asc(contactHealthScores.composite))
		.limit(limit);
}
