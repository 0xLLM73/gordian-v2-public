import { eq, or, sql } from 'drizzle-orm';
import { db } from '../client';
import { auditLogs } from '../schema/audit-log';
import { accounts, sessions } from '../schema/auth';
import { userBehaviors } from '../schema/behaviors';
import { briefs } from '../schema/briefs';
import { calendarConnections, calendarEvents } from '../schema/calendar';
import { userCalibrations } from '../schema/calibration';
import { chatParticipants } from '../schema/chat-participants';
import { chats } from '../schema/chats';
import { commitments } from '../schema/commitments';
import { connections } from '../schema/connections';
import { contactShares } from '../schema/contact-shares';
import { contactStyleOverrides } from '../schema/contact-style-overrides';
import { contactTags } from '../schema/contact-tags';
import { contacts } from '../schema/contacts';
import { correctionDiffs } from '../schema/correction-diffs';
import { dealArtifacts } from '../schema/deal-artifacts';
import { dealCandidates } from '../schema/deal-candidates';
import { dealParticipants } from '../schema/deal-participants';
import { deals } from '../schema/deals';
import { causalEdges, userDecisions } from '../schema/decisions';
import { digests } from '../schema/digests';
import { draftLogs } from '../schema/drafts';
import { featureFlags } from '../schema/feature-flags';
import { followUpPlanSteps, followUpPlans } from '../schema/follow-up-plans';
import { goalActions } from '../schema/goal-actions';
import { goalProgressEvents, goals } from '../schema/goals';
import { banditLedger, goldenDataset } from '../schema/golden-dataset';
import { contactHealthScores } from '../schema/health-scores';
import { introductions } from '../schema/introductions';
import { investorProfiles } from '../schema/investor-profiles';
import {
	knowledgeContacts,
	knowledgeEvidence,
	knowledgeExtractionLog,
	knowledgeLinks,
	knowledgeNodes,
} from '../schema/knowledge';
import { memories } from '../schema/memories';
import { messages } from '../schema/messages';
import { outcomes } from '../schema/outcomes';
import { recommendations } from '../schema/recommendations';
import { contactRelationships } from '../schema/relationships';
import { semanticCache } from '../schema/semantic-cache';
import { contactSummaries } from '../schema/summaries';
import { tokenMentions, tokenWatchlist } from '../schema/tokens';
import { userPreferences } from '../schema/user-preferences';
import { users } from '../schema/users';
import { voiceProfiles } from '../schema/voice-profiles';
import { workspaceInvites, workspaceMembers, workspaces } from '../schema/workspaces';

/**
 * Delete all workspace data and the user account in a single transaction.
 * FK-ordered cascade: child tables first, then hub tables, then workspace, then user.
 * CRITICAL: This is irreversible. Caller must verify ownership before calling.
 */
export async function deleteAccountData(workspaceId: string, userId: string): Promise<void> {
	await db.transaction(async (tx) => {
		const wid = workspaceId;

		// ── Audit: log deletion intent (will be cascade-deleted with workspace) ──
		await tx.insert(auditLogs).values({
			workspaceId: wid,
			actorType: 'user',
			actorId: userId,
			action: 'delete',
			resourceType: 'preference',
			metadata: { type: 'account_deletion' },
		});

		// ── Auth/session layer ──
		await tx.delete(sessions).where(eq(sessions.userId, userId));
		await tx.delete(accounts).where(eq(accounts.userId, userId));

		// ── Chat layer ──
		await tx.delete(chatParticipants).where(eq(chatParticipants.workspaceId, wid));
		await tx.delete(messages).where(eq(messages.workspaceId, wid));
		await tx.delete(chats).where(eq(chats.workspaceId, wid));

		// ── Follow-up plan layer (steps have CASCADE from plans, but explicit for safety) ──
		await tx.delete(followUpPlanSteps).where(eq(followUpPlanSteps.workspaceId, wid));
		await tx.delete(followUpPlans).where(eq(followUpPlans.workspaceId, wid));

		// ── Draft & token layer ──
		await tx.delete(draftLogs).where(eq(draftLogs.workspaceId, wid));
		await tx.delete(tokenMentions).where(eq(tokenMentions.workspaceId, wid));
		await tx.delete(tokenWatchlist).where(eq(tokenWatchlist.workspaceId, wid));

		// ── Calendar layer ──
		await tx.delete(calendarEvents).where(
			sql`${calendarEvents.connectionId} IN (
				SELECT id FROM calendar_connections WHERE workspace_id = ${wid}
			)`,
		);
		await tx.delete(calendarConnections).where(eq(calendarConnections.workspaceId, wid));

		// ── Relationship layer ──
		await tx.delete(introductions).where(eq(introductions.workspaceId, wid));
		await tx.delete(connections).where(eq(connections.workspaceId, wid));
		await tx.delete(contactRelationships).where(eq(contactRelationships.workspaceId, wid));
		await tx.delete(contactHealthScores).where(eq(contactHealthScores.workspaceId, wid));
		await tx.delete(contactSummaries).where(eq(contactSummaries.workspaceId, wid));
		await tx.delete(contactStyleOverrides).where(eq(contactStyleOverrides.workspaceId, wid));

		// ── Deal layer (participants + artifacts have CASCADE, but explicit) ──
		await tx.delete(dealCandidates).where(eq(dealCandidates.workspaceId, wid));
		await tx.delete(dealParticipants).where(
			sql`${dealParticipants.dealId} IN (
				SELECT id FROM deals WHERE workspace_id = ${wid}
			)`,
		);
		await tx.delete(dealArtifacts).where(
			sql`${dealArtifacts.dealId} IN (
				SELECT id FROM deals WHERE workspace_id = ${wid}
			)`,
		);
		await tx.delete(deals).where(eq(deals.workspaceId, wid));

		// ── Commitment & goal layer ──
		await tx.delete(commitments).where(eq(commitments.workspaceId, wid));
		await tx.delete(goalActions).where(eq(goalActions.workspaceId, wid));
		await tx.delete(goalProgressEvents).where(eq(goalProgressEvents.workspaceId, wid));
		await tx.delete(goals).where(eq(goals.workspaceId, wid));
		await tx.delete(memories).where(eq(memories.workspaceId, wid));

		// ── Knowledge graph layer ──
		await tx.delete(knowledgeEvidence).where(eq(knowledgeEvidence.workspaceId, wid));
		await tx.delete(knowledgeContacts).where(eq(knowledgeContacts.workspaceId, wid));
		await tx.delete(knowledgeLinks).where(eq(knowledgeLinks.workspaceId, wid));
		await tx.delete(knowledgeExtractionLog).where(eq(knowledgeExtractionLog.workspaceId, wid));
		await tx.delete(knowledgeNodes).where(eq(knowledgeNodes.workspaceId, wid));

		// ── Contact layer (hub table — delete after all dependents) ──
		await tx.delete(contactShares).where(eq(contactShares.workspaceId, wid));
		await tx.delete(contactTags).where(eq(contactTags.workspaceId, wid));
		await tx.delete(contacts).where(eq(contacts.workspaceId, wid));

		// ── Analytics & decision layer ──
		await tx.delete(userBehaviors).where(eq(userBehaviors.workspaceId, wid));
		await tx.delete(causalEdges).where(eq(causalEdges.workspaceId, wid));
		await tx.delete(userDecisions).where(eq(userDecisions.workspaceId, wid));
		await tx.delete(recommendations).where(eq(recommendations.workspaceId, wid));
		await tx.delete(investorProfiles).where(eq(investorProfiles.workspaceId, wid));
		await tx.delete(outcomes).where(eq(outcomes.workspaceId, wid));

		// ── Learning, generated data, user preference & content layer ──
		await tx.delete(banditLedger).where(eq(banditLedger.userId, userId));
		await tx
			.delete(goldenDataset)
			.where(or(eq(goldenDataset.workspaceId, wid), eq(goldenDataset.verifiedBy, userId)));
		await tx.delete(correctionDiffs).where(eq(correctionDiffs.workspaceId, wid));
		await tx.delete(semanticCache).where(eq(semanticCache.workspaceId, wid));
		await tx.delete(featureFlags).where(eq(featureFlags.workspaceId, wid));
		await tx.delete(userPreferences).where(eq(userPreferences.workspaceId, wid));
		await tx.delete(voiceProfiles).where(eq(voiceProfiles.workspaceId, wid));
		await tx.delete(digests).where(eq(digests.workspaceId, wid));
		await tx.delete(briefs).where(or(eq(briefs.workspaceId, wid), eq(briefs.userId, userId)));
		await tx.delete(userCalibrations).where(eq(userCalibrations.workspaceId, wid));

		// ── Audit logs (CASCADE from workspace, but explicit for completeness) ──
		await tx.delete(auditLogs).where(eq(auditLogs.workspaceId, wid));

		// ── Workspace infrastructure ──
		await tx.delete(workspaceInvites).where(eq(workspaceInvites.workspaceId, wid));
		await tx.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, wid));
		await tx.delete(workspaces).where(eq(workspaces.id, wid));

		// ── User record (sessions + accounts CASCADE automatically) ──
		await tx.delete(users).where(eq(users.id, userId));
	});
}

/**
 * Delete only the authenticated user's account shell after callers have verified
 * the user does not own a workspace. Workspace data remains intact for the
 * remaining members.
 */
export async function deleteUserAccountOnly(userId: string): Promise<void> {
	await db.transaction(async (tx) => {
		const [ownedWorkspace] = await tx
			.select({ id: workspaces.id })
			.from(workspaces)
			.where(eq(workspaces.ownerId, userId))
			.limit(1);
		if (ownedWorkspace) {
			throw new Error(
				'Workspace owners must delete the workspace explicitly before deleting their user account',
			);
		}

		await tx.delete(workspaceMembers).where(eq(workspaceMembers.userId, userId));
		await tx.delete(users).where(eq(users.id, userId));
	});
}
