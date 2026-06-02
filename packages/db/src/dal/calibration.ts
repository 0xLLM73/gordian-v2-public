import type { SealedEnvelope } from '@repo/crypto';
import { withKeys } from '@repo/crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { userCalibrations } from '../schema/calibration';
import { contacts } from '../schema/contacts';
import { messages } from '../schema/messages';

export interface CalibrationInput {
	communicationStyle?: 'formal' | 'casual' | 'direct' | 'diplomatic';
	detailPreference?: 'high_level' | 'balanced' | 'granular';
	riskTolerance?: 'conservative' | 'moderate' | 'aggressive';
	decisionSpeed?: 'deliberate' | 'moderate' | 'fast';
	relationshipFocus?: 'breadth' | 'balanced' | 'depth';
	priorities?: string[];
	industryFocus?: string[];
	roleDescription?: string;
	investmentThesis?: string;
	ticketSizeMin?: number;
	ticketSizeMax?: number;
}

export interface CalibrationContext {
	summary: string;
	dimensions: {
		communicationStyle: string;
		detailPreference: string;
		riskTolerance: string;
		decisionSpeed: string;
		relationshipFocus: string;
		priorities: string[];
		industryFocus: string[];
	};
	roleDescription: string | null;
	investmentThesis: string | null;
	ticketSizeMin: number | null;
	ticketSizeMax: number | null;
	version: number;
}

export type UserCalibration = typeof userCalibrations.$inferSelect;

export interface CalibrationCompletionStatus {
	completedAt: Date | null;
}

const COMMUNICATION_STYLE_LABELS: Record<string, string> = {
	formal: 'formal and professional',
	casual: 'casual and approachable',
	direct: 'direct and concise',
	diplomatic: 'diplomatic and tactful',
};

const DETAIL_PREFERENCE_LABELS: Record<string, string> = {
	high_level: 'prefers high-level summaries',
	balanced: 'prefers balanced detail',
	granular: 'prefers granular, detailed analysis',
};

const RISK_TOLERANCE_LABELS: Record<string, string> = {
	conservative: 'conservative risk tolerance',
	moderate: 'moderate risk tolerance',
	aggressive: 'aggressive risk tolerance',
};

const DECISION_SPEED_LABELS: Record<string, string> = {
	deliberate: 'deliberate decision-making pace',
	moderate: 'moderate decision-making pace',
	fast: 'fast-paced decision-making',
};

const RELATIONSHIP_FOCUS_LABELS: Record<string, string> = {
	breadth: 'prioritizes breadth of network',
	balanced: 'balanced network approach',
	depth: 'prioritizes depth of relationships',
};

const PRIORITY_LABELS: Record<string, string> = {
	deal_flow: 'deal flow',
	relationship_building: 'relationship building',
	market_intelligence: 'market intelligence',
	portfolio_support: 'portfolio support',
	networking: 'networking',
};

/**
 * Get current calibration for a user+workspace. Returns null if not yet set.
 * Encrypted fields (roleDescription, investmentThesis) are decrypted transparently
 * when called within a withKeys() context.
 */
export async function getCalibration(
	userId: string,
	workspaceId: string,
	envelope: SealedEnvelope,
): Promise<UserCalibration | null> {
	return withKeys(envelope, async () => {
		const rows = await db
			.select()
			.from(userCalibrations)
			.where(
				and(eq(userCalibrations.userId, userId), eq(userCalibrations.workspaceId, workspaceId)),
			)
			.limit(1);
		return rows[0] ?? null;
	});
}

export async function getCalibrationCompletionStatus(
	userId: string,
	workspaceId: string,
): Promise<CalibrationCompletionStatus | null> {
	const rows = await db
		.select({ completedAt: userCalibrations.completedAt })
		.from(userCalibrations)
		.where(and(eq(userCalibrations.userId, userId), eq(userCalibrations.workspaceId, workspaceId)))
		.limit(1);
	return rows[0] ?? null;
}

/**
 * Create or update calibration for a user+workspace.
 * Increments calibrationVersion on every update.
 * Sets completedAt on creation and every subsequent update.
 */
export async function upsertCalibration(
	userId: string,
	workspaceId: string,
	data: CalibrationInput,
	envelope: SealedEnvelope,
): Promise<UserCalibration> {
	return withKeys(envelope, async () => {
		const now = new Date();

		const existing = await db
			.select({ id: userCalibrations.id, calibrationVersion: userCalibrations.calibrationVersion })
			.from(userCalibrations)
			.where(
				and(eq(userCalibrations.userId, userId), eq(userCalibrations.workspaceId, workspaceId)),
			)
			.limit(1);

		if (existing[0]) {
			// Recalibration: increment version, set all provided fields
			const rows = await db
				.update(userCalibrations)
				.set({
					...(data.communicationStyle !== undefined && {
						communicationStyle: data.communicationStyle,
					}),
					...(data.detailPreference !== undefined && { detailPreference: data.detailPreference }),
					...(data.riskTolerance !== undefined && { riskTolerance: data.riskTolerance }),
					...(data.decisionSpeed !== undefined && { decisionSpeed: data.decisionSpeed }),
					...(data.relationshipFocus !== undefined && {
						relationshipFocus: data.relationshipFocus,
					}),
					...(data.priorities !== undefined && { priorities: data.priorities }),
					...(data.industryFocus !== undefined && { industryFocus: data.industryFocus }),
					...(data.roleDescription !== undefined && { roleDescription: data.roleDescription }),
					...(data.investmentThesis !== undefined && { investmentThesis: data.investmentThesis }),
					...(data.ticketSizeMin !== undefined && { ticketSizeMin: data.ticketSizeMin }),
					...(data.ticketSizeMax !== undefined && { ticketSizeMax: data.ticketSizeMax }),
					calibrationVersion: existing[0].calibrationVersion + 1,
					completedAt: now,
					updatedAt: now,
				})
				.where(eq(userCalibrations.id, existing[0].id))
				.returning();

			const row = rows[0];
			if (!row) throw new Error('upsertCalibration: update returned no rows');
			return row;
		}

		// First calibration
		const rows = await db
			.insert(userCalibrations)
			.values({
				userId,
				workspaceId,
				...(data.communicationStyle !== undefined && {
					communicationStyle: data.communicationStyle,
				}),
				...(data.detailPreference !== undefined && { detailPreference: data.detailPreference }),
				...(data.riskTolerance !== undefined && { riskTolerance: data.riskTolerance }),
				...(data.decisionSpeed !== undefined && { decisionSpeed: data.decisionSpeed }),
				...(data.relationshipFocus !== undefined && { relationshipFocus: data.relationshipFocus }),
				...(data.priorities !== undefined && { priorities: data.priorities }),
				...(data.industryFocus !== undefined && { industryFocus: data.industryFocus }),
				...(data.roleDescription !== undefined && { roleDescription: data.roleDescription }),
				...(data.investmentThesis !== undefined && { investmentThesis: data.investmentThesis }),
				...(data.ticketSizeMin !== undefined && { ticketSizeMin: data.ticketSizeMin }),
				...(data.ticketSizeMax !== undefined && { ticketSizeMax: data.ticketSizeMax }),
				completedAt: now,
			})
			.returning();

		const row = rows[0];
		if (!row) throw new Error('upsertCalibration: insert returned no rows');
		return row;
	});
}

/**
 * Get calibration formatted as a structured AI context object.
 * Returns null if no calibration exists or completedAt is not set.
 */
export async function getCalibrationForAI(
	userId: string,
	workspaceId: string,
	envelope: SealedEnvelope,
): Promise<CalibrationContext | null> {
	const calibration = await getCalibration(userId, workspaceId, envelope);
	if (!calibration || !calibration.completedAt) return null;

	const parts: string[] = [];

	if (calibration.roleDescription) {
		parts.push(`Role: ${calibration.roleDescription}`);
	}

	parts.push(
		`Communication: ${COMMUNICATION_STYLE_LABELS[calibration.communicationStyle] ?? calibration.communicationStyle}, ${DETAIL_PREFERENCE_LABELS[calibration.detailPreference] ?? calibration.detailPreference}`,
	);

	parts.push(
		`Decision style: ${RISK_TOLERANCE_LABELS[calibration.riskTolerance] ?? calibration.riskTolerance}, ${DECISION_SPEED_LABELS[calibration.decisionSpeed] ?? calibration.decisionSpeed}`,
	);

	parts.push(
		`Relationships: ${RELATIONSHIP_FOCUS_LABELS[calibration.relationshipFocus] ?? calibration.relationshipFocus}`,
	);

	if (calibration.industryFocus.length > 0) {
		parts.push(`Industry focus: ${calibration.industryFocus.join(', ')}`);
	}

	if (calibration.priorities.length > 0) {
		parts.push(
			`Priorities: ${calibration.priorities.map((p) => PRIORITY_LABELS[p] ?? p).join(', ')}`,
		);
	}

	if (calibration.investmentThesis) {
		parts.push(`Investment thesis: ${calibration.investmentThesis}`);
	}

	if (calibration.ticketSizeMin || calibration.ticketSizeMax) {
		const formatUsd = (cents: number) => `$${(cents / 100).toLocaleString()}`;
		if (calibration.ticketSizeMin && calibration.ticketSizeMax) {
			parts.push(
				`Ticket size: ${formatUsd(calibration.ticketSizeMin)} - ${formatUsd(calibration.ticketSizeMax)}`,
			);
		} else if (calibration.ticketSizeMin) {
			parts.push(`Ticket size: ${formatUsd(calibration.ticketSizeMin)}+`);
		} else if (calibration.ticketSizeMax) {
			parts.push(`Ticket size: up to ${formatUsd(calibration.ticketSizeMax)}`);
		}
	}

	return {
		summary: `User profile: ${parts.join('. ')}.`,
		dimensions: {
			communicationStyle: calibration.communicationStyle,
			detailPreference: calibration.detailPreference,
			riskTolerance: calibration.riskTolerance,
			decisionSpeed: calibration.decisionSpeed,
			relationshipFocus: calibration.relationshipFocus,
			priorities: calibration.priorities,
			industryFocus: calibration.industryFocus,
		},
		roleDescription: calibration.roleDescription,
		investmentThesis: calibration.investmentThesis,
		ticketSizeMin: calibration.ticketSizeMin,
		ticketSizeMax: calibration.ticketSizeMax,
		version: calibration.calibrationVersion,
	};
}

// ─── What Matters (Coffee Test + Priority Contacts) ─────────────────────────

export interface WhatMattersInput {
	commitmentSensitivity: 'everything' | 'specific' | 'tasks_only';
	priorityContactIds: string[];
	userRole?: 'vc_investor' | 'founder' | 'bd' | 'community' | 'developer' | 'other';
	primaryGoal?: 'commitments' | 'reconnect' | 'network' | 'deal_flow';
}

/**
 * Save Coffee Test + Priority Contacts data.
 * Upserts the user_calibrations row with the new fields.
 */
export async function saveWhatMatters(
	userId: string,
	workspaceId: string,
	data: WhatMattersInput,
): Promise<void> {
	const now = new Date();

	const existing = await db
		.select({ id: userCalibrations.id })
		.from(userCalibrations)
		.where(and(eq(userCalibrations.userId, userId), eq(userCalibrations.workspaceId, workspaceId)))
		.limit(1);

	if (existing[0]) {
		await db
			.update(userCalibrations)
			.set({
				commitmentSensitivity: data.commitmentSensitivity,
				priorityContactIds: data.priorityContactIds,
				...(data.userRole !== undefined && { userRole: data.userRole }),
				...(data.primaryGoal !== undefined && { primaryGoal: data.primaryGoal }),
				updatedAt: now,
			})
			.where(eq(userCalibrations.id, existing[0].id));
	} else {
		await db.insert(userCalibrations).values({
			userId,
			workspaceId,
			commitmentSensitivity: data.commitmentSensitivity,
			priorityContactIds: data.priorityContactIds,
			...(data.userRole !== undefined && { userRole: data.userRole }),
			...(data.primaryGoal !== undefined && { primaryGoal: data.primaryGoal }),
		});
	}
}

// ─── Consent Persistence ────────────────────────────────────────────────────

export interface ConsentInput {
	consentDataProcessing: boolean;
	consentAiAnalysis: boolean;
	consentTelegramAccess: boolean;
	consentVersion?: number;
}

/**
 * Persist GDPR consent flags to DB (replaces sessionStorage-only storage).
 * Upserts the user_calibrations row with consent fields.
 */
export async function saveConsent(
	userId: string,
	workspaceId: string,
	data: ConsentInput,
): Promise<void> {
	const now = new Date();
	const consentVersion = data.consentVersion ?? 1;

	const existing = await db
		.select({ id: userCalibrations.id })
		.from(userCalibrations)
		.where(and(eq(userCalibrations.userId, userId), eq(userCalibrations.workspaceId, workspaceId)))
		.limit(1);

	if (existing[0]) {
		await db
			.update(userCalibrations)
			.set({
				consentDataProcessing: data.consentDataProcessing,
				consentAiAnalysis: data.consentAiAnalysis,
				consentTelegramAccess: data.consentTelegramAccess,
				consentTimestamp: now,
				consentVersion,
				updatedAt: now,
			})
			.where(eq(userCalibrations.id, existing[0].id));
	} else {
		await db.insert(userCalibrations).values({
			userId,
			workspaceId,
			consentDataProcessing: data.consentDataProcessing,
			consentAiAnalysis: data.consentAiAnalysis,
			consentTelegramAccess: data.consentTelegramAccess,
			consentTimestamp: now,
			consentVersion,
		});
	}
}

/**
 * Check if a user has given data processing consent.
 * Returns true if consent_data_processing is true, or if no calibration row exists
 * (pre-consent onboarding steps should still track).
 */
export async function hasAnalyticsConsent(userId: string, workspaceId: string): Promise<boolean> {
	const row = await db
		.select({ consent: userCalibrations.consentDataProcessing })
		.from(userCalibrations)
		.where(and(eq(userCalibrations.userId, userId), eq(userCalibrations.workspaceId, workspaceId)))
		.limit(1);

	// No calibration row yet = pre-consent onboarding, allow tracking
	if (!row[0]) return true;
	return row[0].consent;
}

/**
 * Check whether any user in a workspace has explicitly enabled AI analysis.
 * Used by worker-side jobs that only know workspaceId, not the initiating user.
 */
export async function hasWorkspaceAiAnalysisConsent(workspaceId: string): Promise<boolean> {
	const row = await db
		.select({ consent: userCalibrations.consentAiAnalysis })
		.from(userCalibrations)
		.where(
			and(
				eq(userCalibrations.workspaceId, workspaceId),
				eq(userCalibrations.consentAiAnalysis, true),
			),
		)
		.limit(1);

	return row[0]?.consent === true;
}

/** Check whether this specific user has explicitly enabled AI analysis in the workspace. */
export async function hasUserAiAnalysisConsent(
	userId: string,
	workspaceId: string,
): Promise<boolean> {
	const row = await db
		.select({ consent: userCalibrations.consentAiAnalysis })
		.from(userCalibrations)
		.where(and(eq(userCalibrations.userId, userId), eq(userCalibrations.workspaceId, workspaceId)))
		.limit(1);

	return row[0]?.consent === true;
}

// ─── Priority Contact Suggestions ───────────────────────────────────────────

export interface ContactSuggestion {
	id: string;
	firstName: string | null;
	lastName: string | null;
	messageCount: number;
	lastMessageAt: Date | null;
}

/**
 * Get top contacts by message count (most active).
 * Used by the What Matters page to suggest priority contacts.
 */
export async function getMostActiveContacts(
	workspaceId: string,
	envelope: SealedEnvelope,
	limit = 5,
): Promise<ContactSuggestion[]> {
	return withKeys(envelope, async () => {
		const rows = await db
			.select({
				id: contacts.id,
				firstName: contacts.firstName,
				lastName: contacts.lastName,
				messageCount: sql<number>`count(${messages.id})::int`,
				lastMessageAt: sql<Date | null>`max(${messages.sentAt})`,
			})
			.from(contacts)
			.leftJoin(
				messages,
				and(eq(messages.contactId, contacts.id), eq(messages.workspaceId, workspaceId)),
			)
			.where(eq(contacts.workspaceId, workspaceId))
			.groupBy(contacts.id)
			.orderBy(sql`count(${messages.id}) desc`)
			.limit(limit);

		return rows;
	});
}

/**
 * Get most neglected contacts (longest silence).
 * Used by the What Matters page to suggest priority contacts.
 */
export async function getMostNeglectedContacts(
	workspaceId: string,
	envelope: SealedEnvelope,
	limit = 3,
): Promise<ContactSuggestion[]> {
	return withKeys(envelope, async () => {
		const rows = await db
			.select({
				id: contacts.id,
				firstName: contacts.firstName,
				lastName: contacts.lastName,
				messageCount: sql<number>`count(${messages.id})::int`,
				lastMessageAt: sql<Date | null>`max(${messages.sentAt})`,
			})
			.from(contacts)
			.innerJoin(
				messages,
				and(eq(messages.contactId, contacts.id), eq(messages.workspaceId, workspaceId)),
			)
			.where(eq(contacts.workspaceId, workspaceId))
			.groupBy(contacts.id)
			.orderBy(sql`max(${messages.sentAt}) asc`)
			.limit(limit);

		return rows;
	});
}
