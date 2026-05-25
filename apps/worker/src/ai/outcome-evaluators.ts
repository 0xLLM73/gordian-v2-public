import type { SealedEnvelope } from '@repo/crypto';
import {
	and,
	commitments,
	createEdge,
	createKnowledgeLink,
	createKnowledgeNode,
	createOutcome,
	db,
	deals,
	eq,
	findDecisionByEntityId,
	findEdgesByTargetDecision,
	getHealthScore,
	goals,
	hasRecentOutcome,
	introductions,
	sql,
	updateEdgeWeight,
	workspaces,
} from '@repo/db';
import { generateEmbedding } from './embeddings';

const OUTCOME_SCORING_ENABLED = process.env.FEATURE_OUTCOME_SCORING === 'true';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function featureDisabled(name: string): null {
	console.log(`[outcome-evaluators] ${name}: feature disabled (FEATURE_OUTCOME_SCORING not set)`);
	return null;
}

/**
 * SEC-ENC-104: Resolve envelope from DB for callers that don't have one.
 * Outcome evaluators operate on non-PII fields but need encryption context
 * for knowledge graph writes (encryptedText columns).
 */
async function resolveWorkspaceEnvelope(workspaceId: string): Promise<SealedEnvelope | null> {
	const result = await db
		.select({
			encryptedWrk: workspaces.encryptedWrk,
			kmsContext: workspaces.kmsContext,
			wrkVersion: workspaces.wrkVersion,
		})
		.from(workspaces)
		.where(eq(workspaces.id, workspaceId))
		.limit(1);

	if (result.length === 0) return null;

	const ws = result[0];
	const rawCtx = ws.kmsContext;
	const kmsContext: Record<string, string> =
		typeof rawCtx === 'string' ? JSON.parse(rawCtx) : (rawCtx as Record<string, string>);
	return {
		encryptedWrk: Buffer.from(ws.encryptedWrk, 'base64'),
		kmsContext,
		wrkVersion: ws.wrkVersion,
	};
}

/** Bucket a deal value (in cents) into a label safe for embedding */
function valueBucket(valueCents: number): string {
	const usd = valueCents / 100;
	if (usd < 10_000) return 'sub_10k';
	if (usd < 100_000) return '10k_100k';
	if (usd < 1_000_000) return '100k_1m';
	if (usd < 10_000_000) return '1m_10m';
	return 'over_10m';
}

/** Bucket a confidence score into a label */
function confidenceBucket(score: number): string {
	if (score >= 0.85) return 'high';
	if (score >= 0.5) return 'medium';
	return 'low';
}

// ─── evaluateDeal ─────────────────────────────────────────────────────────────

/**
 * Record the outcome of a deal reaching a terminal stage (won or lost).
 *
 * Reads: stage, dealType, value, contactId — all plaintext (no envelope needed).
 * context_labels: ['deal_type:{type}', 'stage:{won|lost}', 'value_range:{bucket}']
 * result: 'positive' (won) / 'negative' (lost)
 */
export async function evaluateDeal(workspaceId: string, dealId: string): Promise<unknown> {
	if (!OUTCOME_SCORING_ENABLED) return featureDisabled('evaluateDeal');

	// Read non-PII fields only — notes column excluded to avoid envelope requirement
	const rows = await db
		.select({
			stage: deals.stage,
			dealType: deals.dealType,
			value: deals.value,
			closedAt: deals.closedAt,
			contactId: deals.contactId,
		})
		.from(deals)
		.where(and(eq(deals.id, dealId), eq(deals.workspaceId, workspaceId)))
		.limit(1);

	const deal = rows[0];
	if (!deal) {
		console.log(`[outcome-evaluators] evaluateDeal: deal ${dealId.slice(0, 8)} not found`);
		return null;
	}

	if (deal.stage !== 'won' && deal.stage !== 'lost') {
		console.log(
			`[outcome-evaluators] evaluateDeal: deal ${dealId.slice(0, 8)} not in terminal stage (${deal.stage})`,
		);
		return null;
	}

	const result = deal.stage === 'won' ? 'positive' : 'negative';
	const contextLabels = [
		`deal_type:${deal.dealType}`,
		`stage:${deal.stage}`,
		`value_range:${valueBucket(deal.value)}`,
	];

	const embedding = await generateEmbedding(contextLabels.join(' '));

	const outcome = await createOutcome(workspaceId, {
		type: 'deal_closed',
		result,
		contactId: deal.contactId ?? undefined,
		contextLabels,
		embedding,
		occurredAt: deal.closedAt ?? new Date(),
	});

	console.log(
		`[outcome-evaluators] evaluateDeal: recorded ${result} outcome for deal ${dealId.slice(0, 8)}`,
	);

	// Create backlink in the decision provenance graph
	try {
		await linkOutcomeToDecisionGraph(
			workspaceId,
			result as 'positive' | 'negative',
			dealId,
			'deal',
			contextLabels,
			embedding,
		);
	} catch (err) {
		console.error(
			'[outcome-evaluators] Failed to link deal outcome to graph:',
			(err as Error).message,
		);
	}

	return outcome;
}

// ─── evaluateCommitment ───────────────────────────────────────────────────────

/**
 * Record the outcome of a commitment reaching a terminal status (fulfilled or missed).
 *
 * Reads: commitmentType, confidence, assignee, contactId — all plaintext.
 * title and quote are encrypted and are intentionally NOT read here.
 * context_labels: ['commitment_type:{type}', 'assignee:{user|contact}', 'confidence:{bucket}']
 * type: 'commitment_fulfilled' or 'commitment_missed' (derived from result param)
 * result (OutcomeResult): 'positive' (fulfilled) / 'negative' (missed)
 */
export async function evaluateCommitment(
	workspaceId: string,
	commitmentId: string,
	result: 'fulfilled' | 'missed',
): Promise<unknown> {
	if (!OUTCOME_SCORING_ENABLED) return featureDisabled('evaluateCommitment');

	const rows = await db
		.select({
			commitmentType: commitments.commitmentType,
			confidence: commitments.confidence,
			assignee: commitments.assignee,
			fulfilledAt: commitments.fulfilledAt,
			contactId: commitments.contactId,
		})
		.from(commitments)
		.where(and(eq(commitments.id, commitmentId), eq(commitments.workspaceId, workspaceId)))
		.limit(1);

	const commitment = rows[0];
	if (!commitment) {
		console.log(
			`[outcome-evaluators] evaluateCommitment: commitment ${commitmentId.slice(0, 8)} not found`,
		);
		return null;
	}

	const outcomeType = result === 'fulfilled' ? 'commitment_fulfilled' : 'commitment_missed';
	const outcomeResult = result === 'fulfilled' ? 'positive' : 'negative';

	const contextLabels = [
		`commitment_type:${commitment.commitmentType}`,
		`assignee:${commitment.assignee}`,
		`confidence:${confidenceBucket(commitment.confidence)}`,
	];

	const embedding = await generateEmbedding(contextLabels.join(' '));

	const outcome = await createOutcome(workspaceId, {
		type: outcomeType,
		result: outcomeResult,
		contactId: commitment.contactId ?? undefined,
		contextLabels,
		embedding,
		occurredAt: commitment.fulfilledAt ?? new Date(),
	});

	console.log(
		`[outcome-evaluators] evaluateCommitment: recorded ${outcomeResult} (${outcomeType}) for commitment ${commitmentId.slice(0, 8)}`,
	);

	try {
		await linkOutcomeToDecisionGraph(
			workspaceId,
			outcomeResult,
			commitmentId,
			'commitment',
			contextLabels,
			embedding,
		);
	} catch (err) {
		console.error(
			'[outcome-evaluators] Failed to link commitment outcome to graph:',
			(err as Error).message,
		);
	}

	return outcome;
}

// ─── evaluateGoal ─────────────────────────────────────────────────────────────

/**
 * Record the outcome of a goal reaching completion.
 *
 * Reads: type, status, currentCount, targetCount, completedAt, contactId — all plaintext.
 * context_labels: ['goal_type:{type}', 'completion:{pct}pct']
 * result: 'positive' (>= 90% complete) / 'neutral' (< 90%)
 */
export async function evaluateGoal(workspaceId: string, goalId: string): Promise<unknown> {
	if (!OUTCOME_SCORING_ENABLED) return featureDisabled('evaluateGoal');

	const rows = await db
		.select({
			type: goals.type,
			status: goals.status,
			currentCount: goals.currentCount,
			targetCount: goals.targetCount,
			completedAt: goals.completedAt,
			contactId: goals.contactId,
		})
		.from(goals)
		.where(and(eq(goals.id, goalId), eq(goals.workspaceId, workspaceId)))
		.limit(1);

	const goal = rows[0];
	if (!goal) {
		console.log(`[outcome-evaluators] evaluateGoal: goal ${goalId.slice(0, 8)} not found`);
		return null;
	}

	if (goal.status !== 'completed') {
		console.log(
			`[outcome-evaluators] evaluateGoal: goal ${goalId.slice(0, 8)} not completed (${goal.status})`,
		);
		return null;
	}

	const completionPct =
		goal.targetCount > 0 ? Math.round((goal.currentCount / goal.targetCount) * 100) : 0;
	const result = completionPct >= 90 ? 'positive' : 'neutral';
	const contextLabels = [`goal_type:${goal.type}`, `completion:${completionPct}pct`];

	const embedding = await generateEmbedding(contextLabels.join(' '));

	const outcome = await createOutcome(workspaceId, {
		type: 'goal_completed',
		result,
		contactId: goal.contactId ?? undefined,
		contextLabels,
		embedding,
		occurredAt: goal.completedAt ?? new Date(),
	});

	console.log(
		`[outcome-evaluators] evaluateGoal: recorded ${result} outcome for goal ${goalId.slice(0, 8)} (${completionPct}%)`,
	);

	try {
		await linkOutcomeToDecisionGraph(workspaceId, result, goalId, 'goal', contextLabels, embedding);
	} catch (err) {
		console.error(
			'[outcome-evaluators] Failed to link goal outcome to graph:',
			(err as Error).message,
		);
	}

	return outcome;
}

// ─── evaluateIntroduction ─────────────────────────────────────────────────────

/**
 * Record the outcome of an introduction archived with a completed resolution.
 *
 * Reads: context, confidence, status, resolution, updatedAt, introducerContactId — all plaintext.
 * context_labels: ['intro_context:{context}', 'confidence:{bucket}']
 * result: 'positive' (completed introductions are considered successful)
 * contactId: the introducer (primary actor in the outcome)
 */
export async function evaluateIntroduction(
	workspaceId: string,
	introductionId: string,
): Promise<unknown> {
	if (!OUTCOME_SCORING_ENABLED) return featureDisabled('evaluateIntroduction');

	const rows = await db
		.select({
			context: introductions.context,
			confidence: introductions.confidence,
			status: introductions.status,
			resolution: introductions.resolution,
			updatedAt: introductions.updatedAt,
			introducerContactId: introductions.introducerContactId,
		})
		.from(introductions)
		.where(and(eq(introductions.id, introductionId), eq(introductions.workspaceId, workspaceId)))
		.limit(1);

	const intro = rows[0];
	if (!intro) {
		console.log(
			`[outcome-evaluators] evaluateIntroduction: intro ${introductionId.slice(0, 8)} not found`,
		);
		return null;
	}

	if (intro.status !== 'archive') {
		console.log(
			`[outcome-evaluators] evaluateIntroduction: intro ${introductionId.slice(0, 8)} not archived (${intro.status})`,
		);
		return null;
	}

	if (intro.resolution !== 'completed') {
		console.log(
			`[outcome-evaluators] evaluateIntroduction: intro ${introductionId.slice(0, 8)} archived without completed resolution (${intro.resolution ?? 'none'})`,
		);
		return null;
	}

	const contextLabels = [
		`intro_context:${intro.context}`,
		`confidence:${confidenceBucket(intro.confidence)}`,
	];

	const embedding = await generateEmbedding(contextLabels.join(' '));

	const outcome = await createOutcome(workspaceId, {
		type: 'intro_connected',
		result: 'positive',
		contactId: intro.introducerContactId ?? undefined,
		contextLabels,
		embedding,
		occurredAt: intro.updatedAt,
	});

	console.log(
		`[outcome-evaluators] evaluateIntroduction: recorded positive outcome for intro ${introductionId.slice(0, 8)}`,
	);

	try {
		await linkOutcomeToDecisionGraph(
			workspaceId,
			'positive',
			introductionId,
			'introduction',
			contextLabels,
			embedding,
		);
	} catch (err) {
		console.error(
			'[outcome-evaluators] Failed to link intro outcome to graph:',
			(err as Error).message,
		);
	}

	return outcome;
}

// ─── evaluateRelationship ─────────────────────────────────────────────────────

/**
 * Record the current health state of a relationship as an outcome.
 *
 * Unlike the other evaluators, relationship_health has no single terminal event —
 * it tracks ongoing health. A 30-day cooldown is enforced via hasRecentOutcome()
 * to prevent flooding when health-scoring runs frequently.
 *
 * Reads: composite, label, trend from contactHealthScores — all plaintext.
 * context_labels: ['trend:{improving|stable|declining}', 'label:{thriving|healthy|cooling|dormant}']
 * result (OutcomeResult): improving→positive, stable→neutral, declining→negative
 *
 * NOTE: requires migration 0028 to add 'relationship_health' to the outcome_type enum.
 */
export async function evaluateRelationship(
	workspaceId: string,
	contactId: string,
): Promise<unknown> {
	if (!OUTCOME_SCORING_ENABLED) return featureDisabled('evaluateRelationship');

	// Enforce 30-day cooldown — relationship_health is not a one-time terminal event
	const alreadyRecent = await hasRecentOutcome(workspaceId, contactId, 'relationship_health', 30);
	if (alreadyRecent) return null;

	const score = await getHealthScore(workspaceId, contactId);
	if (!score) {
		console.log(
			`[outcome-evaluators] evaluateRelationship: no health score for contact ${contactId.slice(0, 8)}`,
		);
		return null;
	}

	const outcomeResult =
		score.trend === 'improving' ? 'positive' : score.trend === 'declining' ? 'negative' : 'neutral';

	const contextLabels = [`trend:${score.trend}`, `label:${score.label}`];
	const embedding = await generateEmbedding(contextLabels.join(' '));

	const outcome = await createOutcome(workspaceId, {
		type: 'relationship_health',
		result: outcomeResult,
		contactId,
		contextLabels,
		embedding,
	});

	console.log(
		`[outcome-evaluators] evaluateRelationship: recorded ${outcomeResult} health for contact ${contactId.slice(0, 8)}`,
	);

	return outcome;
}

// ─── Outcome-to-Graph Backlink ───────────────────────────────────────────────

/**
 * Create an outcome node in the knowledge graph and link it back to the
 * decision that preceded it. Updates W_outcome on the decision's rationale edges.
 *
 * Called from outcome evaluators after createOutcome().
 * SEC-PROV-008: All joins include workspace_id.
 */
export async function linkOutcomeToDecisionGraph(
	workspaceId: string,
	outcomeResult: 'positive' | 'negative' | 'neutral',
	entityId: string | undefined,
	entityType: string,
	contextLabels: string[],
	embedding: number[],
): Promise<void> {
	if (!entityId) return;

	// SEC-ENC-104: Resolve envelope for knowledge graph writes
	const envelope = await resolveWorkspaceEnvelope(workspaceId);
	if (!envelope) {
		console.error(
			`[outcome-evaluators] No envelope for workspace=${workspaceId.slice(0, 8)}, skipping graph link`,
		);
		return;
	}

	// 1. Create an outcome node in the knowledge graph
	const roiWeight = outcomeResult === 'positive' ? 1.3 : outcomeResult === 'negative' ? 0.5 : 1.0;

	const outcomeNode = await createKnowledgeNode(
		workspaceId,
		{
			type: 'outcome',
			name: `outcome:${entityType}:${entityId}`.toLowerCase(),
			displayName: `${entityType} → ${outcomeResult}`,
			description: contextLabels.join(', '),
			embedding,
			metadata: {
				result: outcomeResult,
				roi_weight: roiWeight,
				entityId,
				entityType,
				occurredAt: new Date().toISOString(),
			},
		},
		envelope,
	);

	// 2. Find the decision node for this entity
	const decisionNodes = await db.execute(sql`
		SELECT id FROM knowledge_nodes
		WHERE workspace_id = ${workspaceId}::uuid
			AND type = 'decision'
			AND metadata->>'entityId' = ${entityId}
		ORDER BY created_at DESC
		LIMIT 1
	`);

	const decisionNodeId = (decisionNodes as unknown as Array<{ id: string }>)[0]?.id;
	if (!decisionNodeId) return;

	// 3. Link: Decision --led_to--> Outcome
	await createKnowledgeLink(workspaceId, decisionNodeId, outcomeNode.id, 'led_to', roiWeight);

	// 4. Update W_outcome on the rationale nodes cited by this decision
	const citedRationales = await db.execute(sql`
		SELECT kl.target_node_id
		FROM knowledge_links kl
		WHERE kl.source_node_id = ${decisionNodeId}::uuid
			AND kl.workspace_id = ${workspaceId}::uuid
			AND kl.link_type = 'cites'
	`);

	for (const row of citedRationales as unknown as Array<{ target_node_id: string }>) {
		// Compute rolling average roi_weight across all outcomes linked to this rationale
		const allOutcomes = await db.execute(sql`
			SELECT kn.metadata->>'roi_weight' as roi_weight
			FROM knowledge_links cite
			JOIN knowledge_links led
				ON led.source_node_id = cite.source_node_id
				AND led.link_type = 'led_to'
				AND led.workspace_id = ${workspaceId}::uuid
			JOIN knowledge_nodes kn
				ON kn.id = led.target_node_id
				AND kn.type = 'outcome'
				AND kn.workspace_id = ${workspaceId}::uuid
			WHERE cite.target_node_id = ${row.target_node_id}::uuid
				AND cite.link_type = 'cites'
				AND cite.workspace_id = ${workspaceId}::uuid
		`);

		const weights = (allOutcomes as unknown as Array<{ roi_weight: string }>)
			.map((o) => Number.parseFloat(o.roi_weight))
			.filter((w) => !Number.isNaN(w));

		if (weights.length > 0) {
			const avgWeight = weights.reduce((a, b) => a + b, 0) / weights.length;
			await db.execute(sql`
				UPDATE knowledge_nodes
				SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('avg_roi_weight', ${avgWeight})
				WHERE id = ${row.target_node_id}::uuid
					AND workspace_id = ${workspaceId}::uuid
			`);
		}
	}

	// CGC Phase 4a: Update causal edge weights based on outcome
	try {
		const decision = await findDecisionByEntityId(workspaceId, entityId);
		if (decision) {
			// Find edges pointing to this decision and adjust weights
			const edges = await findEdgesByTargetDecision(workspaceId, decision.id);
			const weightDelta =
				outcomeResult === 'positive' ? 0.1 : outcomeResult === 'negative' ? -0.1 : 0;

			for (const edge of edges) {
				if (weightDelta !== 0) {
					await updateEdgeWeight(workspaceId, edge.id, weightDelta);
				}
			}

			// Create implicit_context edges from source decisions to this decision
			// with weight based on outcome result
			const implicitWeight =
				outcomeResult === 'positive' ? 0.7 : outcomeResult === 'negative' ? 0.3 : 0.5;
			for (const edge of edges) {
				try {
					await createEdge(workspaceId, {
						sourceId: edge.sourceId,
						targetId: decision.id,
						edgeType: 'implicit_context',
						weight: implicitWeight,
						confidenceScore: 0.8,
					});
				} catch {
					// Duplicate edge — non-fatal
				}
			}

			if (edges.length > 0) {
				console.log(
					`[outcome-evaluators] Updated ${edges.length} edge weights by ${weightDelta > 0 ? '+' : ''}${weightDelta}, created ${edges.length} implicit_context edges for decision=${decision.id.slice(0, 8)}`,
				);
			}
		}
	} catch (err) {
		console.error('[outcome-evaluators] CGC edge weight update failed:', (err as Error).message);
	}
}
