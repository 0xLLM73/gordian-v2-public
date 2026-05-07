import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { investorProfiles } from '../schema/investor-profiles';

export type InvestorProfile = typeof investorProfiles.$inferSelect;

export interface UpsertInvestorProfileData {
	dealCount?: number;
	winRate?: number;
	avgCycleDays?: number;
	preferredRole?: string | null;
	sectorFocus?: string[] | null;
	ticketMin?: number | null;
	ticketMax?: number | null;
	tokenInterests?: string[] | null;
	activityTrend?: 'heating_up' | 'steady' | 'cooling_down';
}

export interface ListInvestorProfilesOptions {
	limit?: number;
	offset?: number;
}

/**
 * Create or update the investor profile for a contact in a workspace.
 * computedAt is refreshed on every upsert.
 */
export async function upsertInvestorProfile(
	workspaceId: string,
	contactId: string,
	data: UpsertInvestorProfileData,
): Promise<InvestorProfile> {
	const values: typeof investorProfiles.$inferInsert = {
		workspaceId,
		contactId,
		dealCount: data.dealCount ?? 0,
		winRate: data.winRate ?? 0,
		avgCycleDays: data.avgCycleDays ?? 0,
		preferredRole: data.preferredRole,
		sectorFocus: data.sectorFocus,
		ticketMin: data.ticketMin,
		ticketMax: data.ticketMax,
		tokenInterests: data.tokenInterests,
		activityTrend: data.activityTrend ?? 'steady',
		computedAt: new Date(),
	};

	const result = await db
		.insert(investorProfiles)
		.values(values)
		.onConflictDoUpdate({
			target: [investorProfiles.workspaceId, investorProfiles.contactId],
			set: {
				dealCount: sql`excluded.deal_count`,
				winRate: sql`excluded.win_rate`,
				avgCycleDays: sql`excluded.avg_cycle_days`,
				preferredRole: sql`excluded.preferred_role`,
				sectorFocus: sql`excluded.sector_focus`,
				ticketMin: sql`excluded.ticket_min`,
				ticketMax: sql`excluded.ticket_max`,
				tokenInterests: sql`excluded.token_interests`,
				activityTrend: sql`excluded.activity_trend`,
				computedAt: sql`now()`,
			},
		})
		.returning();
	const row = result[0];
	if (!row) throw new Error('upsertInvestorProfile: upsert returned no rows');
	return row;
}

/**
 * Get the investor profile for a specific contact.
 * workspace_id required to prevent cross-tenant reads.
 */
export async function getInvestorProfile(
	workspaceId: string,
	contactId: string,
): Promise<InvestorProfile | null> {
	const result = await db
		.select()
		.from(investorProfiles)
		.where(
			and(eq(investorProfiles.workspaceId, workspaceId), eq(investorProfiles.contactId, contactId)),
		)
		.limit(1);
	return result[0] ?? null;
}

/**
 * List all investor profiles for a workspace, newest computation first.
 */
export async function listInvestorProfiles(
	workspaceId: string,
	opts?: ListInvestorProfilesOptions,
): Promise<InvestorProfile[]> {
	return db
		.select()
		.from(investorProfiles)
		.where(eq(investorProfiles.workspaceId, workspaceId))
		.orderBy(desc(investorProfiles.computedAt))
		.limit(opts?.limit ?? 50)
		.offset(opts?.offset ?? 0);
}

/**
 * Return top investors in a workspace ranked by win rate then deal count.
 */
export async function getTopInvestors(workspaceId: string, limit = 10): Promise<InvestorProfile[]> {
	return db
		.select()
		.from(investorProfiles)
		.where(eq(investorProfiles.workspaceId, workspaceId))
		.orderBy(desc(investorProfiles.winRate), desc(investorProfiles.dealCount))
		.limit(limit);
}
