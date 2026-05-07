import {
	commitments,
	contactRelationships,
	contactTags,
	contacts,
	db,
	eq,
	getHealthScoresByWorkspace,
	messages,
	sql,
	upsertHealthScore,
} from '@repo/db';
import { Queue, Worker } from 'bullmq';
import { withRLS } from '../middleware/rls';
import { broadcastUpdate } from '../realtime/broadcast';
import { connection } from '../redis';
import { enqueueRelationshipEvaluation } from './outcome-evaluation';

// ─── Weights ────────────────────────────────────────────────────────────────

const WEIGHTS = {
	recency: 0.3,
	frequency: 0.25,
	responseLatency: 0.25,
	depth: 0.2,
} as const;

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
	return Math.exp(-lambda * daysSinceLastMessage);
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
	return Math.exp(-0.5 * z * z);
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
	return 1 / (1 + Math.exp(k * (medianResponseHours - L50)));
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
	cooling: 1,
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

// ─── Queue ───────────────────────────────────────────────────────────────────

export interface HealthScoringJobData {
	workspaceId: string;
}

export const healthScoringQueue = new Queue<HealthScoringJobData>('health-scoring', {
	connection,
	prefix: '{ai-flow}',
	defaultJobOptions: {
		attempts: 2,
		backoff: { type: 'exponential', delay: 10000 },
		removeOnComplete: { count: 100 },
		removeOnFail: { count: 500 },
	},
});

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
			.select({ contactId: contactTags.contactId, relationship: contactTags.relationship })
			.from(contactTags)
			.where(eq(contactTags.workspaceId, workspaceId));

		// 5. Batch-fetch existing health scores (H2: eliminates N+1 getHealthScore calls)
		const existingScores = await getHealthScoresByWorkspace(workspaceId, { limit: 100000 });

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

		// 7. Relationship types per contact (H3: for Gaussian frequency center lookup)
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
		const tagMap = new Map(allTags.map((r) => [r.contactId, r.relationship]));
		const scoreMap = new Map(existingScores.map((r) => [r.contactId, r]));
		const latencyMap = new Map(latencyStats.map((r) => [r.contact_id, r.median_hours]));
		const relTypeMap = new Map(relTypes.map((r) => [r.contactId, r.relationshipType]));

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
			const relationship = tagMap.get(contact.id) ?? relTypeMap.get(contact.id) ?? null;
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

			await upsertHealthScore(workspaceId, {
				contactId: contact.id,
				recency,
				frequency,
				fulfillment,
				responsiveness: responseLatency,
				reciprocity,
				depth,
				composite,
				label: computeLabel(composite),
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
				},
			});

			// Ghosting alert: detect downward transitions to cooling/dormant
			const newLabel = computeLabel(composite);
			if (isGhostingTransition(previous?.label, newLabel)) {
				transitions.push({
					contactId: contact.id,
					previousLabel: previous?.label ?? '',
					newLabel,
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

// ─── Scheduled interval (DragonflyDB-safe) ───────────────────────────────────

let healthScoringInterval: ReturnType<typeof setInterval> | null = null;

/** Queue health scoring for all workspaces (used on startup and nightly) */
async function queueHealthScoringForAllWorkspaces(): Promise<void> {
	const { workspaces } = await import('@repo/db');
	const allWorkspaces = await db.select({ id: workspaces.id }).from(workspaces);
	for (const ws of allWorkspaces) {
		await healthScoringQueue.add('compute', { workspaceId: ws.id });
	}
	console.log(`[health-scoring] Queued scoring for ${allWorkspaces.length} workspaces`);
}

/** Schedule nightly health scoring for all workspaces (runs immediately on first call) */
export function scheduleHealthScoring(): void {
	// Run immediately on startup so scores are fresh without waiting 24h
	queueHealthScoringForAllWorkspaces().catch((err) => {
		console.error('[health-scoring] Failed to queue initial scoring:', (err as Error).message);
	});

	healthScoringInterval = setInterval(
		async () => {
			try {
				await queueHealthScoringForAllWorkspaces();
			} catch (err) {
				console.error('[health-scoring] Failed to queue nightly scoring:', (err as Error).message);
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
