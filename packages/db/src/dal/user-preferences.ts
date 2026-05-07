import { and, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { userPreferences } from '../schema/user-preferences';

type BriefDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/** Default preferences returned when no row exists */
const DEFAULTS: UserPreferencesData = {
	timezone: 'UTC',
	briefEnabled: true,
	briefTime: 7,
	briefDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
	digestFocus: 'balanced',
	introKeywords: [],
	ghostingAlertStatuses: ['cooling', 'dormant'],
	ghostingStaleDays: 30,
};

export interface UserPreferencesData {
	timezone: string;
	briefEnabled: boolean;
	briefTime: number;
	briefDays: BriefDay[];
	digestFocus: 'balanced' | 'commitments' | 'relationships' | 'deals' | 'network';
	introKeywords: string[];
	ghostingAlertStatuses: ('cooling' | 'dormant')[];
	ghostingStaleDays: number;
}

export async function getPreferences(
	workspaceId: string,
	userId: string,
): Promise<UserPreferencesData> {
	const result = await db
		.select()
		.from(userPreferences)
		.where(and(eq(userPreferences.workspaceId, workspaceId), eq(userPreferences.userId, userId)))
		.limit(1);

	if (!result[0]) return { ...DEFAULTS };

	const row = result[0];
	return {
		timezone: row.timezone,
		briefEnabled: row.briefEnabled,
		briefTime: row.briefTime,
		briefDays: row.briefDays as BriefDay[],
		digestFocus: row.digestFocus,
		introKeywords: row.introKeywords ?? [],
		ghostingAlertStatuses: (row.ghostingAlertStatuses ?? ['cooling', 'dormant']) as (
			| 'cooling'
			| 'dormant'
		)[],
		ghostingStaleDays: row.ghostingStaleDays ?? 30,
	};
}

export interface UpsertPreferencesInput {
	timezone?: string;
	briefEnabled?: boolean;
	briefTime?: number;
	briefDays?: BriefDay[];
	digestFocus?: 'balanced' | 'commitments' | 'relationships' | 'deals' | 'network';
	introKeywords?: string[];
	ghostingAlertStatuses?: ('cooling' | 'dormant')[];
	ghostingStaleDays?: number;
}

export async function upsertPreferences(
	workspaceId: string,
	userId: string,
	input: UpsertPreferencesInput,
): Promise<UserPreferencesData> {
	const result = await db
		.insert(userPreferences)
		.values({
			workspaceId,
			userId,
			timezone: input.timezone ?? DEFAULTS.timezone,
			briefEnabled: input.briefEnabled ?? DEFAULTS.briefEnabled,
			briefTime: input.briefTime ?? DEFAULTS.briefTime,
			briefDays: input.briefDays ?? DEFAULTS.briefDays,
			digestFocus: input.digestFocus ?? DEFAULTS.digestFocus,
			introKeywords: input.introKeywords ?? DEFAULTS.introKeywords,
			ghostingAlertStatuses: input.ghostingAlertStatuses ?? DEFAULTS.ghostingAlertStatuses,
			ghostingStaleDays: input.ghostingStaleDays ?? DEFAULTS.ghostingStaleDays,
		})
		.onConflictDoUpdate({
			target: [userPreferences.userId, userPreferences.workspaceId],
			set: {
				...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
				...(input.briefEnabled !== undefined ? { briefEnabled: input.briefEnabled } : {}),
				...(input.briefTime !== undefined ? { briefTime: input.briefTime } : {}),
				...(input.briefDays !== undefined ? { briefDays: input.briefDays } : {}),
				...(input.digestFocus !== undefined ? { digestFocus: input.digestFocus } : {}),
				...(input.introKeywords !== undefined ? { introKeywords: input.introKeywords } : {}),
				...(input.ghostingAlertStatuses !== undefined
					? { ghostingAlertStatuses: input.ghostingAlertStatuses }
					: {}),
				...(input.ghostingStaleDays !== undefined
					? { ghostingStaleDays: input.ghostingStaleDays }
					: {}),
				updatedAt: sql`now()`,
			},
		})
		.returning();

	const row = result[0];
	if (!row) return { ...DEFAULTS };
	return {
		timezone: row.timezone,
		briefEnabled: row.briefEnabled,
		briefTime: row.briefTime,
		briefDays: row.briefDays as BriefDay[],
		digestFocus: row.digestFocus,
		introKeywords: row.introKeywords ?? [],
		ghostingAlertStatuses: (row.ghostingAlertStatuses ?? ['cooling', 'dormant']) as (
			| 'cooling'
			| 'dormant'
		)[],
		ghostingStaleDays: row.ghostingStaleDays ?? 30,
	};
}

/** Aggregate custom intro keywords from all users in a workspace (deduplicated, lowercased). */
export async function getWorkspaceIntroKeywords(workspaceId: string): Promise<string[]> {
	const rows = await db
		.select({ introKeywords: userPreferences.introKeywords })
		.from(userPreferences)
		.where(eq(userPreferences.workspaceId, workspaceId));

	const merged = new Set<string>();
	for (const row of rows) {
		if (row.introKeywords) {
			for (const kw of row.introKeywords) {
				const trimmed = kw.trim().toLowerCase();
				if (trimmed) merged.add(trimmed);
			}
		}
	}
	return [...merged];
}
