import { type SealedEnvelope, getCurrentKeys, maskEntities, withKeys } from '@repo/crypto';
import {
	type CreateRecommendationItem,
	createRecommendations,
	expireOldRecommendations,
	getActiveCommitments,
	getDecliningContacts,
	getHealthScore,
	getKnowledgeNeighbors,
	getLastMessageDate,
	isFeatureEnabled,
	listContactIdsByKnowledge,
	listDeals,
	listGoals,
	listKnowledgeNodes,
	searchKnowledgeNodes,
} from '@repo/db';
import { generateEmbedding } from './embeddings';
import { prefilterEntities } from './prefilter';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addDays(days: number): Date {
	const d = new Date();
	d.setDate(d.getDate() + days);
	return d;
}

// ─── Score: Re-Engage ─────────────────────────────────────────────────────────

/**
 * Surface contacts with declining health / low recency.
 * priorityScore = (100 - recency) / 100 — higher when recency is low.
 * Reasoning: category label only, no PII.
 */
export async function scoreReEngage(workspaceId: string): Promise<CreateRecommendationItem[]> {
	const declining = await getDecliningContacts(workspaceId, { limit: 20 });
	return declining.map((score) => ({
		contactId: score.contactId,
		type: 're_engage' as const,
		priorityScore: Math.max(0, (100 - score.recency) / 100),
		reasoning: `declining_trend:recency_${Math.round(score.recency)}`,
		expiresAt: addDays(7),
	}));
}

// ─── Score: Follow-Up ─────────────────────────────────────────────────────────

/**
 * Surface contacts with the most open active commitments.
 * priorityScore = min(count / 5, 1.0).
 * Reasoning: category label only, no PII.
 */
export async function scoreFollowUp(
	workspaceId: string,
	envelope: SealedEnvelope,
): Promise<CreateRecommendationItem[]> {
	const commitments = await getActiveCommitments(workspaceId, envelope, { limit: 100 });

	const contactCounts = new Map<string, number>();
	for (const c of commitments) {
		if (c.contactId) {
			contactCounts.set(c.contactId, (contactCounts.get(c.contactId) ?? 0) + 1);
		}
	}

	const items: CreateRecommendationItem[] = [];
	for (const [contactId, count] of contactCounts) {
		items.push({
			contactId,
			type: 'follow_up',
			priorityScore: Math.min(count / 5, 1.0),
			reasoning: `open_commitments:${count}`,
			expiresAt: addDays(3),
		});
	}
	return items;
}

// ─── Score: Advance Deal ──────────────────────────────────────────────────────

const STALL_DAYS = 30;

/**
 * Surface non-terminal deals where the last stage change was ≥ 30 days ago.
 * priorityScore = min(staleDays / 90, 1.0).
 * Reasoning: category label only, no PII.
 */
export async function scoreAdvanceDeal(
	workspaceId: string,
	envelope: SealedEnvelope,
): Promise<CreateRecommendationItem[]> {
	const deals = await listDeals(workspaceId, envelope, { limit: 100 });
	const now = Date.now();

	const items: CreateRecommendationItem[] = [];
	for (const deal of deals) {
		if (deal.stage === 'won' || deal.stage === 'lost') continue;

		const history = (deal.stageHistory as Array<{ stage: string; timestamp: string }>) ?? [];
		const lastEntry = history[history.length - 1];
		const lastChangeMs = lastEntry
			? new Date(lastEntry.timestamp).getTime()
			: new Date(deal.createdAt).getTime();

		const staleDays = (now - lastChangeMs) / (24 * 60 * 60 * 1000);
		if (staleDays >= STALL_DAYS) {
			items.push({
				contactId: deal.contactId,
				type: 'advance_deal',
				priorityScore: Math.min(staleDays / 90, 1.0),
				reasoning: `stalled_deal:${Math.round(staleDays)}d:${deal.stage}`,
				expiresAt: addDays(7),
			});
		}
	}
	return items;
}

// ─── Score: Make Intro ────────────────────────────────────────────────────────

/**
 * Surface intro opportunities from shared knowledge nodes.
 * When 2+ contacts are linked to the same knowledge node, an intro may add value.
 * Emits one workspace-level item per qualifying node (no contact PII in reasoning).
 * priorityScore = min(sharedContactCount / 5, 1.0).
 */
export async function scoreMakeIntro(workspaceId: string): Promise<CreateRecommendationItem[]> {
	const nodes = await listKnowledgeNodes(workspaceId, { limit: 50 });

	const items: CreateRecommendationItem[] = [];
	for (const node of nodes) {
		try {
			const contactIds = await listContactIdsByKnowledge(node.id, workspaceId);
			if (contactIds.length >= 2) {
				items.push({
					type: 'make_intro',
					priorityScore: Math.min(contactIds.length / 5, 1.0),
					reasoning: `shared_knowledge:${node.type}:${contactIds.length}_contacts`,
					expiresAt: addDays(14),
				});
			}
		} catch {
			// Per-node errors are non-fatal
		}
	}
	// Cap at 5 intro recommendations to avoid flooding the brief
	return items.slice(0, 5);
}

// ─── Goal-to-Contact Intelligence (G7) ───────────────────────────────────────

const KNOWLEDGE_SIMILARITY_THRESHOLD = 0.3;
const MAX_SUGGESTED_CONTACTS = 3;

/**
 * Find contacts relevant to a goal by cross-referencing the goal title
 * with the knowledge graph via embedding similarity.
 *
 * Flow: mask title (ELM) → embed → searchKnowledgeNodes → listContactIdsByKnowledge
 * Returns count + knowledge context (no PII): "3 relevant contacts linked via knowledge graph (DeFi, Paradigm)."
 * or null if no relevant contacts found.
 */
export async function suggestContactsForGoal(
	workspaceId: string,
	goalTitle: string,
	envelope: SealedEnvelope,
): Promise<string | null> {
	// 1. Mask goal title via ELM and generate embedding
	const embedding = await withKeys(envelope, async () => {
		const keys = getCurrentKeys();
		const detected = prefilterEntities(goalTitle);
		const { maskedText } = maskEntities(goalTitle, keys.bik, detected);
		return generateEmbedding(maskedText);
	});

	// 2. Semantic search knowledge nodes (embedding path — no envelope needed)
	const nodes = await searchKnowledgeNodes(workspaceId, '', embedding);
	if (nodes.length === 0) return null;

	// 3. Count contacts linked to top knowledge nodes, deduplicated (no PII in output)
	const seen = new Set<string>();
	const contexts: string[] = [];

	for (const node of nodes) {
		if (node.similarity < KNOWLEDGE_SIMILARITY_THRESHOLD) break;
		if (seen.size >= MAX_SUGGESTED_CONTACTS) break;

		const contactIds = await listContactIdsByKnowledge(node.id, workspaceId);
		let added = false;
		for (const id of contactIds) {
			if (seen.has(id)) continue;
			seen.add(id);
			added = true;
			if (seen.size >= MAX_SUGGESTED_CONTACTS) break;
		}
		if (added) contexts.push(node.displayName);
	}

	if (seen.size === 0) return null;

	return `${seen.size} relevant contact${seen.size !== 1 ? 's' : ''} linked via knowledge graph (${contexts.join(', ')}).`;
}

// ─── Goal-Driven Outreach Scoring (GI3) ──────────────────────────────────────

const MAX_OUTREACH_CONTACTS = 5;
const MIN_CONFIDENT_CONTACTS = 3;
const CONFIDENCE_THRESHOLD = 0.5;
const RECENCY_FULL_DAYS = 14;
const RECENCY_DECAY_RATE = 0.05;
const W_FIT = 0.5;
const W_INTENT = 0.35;
const W_TIMING = 0.15;

/**
 * Scored contact result for goal-driven outreach.
 * All fields are safe for display — matchReason uses anonymized KG tags only, no PII.
 */
export interface OutreachContact {
	contactId: string;
	matchReason: string;
	healthStatus: string;
	lastInteraction: Date | null;
	compositeScore: number;
}

/**
 * Score a single contact for outreach. Pure computation — no PII in output.
 */
async function scoreOneContact(
	workspaceId: string,
	contactId: string,
	matchedTags: Set<string>,
	goalNodeCount: number,
	expanded: boolean,
): Promise<OutreachContact> {
	// Fit: fraction of goal-relevant nodes matched (reduced 70% for expanded contacts)
	const fitRaw = Math.min(matchedTags.size / goalNodeCount, 1.0);
	const fit = expanded ? fitRaw * 0.3 : fitRaw;

	// Intent: contact health score composite (0-100 → 0-1), fallback 0.3
	const health = await getHealthScore(workspaceId, contactId);
	const intent = health ? health.composite / 100 : 0.3;

	// Timing: recency boost (1.0 within 14d, exponential decay after)
	const lastMsg = await getLastMessageDate(workspaceId, contactId);
	let timing = 0.5;
	if (lastMsg) {
		const daysSince = (Date.now() - lastMsg.getTime()) / (24 * 60 * 60 * 1000);
		timing =
			daysSince <= RECENCY_FULL_DAYS
				? 1.0
				: Math.exp(-RECENCY_DECAY_RATE * (daysSince - RECENCY_FULL_DAYS));
	}

	const compositeScore = W_FIT * fit + W_INTENT * intent + W_TIMING * timing;
	const tagList = [...matchedTags].join(', ');
	const matchReason = expanded ? `Tagged: ${tagList}. Expanded search.` : `Tagged: ${tagList}`;

	return {
		contactId,
		matchReason,
		healthStatus: health?.label ?? 'unknown',
		lastInteraction: lastMsg,
		compositeScore,
	};
}

/**
 * Score contacts for goal-driven outreach using a Fit/Intent/Timing weighted model.
 *
 * Fit (50%): Knowledge graph tag overlap between goal entities and contact tags.
 * Intent (35%): Contact health score (Gaussian + Weibull composite, 0-100 → 0-1).
 * Timing (15%): Recency boost — 1.0 within 14 days, exponential decay after.
 *
 * Cold-start: If <3 contacts score above 0.5, traverses adjacent KG nodes
 * and badges results as "Expanded search."
 *
 * Returns top 5 contacts per goal, sorted by composite score.
 * Security: No PII in matchReason — uses anonymized KG tags only.
 */
export async function scoreOutreachForGoal(
	workspaceId: string,
	goalTitle: string,
	envelope: SealedEnvelope,
): Promise<OutreachContact[]> {
	// 1. Mask goal title via ELM and generate embedding
	const embedding = await withKeys(envelope, async () => {
		const keys = getCurrentKeys();
		const detected = prefilterEntities(goalTitle);
		const { maskedText } = maskEntities(goalTitle, keys.bik, detected);
		return generateEmbedding(maskedText);
	});

	// 2. Semantic search knowledge nodes for goal-relevant entities
	const allNodes = await searchKnowledgeNodes(workspaceId, '', embedding);
	const relevantNodes = allNodes.filter((n) => n.similarity >= KNOWLEDGE_SIMILARITY_THRESHOLD);
	if (relevantNodes.length === 0) return [];

	// 3. Gather direct candidates: contactId → matched KG tag names
	const directTags = new Map<string, Set<string>>();
	for (const node of relevantNodes) {
		const contactIds = await listContactIdsByKnowledge(node.id, workspaceId);
		for (const cId of contactIds) {
			const tags = directTags.get(cId) ?? new Set<string>();
			tags.add(node.displayName);
			directTags.set(cId, tags);
		}
	}

	// 4. Score direct candidates
	const goalNodeCount = relevantNodes.length;
	const results: OutreachContact[] = [];
	for (const [contactId, tags] of directTags) {
		results.push(await scoreOneContact(workspaceId, contactId, tags, goalNodeCount, false));
	}

	// 5. Cold-start: if <3 contacts above confidence threshold, expand via adjacent KG nodes
	const confidentCount = results.filter((r) => r.compositeScore > CONFIDENCE_THRESHOLD).length;
	if (confidentCount < MIN_CONFIDENT_CONTACTS) {
		const seen = new Set(directTags.keys());
		const expandedTags = new Map<string, Set<string>>();

		for (const node of relevantNodes) {
			try {
				const neighbors = await getKnowledgeNeighbors(node.id, workspaceId);
				for (const neighbor of neighbors) {
					const adjIds = await listContactIdsByKnowledge(neighbor.node.id, workspaceId);
					for (const cId of adjIds) {
						if (seen.has(cId)) continue;
						const tags = expandedTags.get(cId) ?? new Set<string>();
						tags.add(neighbor.node.displayName);
						expandedTags.set(cId, tags);
					}
				}
			} catch {
				// Non-fatal — KG traversal may fail for individual nodes
			}
		}

		for (const [contactId, tags] of expandedTags) {
			results.push(await scoreOneContact(workspaceId, contactId, tags, goalNodeCount, true));
		}
	}

	// 6. Sort by composite score descending, return top 5
	results.sort((a, b) => b.compositeScore - a.compositeScore);
	return results.slice(0, MAX_OUTREACH_CONTACTS);
}

// ─── Score: Achieve Goal ──────────────────────────────────────────────────────

/**
 * Surface active goals that are behind target pace (gap ≥ 10%).
 * priorityScore = gap fraction (1.0 = not started, 0.1 = almost done).
 * Reasoning: category label only, no PII.
 */
export async function scoreAchieveGoal(
	workspaceId: string,
	envelope: SealedEnvelope,
): Promise<CreateRecommendationItem[]> {
	const goals = await listGoals(workspaceId, { status: 'active', limit: 50 }, envelope);

	const now = new Date();
	const items: CreateRecommendationItem[] = [];
	for (const goal of goals) {
		const progress = goal.targetCount > 0 ? goal.currentCount / goal.targetCount : 1;
		const gap = 1 - progress;
		if (gap < 0.1) continue; // on track — don't surface

		// Build human-readable reasoning with goal title + pace + deadline
		let reasoning: string;
		const title = `[${goal.type} goal]`;
		const pctDone = Math.round(progress * 100);
		const pctBehind = Math.round(gap * 100);

		if (goal.targetDate) {
			const daysLeft = Math.max(
				0,
				Math.ceil((new Date(goal.targetDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
			);
			reasoning = `${title} is ${pctBehind}% behind pace — ${daysLeft} day${daysLeft !== 1 ? 's' : ''} until deadline.`;
		} else {
			reasoning = `${title} is at ${pctDone}% (${goal.currentCount}/${goal.targetCount}) — ${pctBehind}% behind target.`;
		}

		// G7: Cross-reference goal title with knowledge graph for contact suggestions
		try {
			const suggestion = await suggestContactsForGoal(workspaceId, goal.title, envelope);
			if (suggestion) {
				reasoning += ` ${suggestion}`;
			}
		} catch {
			// Non-fatal — knowledge graph may be empty or embedding service unavailable
		}

		items.push({
			contactId: goal.contactId ?? undefined,
			type: 'achieve_goal',
			priorityScore: gap,
			reasoning,
			expiresAt: goal.targetDate ?? addDays(30),
		});
	}
	return items;
}

// ─── Engine: compute + persist ────────────────────────────────────────────────

/**
 * Run all 5 scorers for a workspace, expire stale pending recommendations,
 * and batch-insert the new set. All scores are workspace-scoped and contain
 * no contact PII in the reasoning field.
 *
 * Feature-flag gated: `recommendations` must be enabled.
 */
export async function computeRecommendations(
	workspaceId: string,
	envelope: SealedEnvelope,
): Promise<void> {
	const enabled = await isFeatureEnabled('recommendations', workspaceId);
	if (!enabled) {
		console.log('[recommendations] Feature flag off \u2014 skipping');
		return;
	}

	// Expire stale pending items first
	const expiredCount = await expireOldRecommendations(workspaceId);
	if (expiredCount > 0) {
		console.log(`[recommendations] Expired ${expiredCount} stale items`);
	}

	// Run all 5 scorers in parallel (envelope-free scorers don't need crypto context)
	const [reEngage, followUp, advanceDeal, makeIntro, achieveGoal] = await Promise.all([
		scoreReEngage(workspaceId),
		scoreFollowUp(workspaceId, envelope),
		scoreAdvanceDeal(workspaceId, envelope),
		scoreMakeIntro(workspaceId),
		scoreAchieveGoal(workspaceId, envelope),
	]);

	const allItems = [...reEngage, ...followUp, ...advanceDeal, ...makeIntro, ...achieveGoal];

	if (allItems.length === 0) {
		console.log('[recommendations] No recommendations generated');
		return;
	}

	await createRecommendations(workspaceId, allItems);
	console.log(
		`[recommendations] Persisted ${allItems.length} recommendations for workspace=${workspaceId.slice(0, 8)}`,
	);
}
