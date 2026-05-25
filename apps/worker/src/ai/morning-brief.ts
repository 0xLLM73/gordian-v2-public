import type { SealedEnvelope } from '@repo/crypto';
import {
	accounts,
	and,
	db,
	eq,
	getActiveCommitments,
	getOutcomeStats,
	getPendingRecommendations,
	getPreferences,
	hybridSearch,
	saveBrief,
	sql,
	workspaces,
} from '@repo/db';
import { redactSensitive } from '@repo/shared';
import { Queue, Worker } from 'bullmq';
import { getBotApi } from '../bot/api';
import { scheduleRecommendations } from '../queues/recommendations';
import { broadcastUpdate } from '../realtime/broadcast';
import { connection } from '../redis';
import { isTelegramSendEnabled } from '../telegram-config';
import { selectPromptVariant } from './bandit';
import { inferWithCache } from './cached-inference';
import { buildCalibrationKernelModifier } from './calibration-context';
import { generateEmbedding } from './embeddings';
import { findRelevantPrecedents, formatPrecedents } from './precedents';

/**
 * Morning Brief Generator (Phase 6 + Phase 7 preferences).
 *
 * Generates AI-powered daily briefs with:
 * - Active commitments summary
 * - Pending follow-ups
 * - Contextual memories from recent interactions
 *
 * Reads user preferences for scheduling (timezone, briefTime, briefDays, briefEnabled).
 * Delivers briefs via Supabase Broadcast to the web dashboard.
 */

/**
 * Brief queue — CRITICAL: no colons in queue name.
 * Uses prefix '{ai-flow}' for Redis key namespacing.
 */
export const briefQueue = new Queue('briefs', {
	connection,
	prefix: '{ai-flow}',
});

const BRIEF_SYSTEM_KERNEL = `You are an executive assistant AI for a Telegram-based CRM called Gordian.
Your job is to generate concise, actionable morning briefs for the user.

Format rules:
- Start with a one-line greeting and date
- Group information by priority: URGENT, UPCOMING, CONTEXT
- URGENT = due today or overdue based on the date provided in the context
- UPCOMING = due within 7 days from today
- CONTEXT = activity and information with no specific deadline
- Only classify an item as URGENT if its due date is today or past. Do not inflate priority.
- Use bullet points, keep each under 15 words
- If a Deal Pipeline section is provided, include a DEALS section after UPCOMING
- For stalled deals, use prescriptive language referencing the workspace average (e.g., "Your deals average 30d in diligence. This one is at day 52.")
- For communication gaps, suggest specific outreach actions
- If a Goal Progress section is provided, include a GOALS section after DEALS
- Highlight behind-pace goals with urgency. Escalate goals with deadlines approaching (< 7 days)
- End with 1-2 specific action suggestions
- If no commitments exist, note it positively ("Clean slate today")
- Never fabricate commitments or contacts — only reference what's provided
- Keep the entire brief under 300 words`;

const BRIEF_GOLDEN_LIBRARY = `Example 1 (normal day — mix of urgent and upcoming):

Good morning! Here's your brief for Monday, Feb 10, 2026.

URGENT
- Send term sheet to Lena Park at Archetype (due today)
- Follow up on SAFE docs with Marco — overdue by 2 days

UPCOMING
- Token2049 prep call with Ray on Thursday
- Review Nexus bridge round memo (due Feb 14)
- Intro Sarah to the Delphi team (promised last week)

CONTEXT
- 4 new DMs from Lena yesterday — likely awaiting your term sheet
- Marco mentioned their cap table is finalized

SUGGESTED ACTIONS
1. Send Lena the term sheet — she's waiting
2. DM Marco about the SAFE before EOD

Example 2 (clean slate — no active commitments):

Good morning! Here's your brief for Wednesday, Feb 12, 2026.

No active commitments — clean slate today.

CONTEXT
- 2 new connections detected from Token2049 last week
- Recommendation: reach out to David Liu (warm intro available via Ray)

SUGGESTED ACTIONS
1. Review new connections and confirm any you want to track
2. Consider scheduling follow-ups from Token2049

Example 3 (overdue crisis — multiple overdue items):

Good morning! Here's your brief for Friday, Feb 14, 2026.

URGENT
- Send due diligence answers to Polychain — overdue by 4 days
- Wire bridge round payment to Nexus Labs — overdue by 1 day
- Reply to LP quarterly update request from James (due today)

UPCOMING
- GP/LP meeting prep on Monday

CONTEXT
- James sent 2 follow-up messages this week about the quarterly update
- Contradiction detected: Nexus said "closing Friday" but also "extending to March"

SUGGESTED ACTIONS
1. Prioritize the Polychain DD answers — longest overdue
2. Clarify Nexus timeline before wiring funds

Example 4 (heavy context, few commitments):

Good morning! Here's your brief for Tuesday, Feb 11, 2026.

UPCOMING
- Review tokenomics draft from Aura Finance (due Feb 15)

CONTEXT
- 6 new connections from ETH Denver detected
- Recommendation: follow up with Nina Chen (high-confidence intro match)
- Your deal pass decisions have 73% positive outcome rate (12 tracked)
- Contradiction: Aura said "20M FDV" in DMs but "35M FDV" in their deck

SUGGESTED ACTIONS
1. Flag the Aura valuation discrepancy before reviewing their tokenomics
2. Batch-confirm the ETH Denver connections while they're fresh

Example 5 (VC/crypto-specific — SAFEs, rounds, DM follow-ups):

Good morning! Here's your brief for Thursday, Feb 13, 2026.

URGENT
- Confirm LP commitment amount for Tensor Fund II (due today)
- DM Alex re: co-lead on Meridian seed round — he's waiting (overdue 1 day)

UPCOMING
- SAFE signing with Orbital on Monday (terms agreed)
- Review pitch deck from Lattice Network (due Feb 18)

CONTEXT
- Alex mentioned Sequoia is also looking at Meridian — time-sensitive
- Your intro commitments have been fulfilled 85% of the time

SUGGESTED ACTIONS
1. Lock the LP commitment — Alex needs the number for the round
2. DM Alex about co-leading before Sequoia moves`;

/**
 * Calculate milliseconds until the next occurrence of a target hour in a timezone.
 */
export function msUntilHour(targetHour: number, timezone: string): number {
	const now = new Date();

	// Get current time in target timezone
	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone: timezone,
		hour: 'numeric',
		minute: 'numeric',
		hour12: false,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	});

	const parts = formatter.formatToParts(now);
	const rawCurrentHour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
	const currentHour = rawCurrentHour % 24;
	const currentMinute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);

	// Hours until target (wrap around midnight)
	let hoursUntil = targetHour - currentHour;
	if (hoursUntil <= 0) {
		hoursUntil += 24;
	}

	const minutesUntil = hoursUntil * 60 - currentMinute;
	return minutesUntil * 60 * 1000;
}

/**
 * Get the current day-of-week abbreviation in a timezone.
 */
function getDayOfWeek(timezone: string) {
	const now = new Date();
	const dayName = new Intl.DateTimeFormat('en-US', {
		timeZone: timezone,
		weekday: 'short',
	}).format(now);
	return dayName.toLowerCase().slice(0, 3) as 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
}

/**
 * Schedule a daily morning brief for a user using their preferences.
 *
 * NOTE: Uses delay-based scheduling instead of BullMQ repeat option because
 * DragonflyDB's Lua 5.4 does not include Redis's cmsgpack library,
 * which BullMQ's repeatable job Lua scripts depend on.
 * The worker re-schedules the next brief after processing each one.
 */
export async function scheduleMorningBrief(
	userId: string,
	workspaceId: string,
	_timezone: string,
): Promise<void> {
	// Read user preferences for brief time (defaults to 7 if no prefs row)
	const prefs = await getPreferences(workspaceId, userId);
	const delay = msUntilHour(prefs.briefTime, prefs.timezone);

	await briefQueue.add(
		'morning-brief',
		{ userId, workspaceId, timezone: prefs.timezone },
		{
			delay,
			jobId: `brief-${userId}`, // Deduplicate per user
		},
	);

	console.log(
		`[brief] Scheduled morning brief for user=${userId.slice(0, 8)} at ${prefs.briefTime}:00 ${prefs.timezone} in ${Math.round(delay / 60000)}m`,
	);
}

/**
 * Build user context string from commitments and follow-up data.
 */
async function buildUserContext(
	workspaceId: string,
	envelope: SealedEnvelope,
): Promise<{ userContext: string; commitmentCount: number }> {
	const { listConnections, listDeals, getStageVelocityStats, listGoals } = await import('@repo/db');
	const [
		commitments,
		topRecs,
		followUpContext,
		outcomeStats,
		recentConnections,
		dealsList,
		velocityStats,
		activeGoals,
	] = await Promise.all([
		getActiveCommitments(workspaceId, envelope, { limit: 10 }),
		getPendingRecommendations(workspaceId, 3),
		generateEmbedding('pending follow-ups and action items').then((emb) =>
			hybridSearch(workspaceId, emb, 'pending follow-ups action items', { limit: 3 }),
		),
		getOutcomeStats(workspaceId),
		listConnections(workspaceId, { status: 'detected', limit: 5 }, envelope),
		listDeals(workspaceId, envelope, { limit: 50 }),
		getStageVelocityStats(workspaceId),
		listGoals(workspaceId, { status: 'active', limit: 20 }, envelope),
	]);

	const now = new Date();
	const commitmentList =
		commitments.length > 0
			? commitments
					.map((c) => {
						const dueStr = c.dueDate
							? `due ${new Date(c.dueDate).toLocaleDateString()}`
							: 'no due date';
						return `- [${c.commitmentType}] ${c.title} (${dueStr}, assignee: ${c.assignee})`;
					})
					.join('\n')
			: 'No active commitments.';

	const contextList =
		followUpContext.length > 0 ? followUpContext.map((m) => `- ${m.content}`).join('\n') : '';

	const recList =
		topRecs.length > 0 ? topRecs.map((r) => `- [${r.type}] ${r.reasoning}`).join('\n') : '';

	// Phase 35: surface a relevant loss precedent when recent negative outcomes exist
	const totalLosses = outcomeStats.reduce((sum, s) => sum + s.negative, 0);
	let lossContext = '';
	if (totalLosses > 0 && process.env.FEATURE_OUTCOME_SCORING === 'true') {
		try {
			const lossType = outcomeStats.find((s) => s.negative > 0)?.type ?? 'deal_closed';
			const query =
				lossType === 'commitment_missed'
					? 'commitment missed failed'
					: lossType === 'deal_closed'
						? 'deal lost negative outcome'
						: 'negative outcome loss';
			const precedents = await findRelevantPrecedents(workspaceId, query, envelope, 1);
			if (precedents.length > 0) {
				lossContext = `\n\nRecent Loss Precedent:\n${formatPrecedents(precedents)}`;
			}
		} catch {
			// Non-fatal — omit precedent context if lookup fails
		}
	}

	// Decision Provenance: surface most-cited rationales from last 30 days
	// SEC-CG-003: Two-step pattern — raw SQL for IDs/counts, Drizzle ORM for encrypted displayName
	let provenanceInsights = '';
	try {
		const { knowledgeNodes, inArray } = await import('@repo/db');
		const { withKeys } = await import('@repo/crypto');

		// Step 1: IDs + counts only (no encrypted columns)
		const idRows = await db.execute(sql`
			SELECT kn.id, COUNT(kl.id) as citation_count
			FROM knowledge_nodes kn
			JOIN knowledge_links kl
				ON kl.target_node_id = kn.id
				AND kl.link_type = 'cites'
				AND kl.workspace_id = ${workspaceId}::uuid
			WHERE kn.workspace_id = ${workspaceId}::uuid
				AND kn.type = 'rationale'
				AND kn.last_seen_at > NOW() - INTERVAL '30 days'
			GROUP BY kn.id
			ORDER BY citation_count DESC
			LIMIT 3
		`);

		const parsed = idRows as unknown as Array<{ id: string; citation_count: string }>;
		if (parsed.length > 0) {
			// Step 2: Drizzle ORM for encrypted columns (auto-decrypts via customType)
			const nodeIds = parsed.map((r) => r.id);
			const nodes = await withKeys(envelope, async () =>
				db
					.select({ id: knowledgeNodes.id, displayName: knowledgeNodes.displayName })
					.from(knowledgeNodes)
					.where(inArray(knowledgeNodes.id, nodeIds)),
			);
			const nameMap = new Map(nodes.map((n) => [n.id, n.displayName]));
			provenanceInsights = `\n\nDecision Patterns (last 30 days):\n${parsed
				.map((r) => `- "${nameMap.get(r.id) ?? 'unknown'}" cited ${r.citation_count}x in decisions`)
				.join('\n')}`;
		}
	} catch {
		// Non-fatal — omit provenance insights if lookup fails
	}

	// CGC: Decision success rates — query outcomes linked to decisions
	let decisionStats = '';
	try {
		const decisionOutcomes = await db.execute(sql`
			SELECT ud.decision_type,
				COUNT(*) FILTER (WHERE kn.metadata->>'result' = 'positive') as positive,
				COUNT(*) FILTER (WHERE kn.metadata->>'result' = 'negative') as negative,
				COUNT(*) as total
			FROM user_decisions ud
			JOIN knowledge_nodes kn_dec
				ON kn_dec.metadata->>'entityId' = ud.entity_id
				AND kn_dec.type = 'decision'
				AND kn_dec.workspace_id = ${workspaceId}::uuid
			JOIN knowledge_links kl
				ON kl.source_node_id = kn_dec.id
				AND kl.link_type = 'led_to'
				AND kl.workspace_id = ${workspaceId}::uuid
			JOIN knowledge_nodes kn
				ON kn.id = kl.target_node_id
				AND kn.type = 'outcome'
				AND kn.workspace_id = ${workspaceId}::uuid
			WHERE ud.workspace_id = ${workspaceId}::uuid
			GROUP BY ud.decision_type
			HAVING COUNT(*) >= 3
		`);

		const statsRows = decisionOutcomes as unknown as Array<{
			decision_type: string;
			positive: string;
			total: string;
		}>;
		if (statsRows.length > 0) {
			decisionStats = `\n\nDecision Success Rates:\n${statsRows
				.map((r) => {
					const rate = Math.round((Number.parseInt(r.positive) / Number.parseInt(r.total)) * 100);
					return `- Your ${r.decision_type} decisions have a ${rate}% positive outcome rate (${r.total} tracked)`;
				})
				.join('\n')}`;
		}
	} catch {
		// Non-fatal
	}

	// CGC: Contradiction warnings — recent knowledge contradictions
	// SEC-CG-003: Two-step pattern — raw SQL for IDs, Drizzle ORM for encrypted displayName
	let contradictionWarnings = '';
	try {
		const { knowledgeNodes, inArray } = await import('@repo/db');
		const { withKeys } = await import('@repo/crypto');

		// Step 1: IDs only (no encrypted columns)
		const contIdRows = await db.execute(sql`
			SELECT kl.source_node_id, kl.target_node_id
			FROM knowledge_links kl
			WHERE kl.link_type = 'contradicts'
				AND kl.workspace_id = ${workspaceId}::uuid
				AND kl.created_at > NOW() - INTERVAL '7 days'
			LIMIT 3
		`);

		const contParsed = contIdRows as unknown as Array<{
			source_node_id: string;
			target_node_id: string;
		}>;
		if (contParsed.length > 0) {
			// Step 2: Drizzle ORM for encrypted displayName (auto-decrypts)
			const allNodeIds = [
				...new Set(contParsed.flatMap((r) => [r.source_node_id, r.target_node_id])),
			];
			const nodes = await withKeys(envelope, async () =>
				db
					.select({ id: knowledgeNodes.id, displayName: knowledgeNodes.displayName })
					.from(knowledgeNodes)
					.where(inArray(knowledgeNodes.id, allNodeIds)),
			);
			const nameMap = new Map(nodes.map((n) => [n.id, n.displayName]));
			contradictionWarnings = `\n\nContradiction Alerts:\n${contParsed
				.map(
					(r) =>
						`- Contradiction detected: "${nameMap.get(r.source_node_id) ?? 'unknown'}" contradicts "${nameMap.get(r.target_node_id) ?? 'unknown'}"`,
				)
				.join('\n')}`;
		}
	} catch {
		// Non-fatal
	}

	const connectionList =
		recentConnections.length > 0
			? recentConnections
					.map((c) => {
						const eventStr = c.event ? ` at ${c.event}` : '';
						const contextStr = c.context ? ` — ${c.context}` : '';
						return `- New connection${eventStr}${contextStr}`;
					})
					.join('\n')
			: '';

	// D10: Build deals pipeline section
	let dealsPipelineSection = '';
	try {
		const activeDeals = dealsList.filter((d) => d.stage !== 'won' && d.stage !== 'lost');

		if (activeDeals.length > 0) {
			const avgDays = velocityStats.avgDaysPerStage;

			// Query contact lastMessageAt for comm gap detection
			const contactIds = [...new Set(activeDeals.map((d) => d.contactId))];
			const { contacts: contactsTable, inArray } = await import('@repo/db');
			const contactRows = await db
				.select({
					id: contactsTable.id,
					lastMessageAt: contactsTable.lastMessageAt,
				})
				.from(contactsTable)
				.where(
					and(eq(contactsTable.workspaceId, workspaceId), inArray(contactsTable.id, contactIds)),
				);
			const contactLastMsg = new Map(contactRows.map((c) => [c.id, c.lastMessageAt]));

			const dealLines: string[] = [];
			const stalledDeals: string[] = [];
			const recentlyAdvanced: string[] = [];
			const closingDeals: string[] = [];
			const commGaps: string[] = [];
			const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

			for (const deal of activeDeals) {
				const history = (deal.stageHistory as Array<{ stage: string; timestamp: string }>) || [];
				const lastEntry = history.length > 0 ? history[history.length - 1] : null;
				const contactName =
					[deal.contactFirstName, deal.contactLastName].filter(Boolean).join(' ') || 'Unknown';

				// Days in current stage
				const daysInStage = lastEntry?.timestamp
					? Math.floor(
							(now.getTime() - new Date(lastEntry.timestamp).getTime()) / (1000 * 60 * 60 * 24),
						)
					: 0;
				const stageAvg = avgDays[deal.stage];

				// Stalled: >150% of avg for this stage
				if (stageAvg && daysInStage > stageAvg * 1.5) {
					const avgRound = Math.round(stageAvg);
					stalledDeals.push(
						`- ${deal.title} (${contactName}) — ${daysInStage}d in ${deal.stage}. Your deals average ${avgRound}d here.`,
					);
				}

				// Recently advanced: entered current stage within last 7 days
				if (lastEntry && history.length > 1) {
					const enteredAt = new Date(lastEntry.timestamp);
					if (enteredAt > sevenDaysAgo) {
						const prevStage = history[history.length - 2]?.stage ?? '?';
						recentlyAdvanced.push(
							`- ${deal.title} (${contactName}) — moved ${prevStage} → ${deal.stage}`,
						);
					}
				}

				// Closing: in committed stage
				if (deal.stage === 'committed') {
					closingDeals.push(
						`- ${deal.title} (${contactName}) — committed, ${daysInStage}d since last advance`,
					);
				}

				// Communication gap: >7 days no messages with primary contact
				const lastMsg = contactLastMsg.get(deal.contactId);
				if (lastMsg && new Date(lastMsg) < sevenDaysAgo) {
					const gapDays = Math.floor(
						(now.getTime() - new Date(lastMsg).getTime()) / (1000 * 60 * 60 * 24),
					);
					commGaps.push(`- ${deal.title} (${contactName}) — no messages in ${gapDays}d`);
				}
			}

			if (stalledDeals.length > 0) dealLines.push(`Stalled Deals:\n${stalledDeals.join('\n')}`);
			if (recentlyAdvanced.length > 0)
				dealLines.push(`Recently Advanced:\n${recentlyAdvanced.join('\n')}`);
			if (closingDeals.length > 0) dealLines.push(`Closing:\n${closingDeals.join('\n')}`);
			if (commGaps.length > 0) dealLines.push(`Communication Gaps (>7d):\n${commGaps.join('\n')}`);

			if (dealLines.length > 0) {
				dealsPipelineSection = `Deal Pipeline (${activeDeals.length} active):\n${dealLines.join('\n')}`;
			}
		}
	} catch {
		// Non-fatal — omit deals section if lookup fails
	}

	// G1: Build goal progress section
	let goalProgressSection = '';
	try {
		if (activeGoals.length > 0) {
			const goalLines: string[] = [];
			for (const goal of activeGoals) {
				const pct =
					goal.targetCount > 0 ? Math.round((goal.currentCount / goal.targetCount) * 100) : 0;
				const title = goal.title || goal.type;

				// Pace Score = (currentCount / targetCount) / (daysElapsed / totalDays)
				let paceLabel = 'on track';
				let daysLeftStr = '';
				if (goal.targetDate) {
					const created = new Date(goal.createdAt);
					const deadline = new Date(goal.targetDate);
					const totalDays = Math.max(
						1,
						(deadline.getTime() - created.getTime()) / (1000 * 60 * 60 * 24),
					);
					const daysElapsed = Math.max(
						1,
						(now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24),
					);
					const daysLeft = Math.max(
						0,
						Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
					);
					const progress = goal.targetCount > 0 ? goal.currentCount / goal.targetCount : 0;
					const timeProgress = daysElapsed / totalDays;
					const paceScore = timeProgress > 0 ? progress / timeProgress : 1;

					daysLeftStr = `, ${daysLeft} day${daysLeft !== 1 ? 's' : ''} left`;
					if (daysLeft <= 7) {
						paceLabel = 'deadline approaching';
					} else if (paceScore < 0.9) {
						paceLabel = 'behind pace';
					}
				}

				goalLines.push(
					`- ${title} — ${goal.currentCount}/${goal.targetCount} (${pct}%)${daysLeftStr}. ${paceLabel === 'on track' ? 'On track.' : paceLabel === 'deadline approaching' ? 'Deadline approaching!' : 'Behind pace.'}`,
				);
			}
			goalProgressSection = `Goal Progress (${activeGoals.length} active):\n${goalLines.join('\n')}`;
		}
	} catch {
		// Non-fatal — omit goals section if lookup fails
	}

	const sections: string[] = [
		`Today is ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`,
	];

	if (commitments.length > 0) {
		sections.push(`Active Commitments (${commitments.length}):\n${commitmentList}`);
	} else {
		sections.push('No active commitments.');
	}

	if (contextList) sections.push(`Recent Context:\n${contextList}`);
	if (recList) sections.push(`Recommendations:\n${recList}`);
	if (connectionList)
		sections.push(`New Connections (${recentConnections.length}):\n${connectionList}`);
	if (lossContext) sections.push(lossContext.trim());
	if (provenanceInsights) sections.push(provenanceInsights.trim());
	if (decisionStats) sections.push(decisionStats.trim());
	if (contradictionWarnings) sections.push(contradictionWarnings.trim());
	if (dealsPipelineSection) sections.push(dealsPipelineSection);
	if (goalProgressSection) sections.push(goalProgressSection);

	sections.push(
		"Generate a morning brief based on the above data. Use today's date for urgency classification.",
	);

	const userContext = sections.join('\n\n');

	return { userContext, commitmentCount: commitments.length };
}

/**
 * Generate a brief for a user. Can be called on-demand or by the scheduler.
 */
export async function generateBrief(
	userId: string,
	workspaceId: string,
	envelope: SealedEnvelope,
): Promise<string> {
	const [{ userContext }, calibrationModifier] = await Promise.all([
		buildUserContext(workspaceId, envelope),
		buildCalibrationKernelModifier(userId, workspaceId, envelope),
	]);

	const response = await inferWithCache(
		BRIEF_SYSTEM_KERNEL + calibrationModifier,
		BRIEF_GOLDEN_LIBRARY,
		'',
		[{ role: 'user', content: userContext }],
		{ maxTokens: 1024, temperature: 0.4, helicone: { feature: 'morning-brief' } },
	);

	return response.content
		.filter((block) => block.type === 'text')
		.map((block) => (block.type === 'text' ? block.text : ''))
		.join('\n');
}

// ─── Bandit-integrated brief generation ──────────────────────────────────────

const TONE_VARIANTS = ['brief_tone_formal', 'brief_tone_casual'];
const DETAIL_VARIANTS = ['brief_detail_high', 'brief_detail_low'];

const TONE_MODIFIERS: Record<string, string> = {
	brief_tone_formal:
		'\n\nUse a formal, professional tone. Address the user respectfully. Include data tables where relevant.',
	brief_tone_casual:
		'\n\nUse a casual, friendly tone. Be concise and direct. Skip formalities, get to the alpha.',
};

const DETAIL_MODIFIERS: Record<string, string> = {
	brief_detail_high:
		'\n\nProvide HIGH detail: include specific numbers, dates, risk assessments, and context for each item.',
	brief_detail_low:
		'\n\nProvide LOW detail: keep it ultra-concise. Max 3 lines per section. Only the most critical items.',
};

export interface BanditBriefResult {
	text: string;
	toneTraceId: string;
	detailTraceId: string;
	toneVariant: string;
	detailVariant: string;
}

export async function generateBriefWithBandit(
	userId: string,
	workspaceId: string,
	envelope: SealedEnvelope,
): Promise<BanditBriefResult> {
	// 1. Select tone and detail variants via Thompson Sampling (per-user)
	const [toneSelection, detailSelection] = await Promise.all([
		selectPromptVariant('morning_brief_tone', TONE_VARIANTS, userId),
		selectPromptVariant('morning_brief_detail', DETAIL_VARIANTS, userId),
	]);

	// 2. Fetch data + calibration modifier in parallel
	const [{ userContext }, calibrationModifier] = await Promise.all([
		buildUserContext(workspaceId, envelope),
		buildCalibrationKernelModifier(userId, workspaceId, envelope),
	]);

	// 3. Build modified system kernel
	const toneModifier = TONE_MODIFIERS[toneSelection.variant] ?? '';
	const detailModifier = DETAIL_MODIFIERS[detailSelection.variant] ?? '';
	const systemKernel = BRIEF_SYSTEM_KERNEL + toneModifier + detailModifier + calibrationModifier;

	// 4. Call Claude with Helicone attribution
	const banditArm = `${toneSelection.variant}+${detailSelection.variant}`;
	const response = await inferWithCache(
		systemKernel,
		BRIEF_GOLDEN_LIBRARY,
		'',
		[{ role: 'user', content: userContext }],
		{
			maxTokens: 1024,
			temperature: 0.4,
			helicone: { feature: 'morning-brief', banditArm },
		},
	);

	const text = response.content
		.filter((block) => block.type === 'text')
		.map((block) => (block.type === 'text' ? block.text : ''))
		.join('\n');

	console.log(
		`[brief-bandit] tone=${toneSelection.variant} detail=${detailSelection.variant} userId=${userId}`,
	);

	return {
		text,
		toneTraceId: toneSelection.traceId,
		detailTraceId: detailSelection.traceId,
		toneVariant: toneSelection.variant,
		detailVariant: detailSelection.variant,
	};
}

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

/**
 * Format a brief's LLM text output as Telegram-safe HTML.
 * Maps URGENT/UPCOMING/CONTEXT/SUGGESTED ACTIONS headers to bold,
 * and truncates to Telegram's 4096-char message limit.
 */
function formatBriefAsHtml(text: string): string {
	// 1. Escape HTML entities first (safe — no tags exist yet)
	let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

	// 2. Bold section headers (Act Now / Watch / New Intel map to URGENT / UPCOMING / CONTEXT)
	html = html.replace(/^(URGENT|UPCOMING|DEALS|GOALS|CONTEXT|SUGGESTED ACTIONS)$/gm, '<b>$1</b>');

	// 3. Truncate to Telegram limit (4096 chars)
	if (html.length > 4096) {
		html = `${html.slice(0, 4090)}…`;
	}

	return html;
}

/**
 * Push a brief to the user's Telegram via Bot API.
 * Looks up the user's Telegram account_id (which doubles as chat_id for DMs).
 * Silently skips if user has no Telegram account or bot can't reach them.
 */
async function pushBriefToTelegram(userId: string, briefText: string): Promise<void> {
	if (!isTelegramSendEnabled()) {
		console.log(
			`[brief] Telegram brief push disabled by TELEGRAM_SEND_ENABLED=false for user=${userId.slice(0, 8)}`,
		);
		return;
	}

	const rows = await db
		.select({ accountId: accounts.accountId })
		.from(accounts)
		.where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'telegram')))
		.limit(1);

	if (rows.length === 0) {
		console.log(`[brief] No Telegram account for user=${userId.slice(0, 8)}, skipping push`);
		return;
	}

	const chatId = rows[0].accountId;
	const html = formatBriefAsHtml(briefText);

	try {
		await getBotApi().api.sendMessage(chatId, html, { parse_mode: 'HTML' });
		console.log(`[brief] Pushed brief to Telegram for user=${userId.slice(0, 8)}`);
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		// 403 = bot blocked by user, 400 = chat not found — non-fatal
		console.warn(`[brief] Telegram push failed for user=${userId.slice(0, 8)}: ${msg}`);
	}
}

/**
 * Brief worker — processes scheduled and on-demand brief requests.
 * Reads user preferences to check briefEnabled, briefDays, timezone, and briefTime.
 */
export const briefWorker = new Worker(
	'briefs',
	async (job) => {
		const { userId, workspaceId } = job.data as {
			userId: string;
			workspaceId: string;
			timezone: string;
		};

		console.log(
			`[brief] Generating brief for user=${userId.slice(0, 8)} workspace=${workspaceId.slice(0, 8)}`,
		);

		// Check user preferences before generating
		const prefs = await getPreferences(workspaceId, userId);

		if (!prefs.briefEnabled) {
			console.log(`[brief] Briefs disabled for user=${userId.slice(0, 8)}, skipping`);
			return;
		}

		// Check if today is a brief day
		const today = getDayOfWeek(prefs.timezone);
		if (!prefs.briefDays.includes(today)) {
			console.log(
				`[brief] Today (${today}) not in brief days for user=${userId.slice(0, 8)}, skipping`,
			);
			// Still reschedule for tomorrow
			await scheduleMorningBrief(userId, workspaceId, prefs.timezone);
			return;
		}

		// Resolve envelope from DB + KMS — the envelope is never in job data (SEC-028)
		const envelope = await getWorkspaceEnvelope(workspaceId);

		if (!envelope) {
			console.error(
				`[brief] No workspace envelope found for workspaceId=${workspaceId.slice(0, 8)}, skipping`,
			);
			await scheduleMorningBrief(userId, workspaceId, prefs.timezone);
			return;
		}

		const briefResult = await generateBriefWithBandit(userId, workspaceId, envelope);
		await saveBrief(workspaceId, userId, briefResult, envelope);

		// Push brief to Telegram (non-fatal — don't break the pipeline)
		await pushBriefToTelegram(userId, briefResult.text).catch((err) => {
			console.error(
				`[brief] Telegram push error for user=${userId.slice(0, 8)}:`,
				redactSensitive(err),
			);
		});

		// Notify only — client fetches brief content via authenticated API (SEC-028)
		await broadcastUpdate(workspaceId, 'morning-brief', {
			ready: true,
			generatedAt: new Date().toISOString(),
		});

		console.log(`[brief] Brief delivered for user=${userId.slice(0, 8)}`);

		// Self-reschedule using preferences (timezone and briefTime)
		await scheduleMorningBrief(userId, workspaceId, prefs.timezone);
		console.log(`[brief] Re-scheduled next brief for user=${userId.slice(0, 8)}`);

		// Schedule daily recommendations refresh (fires after brief — envelope resolved by worker)
		await scheduleRecommendations(workspaceId).catch((err) => {
			console.error('[brief] Failed to schedule recommendations:', redactSensitive(err));
		});

		// Schedule knowledge inference (creates edges in knowledge graph)
		const { scheduleKnowledgeInference } = await import('../queues/knowledge-inference');
		await scheduleKnowledgeInference(workspaceId).catch((err) => {
			console.error('[brief] Failed to schedule knowledge inference:', redactSensitive(err));
		});

		// CGC Phase 4b: Daily confidence decay on stale causal edges
		try {
			const { decayStaleEdges } = await import('@repo/db');
			const decayed = await decayStaleEdges(workspaceId, {
				olderThanDays: 30,
				decayAmount: 0.05,
				minConfidence: 0.1,
			});
			if (decayed > 0) {
				console.log(
					`[brief] Decayed confidence on ${decayed} stale edges for workspace=${workspaceId.slice(0, 8)}`,
				);
			}
		} catch (err) {
			console.error('[brief] Confidence decay failed:', redactSensitive(err));
		}
	},
	{ connection, prefix: '{ai-flow}', concurrency: 2 },
);

// Event logging
briefWorker.on('completed', (job) => {
	console.log(`[brief] Job ${job.id} completed`);
});
briefWorker.on('failed', (job, err) => {
	console.error(`[brief] Job ${job?.id} failed:`, redactSensitive(err));
});
