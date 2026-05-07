import { type SealedEnvelope, getCurrentKeys, maskEntities, withKeys } from '@repo/crypto';
import {
	createGoalAction,
	db,
	eq,
	getGoal,
	getHealthScore,
	listContactIdsByKnowledge,
	listGoalActions,
	listGoalProgressEvents,
	searchKnowledgeNodes,
	workspaces,
} from '@repo/db';
import { Queue, Worker } from 'bullmq';
import { generateEmbedding } from '../ai/embeddings';
import {
	type DecompositionContext,
	computePaceScore,
	decomposeGoal,
	needsReplanning,
} from '../ai/goal-decomposition';
import { prefilterEntities } from '../ai/prefilter';
import { trackWorkerEvent as trackAnalyticsEvent } from '../lib/track';
import { withRLS } from '../middleware/rls';
import { connection } from '../redis';

// ─── Queue ────────────────────────────────────────────────────────────────────

export const goalDecompositionQueue = new Queue('goal-decomposition', {
	connection,
	prefix: '{ai-flow}',
});

/** Resolve the workspace encryption envelope from DB — never from job payload (SEC-028) */
async function getWorkspaceEnvelope(workspaceId: string): Promise<SealedEnvelope | null> {
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

interface GoalDecompositionJobData {
	goalId: string;
	workspaceId: string;
	/** 'initial' for new goals, 'replan' for pace-triggered re-evaluation */
	trigger: 'initial' | 'replan';
}

/**
 * Schedule goal decomposition for a goal.
 * Called when a goal is confirmed (initial) or pace drops below threshold (replan).
 * Deduplicates by goalId to avoid concurrent decomposition of the same goal.
 */
export async function scheduleGoalDecomposition(
	goalId: string,
	workspaceId: string,
	trigger: 'initial' | 'replan' = 'initial',
): Promise<void> {
	await goalDecompositionQueue.add(
		'decompose',
		{ goalId, workspaceId, trigger },
		{ jobId: `decompose-${goalId}-${trigger}` },
	);
}

// ─── Worker ───────────────────────────────────────────────────────────────────

const MAX_CONTACTS = 5;
const MAX_KG_NODES = 10;
const MAX_PROGRESS_EVENTS = 3;

export const goalDecompositionWorker = new Worker(
	'goal-decomposition',
	withRLS(async (job) => {
		const { goalId, workspaceId, trigger } = job.data as GoalDecompositionJobData;

		console.log(
			`[goal-decomposition] Starting ${trigger} decomposition for goal=${goalId.slice(0, 8)} workspace=${workspaceId.slice(0, 8)}`,
		);

		// 1. Resolve workspace envelope from DB (SEC-028)
		const envelope = await getWorkspaceEnvelope(workspaceId);
		if (!envelope) {
			console.log(
				`[goal-decomposition] No envelope for workspace=${workspaceId.slice(0, 8)}, skipping`,
			);
			return;
		}

		// 2. Fetch goal (decrypted via withKeys)
		const goal = await getGoal(workspaceId, goalId, envelope);
		if (!goal) {
			console.log(`[goal-decomposition] Goal ${goalId.slice(0, 8)} not found, skipping`);
			return;
		}

		if (goal.status !== 'active') {
			console.log(`[goal-decomposition] Goal ${goalId.slice(0, 8)} is ${goal.status}, skipping`);
			return;
		}

		// 3. For replan: check if existing actions need clearing
		if (trigger === 'replan') {
			const existingActions = await listGoalActions(workspaceId, goalId, envelope);
			const pendingCount = existingActions.filter((a) => a.status === 'pending').length;
			if (pendingCount === 0) {
				console.log('[goal-decomposition] No pending actions to replan, skipping');
				return;
			}
		}

		// 4. Compute pace score
		const { score: paceScore, label: paceLabel } = computePaceScore(goal);

		// For replan trigger, verify pace actually warrants replanning
		if (trigger === 'replan' && !needsReplanning(paceScore)) {
			console.log(
				`[goal-decomposition] Pace ${paceScore?.toFixed(2)} doesn't warrant replan, skipping`,
			);
			return;
		}

		// 5. Gather context: KG triplets + contact fits + progress events
		const context = await gatherDecompositionContext(
			workspaceId,
			goal,
			paceScore,
			paceLabel,
			envelope,
		);

		// 6. Call LLM for decomposition
		const result = await decomposeGoal(context);

		if (result.actions.length === 0) {
			console.log('[goal-decomposition] LLM returned no actions');
			return { stored: 0 };
		}

		console.log(`[goal-decomposition] Got ${result.actions.length} actions, storing...`);

		// 7. Store actions via DAL (JIT: all at once for now — JIT single-action is a UX concern)
		let stored = 0;
		for (const action of result.actions) {
			await createGoalAction(
				workspaceId,
				{
					goalId,
					title: action.title,
					description: action.description,
					contactId: action.suggestedContactId ?? undefined,
					actionType: action.actionType,
					domainTag: action.domainTag,
					effort: action.effort,
				},
				envelope,
			);
			stored++;
		}

		trackAnalyticsEvent(workspaceId, '', 'goal.decomposed', {
			goal_id: goalId,
			trigger,
			action_count: stored,
			pace_score: paceScore,
		});

		console.log(
			`[goal-decomposition] Stored ${stored} actions for goal=${goalId.slice(0, 8)} (trigger=${trigger})`,
		);

		return { stored, reasoning: result.reasoning };
	}),
	{ connection, prefix: '{ai-flow}', concurrency: 2 },
);

goalDecompositionWorker.on('completed', (job) => {
	console.log(`[goal-decomposition] Job ${job.id} completed`);
});
goalDecompositionWorker.on('failed', (job, err) => {
	console.error(`[goal-decomposition] Job ${job?.id} failed:`, err.message);
});

// ─── Context Gathering ────────────────────────────────────────────────────────

/**
 * Build the full DecompositionContext for the LLM.
 * Uses KG triplets (GraphRAG) for context injection, NOT raw messages.
 * All text is ELM-masked before it reaches the prompt.
 */
async function gatherDecompositionContext(
	workspaceId: string,
	goal: {
		id: string;
		title: string;
		type: string;
		currentCount: number;
		targetCount: number;
		targetDate: Date | string | null;
		createdAt: Date | string;
	},
	paceScore: number | null,
	paceLabel: string,
	envelope: SealedEnvelope,
): Promise<DecompositionContext> {
	// ELM-mask goal title for the LLM prompt
	const maskedGoalTitle = await withKeys(envelope, async () => {
		const keys = getCurrentKeys();
		const detected = prefilterEntities(goal.title);
		const { maskedText } = maskEntities(goal.title, keys.bik, detected);
		return maskedText;
	});

	// Generate embedding from masked title for KG search
	const titleEmbedding = await generateEmbedding(maskedGoalTitle);

	// Parallel: KG nodes + progress events
	const [kgNodes, progressEvents] = await Promise.all([
		searchKnowledgeNodes(workspaceId, '', titleEmbedding, envelope).catch(() => []),
		listGoalProgressEvents(workspaceId, goal.id, { limit: MAX_PROGRESS_EVENTS }).catch(() => []),
	]);

	// Build KG triplets (already decrypted by searchKnowledgeNodes via envelope)
	const kgTriplets = kgNodes.slice(0, MAX_KG_NODES).map((node) => ({
		nodeType: node.type,
		displayName: node.displayName,
		description: node.description,
	}));

	// Find contacts linked to relevant KG nodes
	const contactFits = await findContactFits(workspaceId, kgNodes.slice(0, MAX_KG_NODES));

	return {
		goalTitle: maskedGoalTitle,
		goalType: goal.type,
		paceScore,
		paceLabel,
		contactFits,
		kgTriplets,
		progressEvents: progressEvents.map((e) => ({
			delta: e.delta,
			source: e.source,
			createdAt: new Date(e.createdAt).toISOString(),
		})),
	};
}

/**
 * Find top contacts relevant to a goal via KG node links + health scores.
 * Returns masked display names (no PII in prompt).
 */
async function findContactFits(
	workspaceId: string,
	kgNodes: Array<{ id: string; displayName: string; type: string; similarity: number }>,
): Promise<DecompositionContext['contactFits']> {
	const contactMap = new Map<string, { matchReasons: string[]; bestSimilarity: number }>();

	for (const node of kgNodes) {
		if (node.similarity < 0.3) continue;
		try {
			const contactIds = await listContactIdsByKnowledge(node.id, workspaceId);
			for (const contactId of contactIds) {
				const existing = contactMap.get(contactId);
				if (existing) {
					existing.matchReasons.push(`${node.type}:${node.displayName}`);
					existing.bestSimilarity = Math.max(existing.bestSimilarity, node.similarity);
				} else {
					contactMap.set(contactId, {
						matchReasons: [`${node.type}:${node.displayName}`],
						bestSimilarity: node.similarity,
					});
				}
			}
		} catch {
			// Per-node errors are non-fatal
		}
	}

	// Sort by best similarity, take top N
	const ranked = [...contactMap.entries()]
		.sort((a, b) => b[1].bestSimilarity - a[1].bestSimilarity)
		.slice(0, MAX_CONTACTS);

	// Fetch health labels
	const fits: DecompositionContext['contactFits'] = [];
	for (const [contactId, data] of ranked) {
		let healthLabel = 'unknown';
		try {
			const health = await getHealthScore(workspaceId, contactId);
			if (health) healthLabel = health.label;
		} catch {
			// Health score lookup is non-fatal
		}

		fits.push({
			contactId,
			displayName: contactId.slice(0, 8), // UUID prefix — no PII
			matchReason: data.matchReasons.slice(0, 3).join(', '),
			healthLabel,
		});
	}

	return fits;
}
