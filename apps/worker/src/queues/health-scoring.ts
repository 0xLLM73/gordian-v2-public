import type { SealedEnvelope } from '@repo/crypto';
import {
	type ContactHealthFeedbackRow,
	commitments,
	contactRelationships,
	contactTags,
	contacts,
	db,
	eq,
	getActiveContactHealthFeedback,
	getHealthScoresByWorkspace,
	getMessagesByContact,
	hasWorkspaceAiAnalysisConsent,
	messages,
	sql,
	upsertHealthScore,
} from '@repo/db';
import { Worker } from 'bullmq';
import {
	type RelationshipHealthAiSignals,
	analyzeRelationshipHealthLocal,
	canRunLocalRelationshipHealthAnalysis,
} from '../ai/relationship-health';
import { withRLS } from '../middleware/rls';
import { broadcastUpdate } from '../realtime/broadcast';
import { connection } from '../redis';
import {
	type HealthScoringJobData,
	queueHealthScoringForAllWorkspaces,
} from './health-scoring-queue';
import { enqueueRelationshipEvaluation } from './outcome-evaluation';

export {
	enqueueHealthScoringForWorkspace,
	getHealthScoringFreshness,
	healthScoringQueue,
	isHealthScoringFresh,
	queueHealthScoringForAllWorkspaces,
	resolveHealthScoringStaleAfterMs,
} from './health-scoring-queue';
export type {
	EnqueueHealthScoringOptions,
	EnqueueHealthScoringResult,
	HealthScoringFreshness,
	HealthScoringJobData,
} from './health-scoring-queue';

// ─── Weights ────────────────────────────────────────────────────────────────

const WEIGHTS = {
	recency: 0.3,
	frequency: 0.25,
	responseLatency: 0.25,
	depth: 0.2,
} as const;

const MIN_POSTGRES_REAL_MAGNITUDE = 1e-37;
const RECENT_UNANSWERED_REPLY_DAYS = 30;

function normalizeScore(value: number): number {
	if (!Number.isFinite(value)) return 0;
	const clamped = Math.min(1, Math.max(0, value));
	return clamped > 0 && clamped < MIN_POSTGRES_REAL_MAGNITUDE ? 0 : clamped;
}

// ─── Decay lambdas (per relationship type) ──────────────────────────────────

const DECAY_LAMBDA: Record<string, number> = {
	co_founder: 0.069,
	employee: 0.05,
	investor: 0.023,
	advisor: 0.015,
	client: 0.033,
	partner: 0.023,
	// contactRelationshipEnum mappings
	colleague: 0.05,
	prospect: 0.033,
	mentor: 0.015,
	mentee: 0.015,
	vendor: 0.023,
	friend: 0.05,
	family: 0.05,
	other: 0.05,
	default: 0.05,
};

// ─── Pure scoring functions (exported for unit tests) ───────────────────────

export function getDecayLambda(relationshipType?: string | null): number {
	if (!relationshipType) return DECAY_LAMBDA.default;
	return DECAY_LAMBDA[relationshipType] ?? DECAY_LAMBDA.default;
}

/**
 * H5: Weibull depth-adjusted lambda.
 * Deep relationships (many messages) decay slower.
 */
export function getEffectiveLambda(lambdaBase: number, totalMessages: number): number {
	return lambdaBase / Math.max(1, Math.log(1 + 0.1 * totalMessages));
}

/**
 * Recency score: exponential decay e^(-lambda_effective * days).
 * Returns 0 if no messages found (null days).
 * H5: lambda adjusted by message depth via Weibull decay.
 */
export function computeRecency(
	daysSinceLastMessage: number | null,
	relationshipType?: string | null,
	totalMessages = 0,
): number {
	if (daysSinceLastMessage === null) return 0;
	const lambdaBase = getDecayLambda(relationshipType);
	const lambda = getEffectiveLambda(lambdaBase, totalMessages);
	return normalizeScore(Math.exp(-lambda * daysSinceLastMessage));
}

// ─── Gaussian frequency centers (messages/week per relationship type) ────────

const FREQUENCY_CENTER: Record<string, number> = {
	co_founder: 15,
	employee: 10,
	investor: 1,
	advisor: 0.5,
	client: 3,
	partner: 2,
	default: 5,
};

/**
 * Frequency score: Gaussian bell curve centered per relationship type.
 * exp(-0.5 * ((x - center) / sigma)^2), sigma = center.
 * Penalizes both too much and too little contact.
 */
export function computeFrequency(
	messagesPerWeek: number,
	relationshipType?: string | null,
): number {
	const center = FREQUENCY_CENTER[relationshipType ?? ''] ?? FREQUENCY_CENTER.default;
	const sigma = center;
	if (sigma === 0) return messagesPerWeek === 0 ? 1 : 0;
	const z = (messagesPerWeek - center) / sigma;
	return normalizeScore(Math.exp(-0.5 * z * z));
}

/**
 * Response latency score: inverted sigmoid on median response time (hours).
 * 1 / (1 + exp(k * (t - L50)))
 * L50 = 4 hours (business-hours baseline), k = 0.5.
 * Returns 0.5 (neutral) when no response data available.
 */
export function computeResponseLatency(medianResponseHours: number | null): number {
	if (medianResponseHours === null) return 0.5;
	const L50 = 4;
	const k = 0.5;
	return normalizeScore(1 / (1 + Math.exp(k * (medianResponseHours - L50))));
}

/**
 * Fulfillment score: completed / total commitments.
 * Returns 0.5 (neutral) if no commitments exist.
 */
export function computeFulfillment(completed: number, total: number): number {
	if (total === 0) return 0.5;
	return completed / total;
}

/**
 * Label from composite score.
 * thriving >= 0.75, healthy >= 0.50, cooling >= 0.25, dormant < 0.25
 */
export function computeLabel(composite: number): string {
	if (composite >= 0.75) return 'thriving';
	if (composite >= 0.5) return 'healthy';
	if (composite >= 0.25) return 'cooling';
	return 'dormant';
}

/**
 * Trend from current vs previous composite.
 * improving: delta > 0.05, declining: delta < -0.05, stable otherwise.
 * Returns 'stable' if no previous score.
 */
export function computeTrend(current: number, previous: number | null): string {
	if (previous === null) return 'stable';
	// Round to 4 decimal places to avoid floating point drift (e.g. 0.65-0.60 = 0.050000...044)
	const delta = Math.round((current - previous) * 10000) / 10000;
	if (delta > 0.05) return 'improving';
	if (delta < -0.05) return 'declining';
	return 'stable';
}

// ─── Label tier ordering (higher = healthier) ───────────────────────────────

const LABEL_TIER: Record<string, number> = {
	thriving: 3,
	healthy: 2,
	steady_low_touch: 2,
	cooling: 1,
	learning: 1,
	dormant: 0,
};

export interface LabelTransition {
	contactId: string;
	previousLabel: string;
	newLabel: string;
	composite: number;
}

/**
 * Returns true if a contact transitioned DOWN to 'cooling' or 'dormant'
 * from a higher tier.
 */
export function isGhostingTransition(
	previousLabel: string | null | undefined,
	newLabel: string,
): boolean {
	if (!previousLabel) return false;
	if (newLabel !== 'cooling' && newLabel !== 'dormant') return false;
	return (LABEL_TIER[previousLabel] ?? 0) > (LABEL_TIER[newLabel] ?? 0);
}

type ContactPriority = 'high' | 'medium' | 'low' | null | undefined;

export type HealthReasonCode =
	| 'frequency_drop'
	| 'gap_longer_than_usual'
	| 'healthy'
	| 'learning'
	| 'mutual_gap'
	| 'needs_reply'
	| 'one_sided_initiation'
	| 'steady_low_touch';

export interface ContactCadenceStats {
	baselineSessions: number;
	historyDays: number;
	lastInteractionAt: string | null;
	medianGapDays: number | null;
	p75GapDays: number | null;
	p90GapDays: number | null;
	recentSessions: number;
	sessionCount: number;
}

export interface HealthScoringInsight {
	attention: {
		actionability: number;
		priorityWeight: number;
		score: number;
	};
	cadence: {
		currentGapDays: number | null;
		expectedGapDays: number;
		expectedGapRange: string;
		historyDays: number;
		p75GapDays: number | null;
		p90GapDays: number | null;
		sessionCount: number;
	};
	confidence: {
		label: 'high' | 'low' | 'medium';
		reasons: string[];
		score: number;
	};
	sourceCoverage: {
		directChat: boolean;
		groupSignals: boolean;
		sparse: boolean;
	};
	statusReason: {
		code: HealthReasonCode;
		directionality: 'low_touch' | 'mutual_gap' | 'they_slowed' | 'unknown' | 'user_owes';
		plainLanguage: string;
		privacyLevel: 'aggregate_only';
		suggestedAction: 'none' | 'open_chat' | 'send_light_checkin' | 'set_cadence' | 'snooze';
	};
	version: 2;
}

interface HealthScoringInsightInput {
	baseLabel: string;
	cadence?: ContactCadenceStats | null;
	composite: number;
	daysSinceLast: number | null;
	incoming: number;
	lastIsOutgoing?: boolean | null;
	medianResponseHours: number | null;
	outgoing: number;
	priority?: ContactPriority;
	recentMessages: number;
	relationshipType?: string | null;
	totalMessages: number;
}

function clamp(value: number, min = 0, max = 1): number {
	if (!Number.isFinite(value)) return min;
	return Math.max(min, Math.min(max, value));
}

function toFiniteNumber(value: unknown): number | null {
	if (value === null || value === undefined) return null;
	const num = Number(value);
	return Number.isFinite(num) ? num : null;
}

function relationshipDefaultCadenceDays(relationshipType?: string | null): number {
	switch (relationshipType) {
		case 'family':
			return 45;
		case 'friend':
			return 30;
		case 'advisor':
		case 'mentor':
		case 'mentee':
			return 45;
		case 'investor':
			return 90;
		case 'partner':
		case 'client':
		case 'prospect':
		case 'vendor':
			return 30;
		case 'co_founder':
		case 'employee':
		case 'colleague':
			return 14;
		default:
			return 45;
	}
}

function priorityWeight(priority?: ContactPriority): number {
	if (priority === 'high') return 1.25;
	if (priority === 'low') return 0.65;
	return 1;
}

function confidenceFromCadence(input: {
	cadence?: ContactCadenceStats | null;
	totalMessages: number;
}): HealthScoringInsight['confidence'] {
	const sessionCount = input.cadence?.sessionCount ?? 0;
	const historyDays = input.cadence?.historyDays ?? 0;
	const reasons: string[] = [];
	let score = 0.2;

	if (sessionCount >= 12) {
		score += 0.35;
		reasons.push(`${sessionCount} interaction days`);
	} else if (sessionCount >= 5) {
		score += 0.2;
		reasons.push(`${sessionCount} interaction days`);
	} else if (sessionCount > 0) {
		reasons.push('limited interaction history');
	}

	if (historyDays >= 180) {
		score += 0.25;
		reasons.push('6mo+ history');
	} else if (historyDays >= 60) {
		score += 0.15;
		reasons.push('60d+ history');
	}

	if (input.totalMessages >= 50) {
		score += 0.15;
		reasons.push('message depth');
	} else if (input.totalMessages >= 10) {
		score += 0.08;
		reasons.push('some message depth');
	}

	score = clamp(score);
	return {
		score,
		label: score >= 0.75 ? 'high' : score >= 0.45 ? 'medium' : 'low',
		reasons: reasons.length ? reasons : ['not enough history'],
	};
}

function expectedCadenceDays(
	cadence: ContactCadenceStats | null | undefined,
	relationshipType?: string | null,
): number {
	const learned = toFiniteNumber(cadence?.p75GapDays) ?? toFiniteNumber(cadence?.medianGapDays);
	const fallback = relationshipDefaultCadenceDays(relationshipType);
	if (!learned || learned <= 0) return fallback;
	return Math.max(3, Math.round((learned * 0.75 + fallback * 0.25) * 10) / 10);
}

function cadenceRange(expectedDays: number, cadence?: ContactCadenceStats | null): string {
	const median = toFiniteNumber(cadence?.medianGapDays);
	const p75 = toFiniteNumber(cadence?.p75GapDays);
	if (median && p75 && p75 >= median) {
		return `${Math.round(median)}-${Math.round(p75)}`;
	}
	const lower = Math.max(1, Math.round(expectedDays * 0.7));
	const upper = Math.max(lower, Math.round(expectedDays * 1.3));
	return `${lower}-${upper}`;
}

function frequencyDropRisk(cadence?: ContactCadenceStats | null): number {
	const recent = cadence?.recentSessions ?? 0;
	const baseline = cadence?.baselineSessions ?? 0;
	if (baseline < 3) return 0;
	const expectedRecent = baseline * (28 / 90);
	if (expectedRecent < 1.5) return 0;
	return clamp(1 - recent / expectedRecent);
}

function reasonCopy(input: {
	code: HealthReasonCode;
	currentGapDays: number | null;
	expectedRange: string;
	frequencyDrop: number;
}): string {
	const gap = input.currentGapDays === null ? null : Math.round(input.currentGapDays);
	switch (input.code) {
		case 'needs_reply':
			return gap === null
				? 'The last direct message appears to be from them, and Gordian does not see your reply yet.'
				: `They sent the last direct message ${gap}d ago; Gordian does not see your reply yet.`;
		case 'gap_longer_than_usual':
			return gap === null
				? `No recent meaningful 1:1 is recorded; usual cadence is about ${input.expectedRange}d.`
				: `No meaningful 1:1 in ${gap}d; usual cadence is about ${input.expectedRange}d.`;
		case 'frequency_drop':
			return `Meaningful contact is down about ${Math.round(input.frequencyDrop * 100)}% versus this relationship's recent baseline.`;
		case 'mutual_gap':
			return gap === null
				? `Communication has slowed compared with the usual ${input.expectedRange}d cadence.`
				: `Communication has slowed for ${gap}d compared with the usual ${input.expectedRange}d cadence.`;
		case 'one_sided_initiation':
			return 'You are initiating more than usual; replies still exist, but the balance has shifted.';
		case 'steady_low_touch':
			return `Quiet, but normal for this contact's ${input.expectedRange}d cadence.`;
		case 'learning':
			return 'Gordian is still learning this relationship cadence.';
		case 'healthy':
			return 'Communication looks consistent with this relationship pattern.';
	}
}

export function buildHealthScoringInsight(input: HealthScoringInsightInput): HealthScoringInsight {
	const cadence = input.cadence ?? null;
	const confidence = confidenceFromCadence({
		cadence,
		totalMessages: input.totalMessages,
	});
	const expectedGapDays = expectedCadenceDays(cadence, input.relationshipType);
	const expectedGapRange = cadenceRange(expectedGapDays, cadence);
	const currentGap = input.daysSinceLast;
	const enoughCadence = (cadence?.sessionCount ?? 0) >= 5 && (cadence?.historyDays ?? 0) >= 30;
	const freqDrop = frequencyDropRisk(cadence);
	const gapRatio = currentGap === null ? 0 : currentGap / expectedGapDays;
	const p90 = toFiniteNumber(cadence?.p90GapDays);
	const isLowTouchCadence = expectedGapDays >= 45;
	const withinLowTouchPattern =
		currentGap !== null &&
		isLowTouchCadence &&
		currentGap <= Math.max(expectedGapDays * 1.5, p90 ?? 0);
	const userOwesReply =
		input.lastIsOutgoing === false &&
		currentGap !== null &&
		currentGap >= 3 &&
		currentGap <= RECENT_UNANSWERED_REPLY_DAYS &&
		input.incoming > 0;
	const oneSided =
		input.outgoing >= Math.max(4, input.incoming * 2) &&
		currentGap !== null &&
		currentGap > expectedGapDays;

	let code: HealthReasonCode = 'healthy';
	let directionality: HealthScoringInsight['statusReason']['directionality'] = 'unknown';
	let suggestedAction: HealthScoringInsight['statusReason']['suggestedAction'] = 'none';
	let actionability = 0.25;

	if (!enoughCadence && !userOwesReply) {
		code = 'learning';
		suggestedAction = 'set_cadence';
		actionability = 0.1;
	} else if (withinLowTouchPattern && !userOwesReply) {
		code = 'steady_low_touch';
		directionality = 'low_touch';
		suggestedAction = 'none';
		actionability = 0.05;
	} else if (userOwesReply) {
		code = 'needs_reply';
		directionality = 'user_owes';
		suggestedAction = 'open_chat';
		actionability = 1;
	} else if (gapRatio >= 1.75 || (p90 !== null && currentGap !== null && currentGap > p90)) {
		code = 'gap_longer_than_usual';
		directionality = 'mutual_gap';
		suggestedAction = 'send_light_checkin';
		actionability = 0.85;
	} else if (freqDrop >= 0.6) {
		code = 'frequency_drop';
		directionality = 'mutual_gap';
		suggestedAction = 'send_light_checkin';
		actionability = 0.75;
	} else if (oneSided) {
		code = 'one_sided_initiation';
		directionality = 'they_slowed';
		suggestedAction = 'snooze';
		actionability = 0.55;
	} else if (input.baseLabel === 'cooling' || input.baseLabel === 'dormant') {
		code = 'mutual_gap';
		directionality = 'mutual_gap';
		suggestedAction = 'send_light_checkin';
		actionability = 0.55;
	}

	const weight = priorityWeight(input.priority);
	const attentionScore = clamp((1 - input.composite) * weight * confidence.score * actionability);

	return {
		version: 2,
		statusReason: {
			code,
			directionality,
			plainLanguage: reasonCopy({
				code,
				currentGapDays: currentGap,
				expectedRange: expectedGapRange,
				frequencyDrop: freqDrop,
			}),
			suggestedAction,
			privacyLevel: 'aggregate_only',
		},
		cadence: {
			currentGapDays: currentGap === null ? null : Math.round(currentGap * 10) / 10,
			expectedGapDays,
			expectedGapRange,
			historyDays: Math.round(cadence?.historyDays ?? 0),
			p75GapDays: toFiniteNumber(cadence?.p75GapDays),
			p90GapDays: toFiniteNumber(cadence?.p90GapDays),
			sessionCount: cadence?.sessionCount ?? 0,
		},
		attention: {
			score: Math.round(attentionScore * 1000) / 1000,
			priorityWeight: weight,
			actionability,
		},
		confidence,
		sourceCoverage: {
			directChat: input.totalMessages > 0,
			groupSignals: false,
			sparse: confidence.label === 'low',
		},
	};
}

function labelWithInsight(baseLabel: string, insight: HealthScoringInsight): string {
	if (insight.statusReason.code === 'learning') return 'learning';
	if (insight.statusReason.code === 'steady_low_touch') return 'steady_low_touch';
	if (insight.statusReason.code === 'needs_reply' && baseLabel === 'thriving') return 'healthy';
	return baseLabel;
}

type HealthScoringInsightWithFeedback = HealthScoringInsight & {
	aiSignals?: RelationshipHealthAiSignals;
	feedback?: {
		action: string;
		reason: string;
		snoozedUntil: string | null;
	};
};

function applyContactHealthFeedback(
	insight: HealthScoringInsight,
	feedback?: ContactHealthFeedbackRow,
): HealthScoringInsightWithFeedback {
	if (!feedback) return insight;

	const feedbackMeta = {
		action: feedback.action,
		reason: feedback.reason,
		snoozedUntil: feedback.snoozedUntil ? feedback.snoozedUntil.toISOString() : null,
	};

	if (feedback.action === 'mark_low_touch') {
		return {
			...insight,
			statusReason: {
				code: 'steady_low_touch',
				directionality: 'low_touch',
				plainLanguage: 'Marked as normal low-touch by you.',
				suggestedAction: 'none',
				privacyLevel: 'aggregate_only',
			},
			attention: {
				...insight.attention,
				score: 0,
				actionability: 0,
			},
			confidence: {
				...insight.confidence,
				reasons: [...insight.confidence.reasons, 'user calibration'],
			},
			feedback: feedbackMeta,
		};
	}

	if (
		feedback.action === 'handled_elsewhere' ||
		feedback.action === 'not_important' ||
		feedback.action === 'dismiss_wrong' ||
		feedback.action === 'snooze'
	) {
		return {
			...insight,
			statusReason: {
				...insight.statusReason,
				suggestedAction: 'none',
			},
			attention: {
				...insight.attention,
				score: 0,
				actionability: 0,
			},
			feedback: feedbackMeta,
		};
	}

	return { ...insight, feedback: feedbackMeta };
}

function resolveLocalHealthAiContactLimit(env: Record<string, string | undefined> = process.env) {
	const raw = env.HEALTH_SCORING_LOCAL_AI_CONTACT_LIMIT?.trim();
	if (!raw) return 12;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) return 0;
	return Math.min(50, Math.trunc(parsed));
}

function jobEnvelope(
	keyEnvelope: HealthScoringJobData['keyEnvelope'] | undefined,
): SealedEnvelope | null {
	if (!keyEnvelope) return null;
	return {
		encryptedWrk: Buffer.from(keyEnvelope.encryptedWrk, 'base64'),
		kmsContext: keyEnvelope.kmsContext,
		wrkVersion: keyEnvelope.wrkVersion,
	};
}

function shouldTryLocalRelationshipHealthAi(insight: HealthScoringInsightWithFeedback): boolean {
	if (insight.feedback) return false;
	if (insight.statusReason.code === 'learning') return false;
	if (insight.statusReason.code === 'steady_low_touch') return false;
	return (
		insight.statusReason.suggestedAction !== 'none' ||
		insight.statusReason.code === 'gap_longer_than_usual' ||
		insight.statusReason.code === 'frequency_drop' ||
		insight.statusReason.code === 'mutual_gap' ||
		insight.statusReason.code === 'needs_reply'
	);
}

function applyRelationshipHealthAiSignals(
	insight: HealthScoringInsightWithFeedback,
	signals: RelationshipHealthAiSignals | undefined,
): HealthScoringInsightWithFeedback {
	if (!signals) return insight;

	const next: HealthScoringInsightWithFeedback = {
		...insight,
		aiSignals: signals,
	};

	if (
		signals.directAsk.userOwesReply &&
		signals.directAsk.confidence >= 0.7 &&
		(next.cadence.currentGapDays ?? Number.POSITIVE_INFINITY) <= RECENT_UNANSWERED_REPLY_DAYS
	) {
		return {
			...next,
			statusReason: {
				code: 'needs_reply',
				directionality: 'user_owes',
				plainLanguage:
					'Local analysis found a likely direct ask in recent 1:1 context; Gordian does not see a later user reply in that window.',
				suggestedAction: 'open_chat',
				privacyLevel: 'aggregate_only',
			},
			attention: {
				...next.attention,
				actionability: Math.max(next.attention.actionability, 0.9),
				score: Math.max(next.attention.score, 0.65),
			},
			confidence: {
				...next.confidence,
				score: Math.max(next.confidence.score, signals.directAsk.confidence),
				label:
					Math.max(next.confidence.score, signals.directAsk.confidence) >= 0.75
						? 'high'
						: next.confidence.label,
				reasons: [...new Set([...next.confidence.reasons, 'local relationship classifier'])],
			},
		};
	}

	return {
		...next,
		confidence: {
			...next.confidence,
			reasons: [...new Set([...next.confidence.reasons, 'local relationship classifier'])],
		},
	};
}

// ─── Worker ──────────────────────────────────────────────────────────────────

const short = (id: string) => id.slice(0, 8);

export const healthScoringWorker = new Worker<HealthScoringJobData>(
	'health-scoring',
	withRLS(async (job) => {
		const { workspaceId } = job.data;
		console.log(`[health-scoring] Computing scores for workspace=${short(workspaceId)}`);

		// 1. Get all contacts in the workspace
		const allContacts = await db
			.select({ id: contacts.id })
			.from(contacts)
			.where(eq(contacts.workspaceId, workspaceId));

		if (allContacts.length === 0) {
			console.log(`[health-scoring] No contacts found for workspace=${short(workspaceId)}`);
			return;
		}

		const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

		// 2. Aggregate message stats per contact in a single query
		const messageStats = await db
			.select({
				contactId: messages.contactId,
				totalMessages: sql<number>`count(${messages.id})`,
				recentMessages: sql<number>`count(CASE WHEN ${messages.sentAt} >= ${thirtyDaysAgo}::timestamptz THEN 1 END)`,
				lastMessageAt: sql<string | null>`max(${messages.sentAt})`,
				lastIsOutgoing: sql<
					boolean | null
				>`(array_agg(${messages.isOutgoing} ORDER BY ${messages.sentAt} DESC))[1]`,
				outgoingCount: sql<number>`count(CASE WHEN ${messages.isOutgoing} = true THEN 1 END)`,
				incomingCount: sql<number>`count(CASE WHEN ${messages.isOutgoing} = false THEN 1 END)`,
			})
			.from(messages)
			.where(eq(messages.workspaceId, workspaceId))
			.groupBy(messages.contactId);

		// 3. Aggregate commitment stats per contact
		const commitmentStats = await db
			.select({
				contactId: commitments.contactId,
				totalCommitments: sql<number>`count(${commitments.id})`,
				completedCommitments: sql<number>`count(CASE WHEN ${commitments.status} = 'completed' THEN 1 END)`,
			})
			.from(commitments)
			.where(eq(commitments.workspaceId, workspaceId))
			.groupBy(commitments.contactId);

		// 4. Batch-fetch contact tags (H1: relationship type for decay lambda)
		const allTags = await db
			.select({
				contactId: contactTags.contactId,
				priority: contactTags.priority,
				relationship: contactTags.relationship,
			})
			.from(contactTags)
			.where(eq(contactTags.workspaceId, workspaceId));

		// 5. Batch-fetch existing health scores (H2: eliminates N+1 getHealthScore calls)
		const existingScores = await getHealthScoresByWorkspace(workspaceId, { limit: 100000 });
		const activeFeedback = await getActiveContactHealthFeedback(
			workspaceId,
			allContacts.map((contact) => contact.id),
		);

		// 6. Response latency: median hours between incoming→outgoing pairs (H4, 30-day window)
		const latencyStats = (await db.execute(sql`
			WITH ordered AS (
				SELECT contact_id, is_outgoing, sent_at,
					LAG(sent_at) OVER (PARTITION BY contact_id ORDER BY sent_at) AS prev_sent_at,
					LAG(is_outgoing) OVER (PARTITION BY contact_id ORDER BY sent_at) AS prev_outgoing
				FROM messages
				WHERE workspace_id = ${workspaceId}
				  AND sent_at >= ${thirtyDaysAgo}::timestamptz
				  AND contact_id IS NOT NULL
			),
			response_pairs AS (
				SELECT contact_id,
					EXTRACT(EPOCH FROM (sent_at - prev_sent_at)) / 3600.0 AS response_hours
				FROM ordered
				WHERE is_outgoing = true AND prev_outgoing = false AND prev_sent_at IS NOT NULL
			)
			SELECT contact_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY response_hours) AS median_hours
			FROM response_pairs
			GROUP BY contact_id
		`)) as unknown as Array<{ contact_id: string; median_hours: number | null }>;

		// 7. Cadence stats: aggregate-only interaction day gaps, no message text.
		const cadenceStats = (await db.execute(sql`
			WITH interaction_days AS (
				SELECT
					contact_id,
					date_trunc('day', sent_at) AS interaction_day
				FROM messages
				WHERE workspace_id = ${workspaceId}
					AND contact_id IS NOT NULL
				GROUP BY contact_id, date_trunc('day', sent_at)
			),
			gaps AS (
				SELECT
					contact_id,
					EXTRACT(EPOCH FROM (
						interaction_day - LAG(interaction_day) OVER (
							PARTITION BY contact_id ORDER BY interaction_day
						)
					)) / 86400.0 AS gap_days
				FROM interaction_days
			),
			day_stats AS (
				SELECT
					contact_id,
					count(*)::int AS session_count,
					EXTRACT(EPOCH FROM (max(interaction_day) - min(interaction_day))) / 86400.0 AS history_days,
					max(interaction_day) AS last_interaction_at,
					count(*) FILTER (
						WHERE interaction_day >= now() - interval '28 days'
					)::int AS recent_sessions,
					count(*) FILTER (
						WHERE interaction_day >= now() - interval '118 days'
							AND interaction_day < now() - interval '28 days'
					)::int AS baseline_sessions
				FROM interaction_days
				GROUP BY contact_id
			),
			gap_stats AS (
				SELECT
					contact_id,
					percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_days) AS median_gap_days,
					percentile_cont(0.75) WITHIN GROUP (ORDER BY gap_days) AS p75_gap_days,
					percentile_cont(0.9) WITHIN GROUP (ORDER BY gap_days) AS p90_gap_days
				FROM gaps
				WHERE gap_days IS NOT NULL
				GROUP BY contact_id
			)
			SELECT
				day_stats.contact_id,
				day_stats.session_count,
				day_stats.history_days,
				day_stats.last_interaction_at,
				day_stats.recent_sessions,
				day_stats.baseline_sessions,
				gap_stats.median_gap_days,
				gap_stats.p75_gap_days,
				gap_stats.p90_gap_days
			FROM day_stats
			LEFT JOIN gap_stats ON gap_stats.contact_id = day_stats.contact_id
		`)) as unknown as Array<{
			baseline_sessions: number | string | null;
			contact_id: string;
			history_days: number | string | null;
			last_interaction_at: string | null;
			median_gap_days: number | string | null;
			p75_gap_days: number | string | null;
			p90_gap_days: number | string | null;
			recent_sessions: number | string | null;
			session_count: number | string | null;
		}>;

		// 8. Relationship types per contact (H3: for Gaussian frequency center lookup)
		const relTypes = await db
			.select({
				contactId: contactRelationships.sourceContactId,
				relationshipType: contactRelationships.relationshipType,
			})
			.from(contactRelationships)
			.where(eq(contactRelationships.workspaceId, workspaceId));

		// Build lookup maps
		const msgMap = new Map(messageStats.map((r) => [r.contactId, r]));
		const commitMap = new Map(commitmentStats.map((r) => [r.contactId, r]));
		const tagMap = new Map(allTags.map((r) => [r.contactId, r]));
		const scoreMap = new Map(existingScores.map((r) => [r.contactId, r]));
		const feedbackMap = new Map<string, ContactHealthFeedbackRow>();
		for (const feedback of activeFeedback) {
			if (!feedbackMap.has(feedback.contactId)) feedbackMap.set(feedback.contactId, feedback);
		}
		const latencyMap = new Map(latencyStats.map((r) => [r.contact_id, r.median_hours]));
		const cadenceMap = new Map(
			cadenceStats.map((r) => [
				r.contact_id,
				{
					baselineSessions: Number(r.baseline_sessions ?? 0),
					historyDays: Number(r.history_days ?? 0),
					lastInteractionAt: r.last_interaction_at,
					medianGapDays: toFiniteNumber(r.median_gap_days),
					p75GapDays: toFiniteNumber(r.p75_gap_days),
					p90GapDays: toFiniteNumber(r.p90_gap_days),
					recentSessions: Number(r.recent_sessions ?? 0),
					sessionCount: Number(r.session_count ?? 0),
				} satisfies ContactCadenceStats,
			]),
		);
		const relTypeMap = new Map(relTypes.map((r) => [r.contactId, r.relationshipType]));

		const localAiEnvelope = jobEnvelope(job.data.keyEnvelope);
		const localAiContactLimit = resolveLocalHealthAiContactLimit();
		const localAiConsentGranted =
			localAiEnvelope && localAiContactLimit > 0
				? await hasWorkspaceAiAnalysisConsent(workspaceId).catch(() => false)
				: false;
		const localAiEnabled =
			Boolean(localAiEnvelope) &&
			localAiContactLimit > 0 &&
			localAiConsentGranted &&
			canRunLocalRelationshipHealthAnalysis();
		let localAiRemaining = localAiEnabled ? localAiContactLimit : 0;

		const now = Date.now();
		let scored = 0;
		const transitions: LabelTransition[] = [];

		for (const contact of allContacts) {
			const msgs = msgMap.get(contact.id);
			const comms = commitMap.get(contact.id);

			// --- Message-derived metrics ---
			const totalMessages = msgs?.totalMessages ?? 0;
			const recentMessages = msgs?.recentMessages ?? 0;
			const outgoing = msgs?.outgoingCount ?? 0;
			const incoming = msgs?.incomingCount ?? 0;
			const total = outgoing + incoming;

			const daysSinceLast = msgs?.lastMessageAt
				? (now - new Date(msgs.lastMessageAt).getTime()) / (1000 * 60 * 60 * 24)
				: null;

			const messagesPerWeek = recentMessages / 4.33;

			// --- Commitment metrics ---
			const totalCommits = comms?.totalCommitments ?? 0;
			const completedCommits = comms?.completedCommitments ?? 0;

			// --- Response latency (H4) ---
			const medianResponseHours = latencyMap.get(contact.id) ?? null;

			// --- Compute dimensions ---
			const tag = tagMap.get(contact.id);
			const relationship = tag?.relationship ?? relTypeMap.get(contact.id) ?? null;
			const recency = computeRecency(daysSinceLast, relationship, totalMessages);
			const frequency = computeFrequency(messagesPerWeek, relationship);
			const fulfillment = computeFulfillment(completedCommits, totalCommits);
			const responseLatency = computeResponseLatency(medianResponseHours);
			// Reciprocity: how balanced the conversation is (1 = perfectly balanced)
			const reciprocity = total > 0 ? 1 - Math.abs(outgoing - incoming) / total : 0;
			// Depth: sigmoid based on total message count (saturates at ~50+ msgs)
			const depth = 1 / (1 + Math.exp(-0.05 * (totalMessages - 10)));

			// --- Composite (H7: redistributed weights) ---
			let composite =
				recency * WEIGHTS.recency +
				frequency * WEIGHTS.frequency +
				responseLatency * WEIGHTS.responseLatency +
				depth * WEIGHTS.depth;

			// H6: Dormancy floor — deep relationships never fully dormant
			if (totalMessages >= 50) {
				composite = Math.max(composite, 0.2);
			}

			// --- Trend (requires previous score) ---
			const previous = scoreMap.get(contact.id) ?? null;
			const trend = computeTrend(composite, previous?.composite ?? null);
			const baseLabel = computeLabel(composite);
			const insight = applyContactHealthFeedback(
				buildHealthScoringInsight({
					baseLabel,
					cadence: cadenceMap.get(contact.id) ?? null,
					composite,
					daysSinceLast,
					incoming,
					lastIsOutgoing: msgs?.lastIsOutgoing ?? null,
					medianResponseHours,
					outgoing,
					priority: tag?.priority as ContactPriority,
					recentMessages,
					relationshipType: relationship,
					totalMessages,
				}),
				feedbackMap.get(contact.id),
			);
			let enrichedInsight = insight;
			if (
				localAiEnvelope &&
				localAiRemaining > 0 &&
				shouldTryLocalRelationshipHealthAi(enrichedInsight)
			) {
				localAiRemaining -= 1;
				try {
					const recent = await getMessagesByContact(workspaceId, contact.id, localAiEnvelope, {
						limit: 12,
					});
					const signals = await analyzeRelationshipHealthLocal(
						recent
							.filter((message) => typeof message.text === 'string' && message.text.trim())
							.map((message) => ({
								content: message.text as string,
								isOutgoing: message.isOutgoing,
								sentAt: message.sentAt,
							})),
					);
					enrichedInsight = applyRelationshipHealthAiSignals(enrichedInsight, signals);
				} catch {
					console.warn(
						`[health-scoring] Local relationship classifier skipped for contact=${short(contact.id)}`,
					);
				}
			}
			const label = labelWithInsight(baseLabel, enrichedInsight);

			await upsertHealthScore(workspaceId, {
				contactId: contact.id,
				recency,
				frequency,
				fulfillment,
				responsiveness: responseLatency,
				reciprocity,
				depth,
				composite,
				label,
				trend,
				previousComposite: previous?.composite ?? null,
				computationData: {
					totalMessages,
					recentMessages,
					messagesPerWeek,
					daysSinceLast,
					outgoing,
					incoming,
					totalCommits,
					completedCommits,
					medianResponseHours,
					relationshipType: relationship,
					...enrichedInsight,
				},
			});

			// Ghosting alert: detect downward transitions to cooling/dormant
			if (isGhostingTransition(previous?.label, label)) {
				transitions.push({
					contactId: contact.id,
					previousLabel: previous?.label ?? '',
					newLabel: label,
					composite,
				});
			}

			// Outcome hook (Phase 35): record relationship health outcome when trend changes
			// Only fired on trend transitions to avoid flooding outcomes table.
			if (trend !== 'stable' && trend !== (previous?.trend ?? 'stable')) {
				try {
					await enqueueRelationshipEvaluation(workspaceId, contact.id);
				} catch {}
			}

			scored++;
		}

		// Broadcast ghosting alerts for contacts that just transitioned to cooling/dormant
		if (transitions.length > 0) {
			try {
				await broadcastUpdate(workspaceId, 'ghosting-alerts', {
					contacts: transitions.map((t) => ({
						contactId: t.contactId,
						previousLabel: t.previousLabel,
						newLabel: t.newLabel,
						composite: t.composite,
					})),
					generatedAt: new Date().toISOString(),
				});
				console.log(
					`[health-scoring] Broadcast ${transitions.length} ghosting alerts for workspace=${short(workspaceId)}`,
				);
			} catch (err) {
				console.error(
					'[health-scoring] Failed to broadcast ghosting alerts:',
					(err as Error).message,
				);
			}
		}

		console.log(
			`[health-scoring] Scored ${scored}/${allContacts.length} contacts for workspace=${short(workspaceId)}`,
		);
	}),
	{
		connection,
		prefix: '{ai-flow}',
		concurrency: 2,
	},
);

healthScoringWorker.on('completed', (job) => {
	console.log(`[health-scoring] Job ${job.id} completed`);
});

healthScoringWorker.on('failed', (job, err) => {
	console.error(`[health-scoring] Job ${job?.id} failed:`, err.message);
});

// ─── Open-time refresh (DragonflyDB-safe) ─────────────────────────────────────

let healthScoringInterval: ReturnType<typeof setInterval> | null = null;

/** Queue health scoring when the local worker starts; interval is fallback only. */
export function scheduleHealthScoring(): void {
	queueHealthScoringForAllWorkspaces({ force: true, reason: 'worker_startup' }).catch((err) => {
		console.error('[health-scoring] Failed to queue initial scoring:', (err as Error).message);
	});

	// A local laptop can sleep or close; correctness comes from startup, dashboard,
	// and import triggers. This interval is a best-effort fallback while the app stays open.
	healthScoringInterval = setInterval(
		async () => {
			try {
				await queueHealthScoringForAllWorkspaces({ reason: 'open_app_fallback' });
			} catch (err) {
				console.error('[health-scoring] Failed to queue fallback scoring:', (err as Error).message);
			}
		},
		24 * 60 * 60 * 1000,
	);
}

/** Stop the health scoring interval for graceful shutdown */
export function stopHealthScoring(): void {
	if (healthScoringInterval) {
		clearInterval(healthScoringInterval);
		healthScoringInterval = null;
	}
}
