import { and, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { voiceProfiles } from '../schema/voice-profiles';
import { workspaceMembers } from '../schema/workspaces';

export interface UpsertVoiceProfileInput {
	avgMessageLength: number;
	medianMessageLength: number;
	avgWordCount: number;
	avgSentenceCount: number;
	exclamationRate: number;
	questionRate: number;
	ellipsisRate: number;
	allCapsRate: number;
	emojiRate: number;
	emojiTopN: Array<{ emoji: string; count: number }>;
	contractionRate: number;
	slangRate: number;
	greetingRate: number;
	signoffRate: number;
	questionAskRate: number;
	initiationRate: number;
	avgUniqueWordRatio: number;
	fillerWordRate: number;
	sampleSize: number;
	// Rich AI analysis fields (optional — only set when voice_profile_ai flag is on)
	richSummary?: string | null;
	richTone?: string | null;
	richStructure?: string | null;
	codeSwitchingSummary?: string | null;
	configRecommendations?: unknown | null;
}

export async function upsertVoiceProfile(
	userId: string,
	workspaceId: string,
	input: UpsertVoiceProfileInput,
) {
	// [SEC-FIX CRIT-1] Verify user is a member of this workspace
	const membership = await db
		.select({ id: workspaceMembers.id })
		.from(workspaceMembers)
		.where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId)))
		.limit(1);
	if (membership.length === 0) {
		console.error(
			`[voice-profiles] userId=${userId.slice(0, 8)} is not a member of workspace=${workspaceId.slice(0, 8)}`,
		);
		return null;
	}

	const result = await db
		.insert(voiceProfiles)
		.values({
			userId,
			workspaceId,
			...input,
			lastAnalyzedAt: new Date(),
		})
		.onConflictDoUpdate({
			target: [voiceProfiles.userId, voiceProfiles.workspaceId],
			set: {
				...input,
				profileVersion: sql`${voiceProfiles.profileVersion} + 1`,
				lastAnalyzedAt: new Date(),
				updatedAt: sql`now()`,
			},
		})
		.returning();
	return result[0] ?? null;
}

export async function getVoiceProfile(userId: string, workspaceId: string) {
	const result = await db
		.select()
		.from(voiceProfiles)
		.where(and(eq(voiceProfiles.userId, userId), eq(voiceProfiles.workspaceId, workspaceId)))
		.limit(1);
	return result[0] ?? null;
}

export async function markCalibrationComplete(userId: string, workspaceId: string) {
	const result = await db
		.update(voiceProfiles)
		.set({ calibrationComplete: true, updatedAt: sql`now()` })
		.where(and(eq(voiceProfiles.userId, userId), eq(voiceProfiles.workspaceId, workspaceId)))
		.returning();
	return result[0] ?? null;
}
