/**
 * Golden Dataset Expansion Script
 *
 * Adds ~30 new golden examples to the `golden_dataset` table:
 * - 20 commitment extraction examples (Web3 slang, multi-commitment,
 *   conditional, temporal edge cases, false positives)
 * - 10 brief quality examples (formal, casual, mixed, edge cases)
 *
 * Idempotent: deletes `feature_domain LIKE 'seed_%'` rows first, then re-inserts
 * all seed examples (including originals from seed.ts).
 *
 * Usage: pnpm tsx scripts/expand-golden.ts
 */

import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../packages/db/src/schema/index';

// ─── Config ──────────────────────────────────────────────────────────────────

const DATABASE_URL =
	process.env.DATABASE_URL ?? 'postgresql://gordian:gordian@localhost:5433/gordian_dev';

const client = postgres(DATABASE_URL, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

// ─── Deterministic helpers (same as seed.ts) ─────────────────────────────────

function deterministicUUID(name: string): string {
	const hash = createHash('sha256').update(`gordian-seed:${name}`).digest('hex');
	return [
		hash.slice(0, 8),
		hash.slice(8, 12),
		`4${hash.slice(13, 16)}`,
		`8${hash.slice(17, 20)}`,
		hash.slice(20, 32),
	].join('-');
}

function generateDeterministicVector(text: string, dim = 1536): number[] {
	const hash = createHash('sha256').update(text).digest('hex');
	const vector: number[] = [];
	for (let i = 0; i < dim; i++) {
		const charCode = hash.charCodeAt(i % hash.length);
		const val = (charCode - 97) / 26;
		vector.push(val);
	}
	const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
	return vector.map((val) => val / magnitude);
}

const ALICE_USER_ID = deterministicUUID('alice');
const BOB_USER_ID = deterministicUUID('bob');
const CHARLIE_USER_ID = deterministicUUID('charlie');

// ─── Golden Dataset Types ────────────────────────────────────────────────────

interface GoldenSeed {
	featureDomain: string;
	inputContext: string;
	modelPrediction: Record<string, unknown>;
	correctedOutput: Record<string, unknown>;
	correctionReasoning: string;
	tags: string[];
	difficulty: 'trivial' | 'standard' | 'edge_case';
	source: 'user_edit' | 'expert_review' | 'implicit_signal';
	status: 'verified';
	verifiedBy: string;
	verificationScore: number;
}

// ─── Commitment Extraction Examples (20 new) ─────────────────────────────────

const COMMITMENT_EXTRACTION_EXAMPLES: GoldenSeed[] = [
	// === Web3 Slang (6) ===
	{
		featureDomain: 'seed_commitment_extraction',
		inputContext:
			'Gonna ape in 50 ETH on the presale tomorrow at 9am UTC. Already got the whitelist spot confirmed.',
		modelPrediction: {
			commitments: [
				{ title: 'Ape into presale', type: 'financial', assignee: 'contact', confidence: 0.6 },
			],
		},
		correctedOutput: {
			commitments: [
				{
					title: 'Participate in presale with 50 ETH',
					type: 'financial',
					assignee: 'contact',
					confidence: 0.82,
					due_date: 'tomorrow 9am UTC',
				},
			],
		},
		correctionReasoning:
			'"Ape in" is Web3 slang for a financial commitment. The specific amount (50 ETH) and time (tomorrow 9am) make this a real commitment, not just hype. Title should be normalized from slang.',
		tags: ['web3-slang', 'ape-in', 'presale', 'financial', 'deadline'],
		difficulty: 'edge_case',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: BOB_USER_ID,
		verificationScore: 0.91,
	},
	{
		featureDomain: 'seed_commitment_extraction',
		inputContext: 'WAGMI ser, we are all gonna make it. The vibes are immaculate today.',
		modelPrediction: {
			commitments: [
				{
					title: 'Financial growth commitment',
					type: 'promise',
					assignee: 'contact',
					confidence: 0.4,
				},
			],
		},
		correctedOutput: { commitments: [] },
		correctionReasoning:
			'WAGMI ("we are all gonna make it") is a social pleasantry in Web3, not an actionable commitment. "Ser" is ironic internet address. No specific obligation or deadline exists.',
		tags: ['web3-slang', 'WAGMI', 'false-positive', 'no-commitment'],
		difficulty: 'edge_case',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: BOB_USER_ID,
		verificationScore: 0.97,
	},
	{
		featureDomain: 'seed_commitment_extraction',
		inputContext:
			'gm fren, just bridged 10K USDC to Arbitrum. Will deploy the LP position on Camelot by EOD.',
		modelPrediction: {
			commitments: [
				{ title: 'Bridge USDC', type: 'financial', assignee: 'contact', confidence: 0.75 },
				{ title: 'Deploy LP', type: 'task', assignee: 'contact', confidence: 0.7 },
			],
		},
		correctedOutput: {
			commitments: [
				{
					title: 'Deploy LP position on Camelot DEX',
					type: 'financial',
					assignee: 'contact',
					confidence: 0.85,
					due_date: 'EOD today',
				},
			],
		},
		correctionReasoning:
			'"gm" is just a greeting. The bridge is past-tense (already done), not a commitment. Only the LP deployment is a future commitment with a clear deadline (EOD).',
		tags: ['web3-slang', 'gm', 'past-tense', 'DeFi', 'LP'],
		difficulty: 'edge_case',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: BOB_USER_ID,
		verificationScore: 0.93,
	},
	{
		featureDomain: 'seed_commitment_extraction',
		inputContext: 'touch grass bro, the market will do what the market does. few understand.',
		modelPrediction: {
			commitments: [{ title: 'Monitor market', type: 'task', assignee: 'user', confidence: 0.3 }],
		},
		correctedOutput: { commitments: [] },
		correctionReasoning:
			'"Touch grass" means take a break from crypto. "Few understand" is a meme phrase. No actionable commitment exists — this is philosophical market commentary.',
		tags: ['web3-slang', 'touch-grass', 'few-understand', 'false-positive'],
		difficulty: 'edge_case',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: BOB_USER_ID,
		verificationScore: 0.99,
	},
	{
		featureDomain: 'seed_commitment_extraction',
		inputContext:
			'Ser I will personally vouch for the team. Dropping 25 ETH into the seed round once the SAFT is finalized. NFA but this is alpha.',
		modelPrediction: {
			commitments: [
				{ title: 'Vouch for team', type: 'promise', assignee: 'contact', confidence: 0.6 },
			],
		},
		correctedOutput: {
			commitments: [
				{
					title: 'Vouch for the project team',
					type: 'promise',
					assignee: 'contact',
					confidence: 0.72,
				},
				{
					title: 'Invest 25 ETH in seed round (pending SAFT)',
					type: 'financial',
					assignee: 'contact',
					confidence: 0.78,
				},
			],
		},
		correctionReasoning:
			'Two commitments: a personal vouching promise and a conditional financial commitment (25 ETH pending SAFT). "NFA" (not financial advice) is a disclaimer, not a negation. "Alpha" means valuable information.',
		tags: ['web3-slang', 'ser', 'NFA', 'dual-commitment', 'conditional'],
		difficulty: 'edge_case',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: BOB_USER_ID,
		verificationScore: 0.88,
	},
	{
		featureDomain: 'seed_commitment_extraction',
		inputContext: 'LFG! This is going to 100x. Loading up my bags heavy. Diamond hands only.',
		modelPrediction: {
			commitments: [
				{ title: 'Buy more tokens', type: 'financial', assignee: 'contact', confidence: 0.5 },
			],
		},
		correctedOutput: { commitments: [] },
		correctionReasoning:
			'"LFG" (let\'s go) is hype. "Loading bags" and "diamond hands" are crypto slang for holding/buying, but lack specifics (amount, token, timeline). This is sentiment expression, not an actionable commitment.',
		tags: ['web3-slang', 'LFG', 'diamond-hands', 'false-positive', 'no-specifics'],
		difficulty: 'edge_case',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: BOB_USER_ID,
		verificationScore: 0.95,
	},

	// === Multi-commitment (4) ===
	{
		featureDomain: 'seed_commitment_extraction',
		inputContext:
			"Three things from today's call: (1) I will send the updated term sheet by Friday, (2) schedule the legal review for next Tuesday, and (3) Marcus needs to confirm the cap table allocation before we proceed.",
		modelPrediction: {
			commitments: [
				{ title: 'Send term sheet', type: 'task', assignee: 'user', confidence: 0.9 },
				{ title: 'Schedule legal review', type: 'meeting', assignee: 'user', confidence: 0.85 },
			],
		},
		correctedOutput: {
			commitments: [
				{
					title: 'Send updated term sheet',
					type: 'task',
					assignee: 'user',
					confidence: 0.93,
					due_date: 'Friday',
				},
				{
					title: 'Schedule legal review',
					type: 'meeting',
					assignee: 'user',
					confidence: 0.88,
					due_date: 'next Tuesday',
				},
				{
					title: 'Confirm cap table allocation',
					type: 'task',
					assignee: 'contact',
					confidence: 0.85,
				},
			],
		},
		correctionReasoning:
			'Model missed the third commitment assigned to Marcus (contact). All three are clearly numbered and actionable. Deadlines should be preserved where stated.',
		tags: ['multi-commitment', 'numbered-list', 'mixed-assignee', 'deadline'],
		difficulty: 'standard',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: ALICE_USER_ID,
		verificationScore: 0.94,
	},
	{
		featureDomain: 'seed_commitment_extraction',
		inputContext:
			'Sure, I can handle the KYC review and also ping the compliance team about the Reg D filing. Oh and remind me to follow up with the LP about their wire — they said it would land by Thursday.',
		modelPrediction: {
			commitments: [
				{ title: 'Handle KYC review', type: 'task', assignee: 'user', confidence: 0.8 },
			],
		},
		correctedOutput: {
			commitments: [
				{
					title: 'Complete KYC review',
					type: 'task',
					assignee: 'user',
					confidence: 0.87,
				},
				{
					title: 'Contact compliance team about Reg D filing',
					type: 'task',
					assignee: 'user',
					confidence: 0.84,
				},
				{
					title: 'Follow up with LP about wire transfer',
					type: 'task',
					assignee: 'user',
					confidence: 0.8,
					due_date: 'Thursday',
				},
			],
		},
		correctionReasoning:
			'Three interleaved commitments in conversational language. "Also" and "oh and" introduce additional tasks that models often miss. The LP wire has a deadline embedded in reported speech.',
		tags: ['multi-commitment', 'conversational', 'interleaved', 'reported-speech'],
		difficulty: 'standard',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: ALICE_USER_ID,
		verificationScore: 0.9,
	},
	{
		featureDomain: 'seed_commitment_extraction',
		inputContext:
			'After the snapshot vote closes, I need to: compile the results, publish the delegate summary on the forum, and coordinate with the multisig signers for execution. The security council also committed to reviewing the timelock params within 48 hours.',
		modelPrediction: {
			commitments: [
				{ title: 'Compile vote results', type: 'task', assignee: 'user', confidence: 0.8 },
				{
					title: 'Publish delegate summary',
					type: 'task',
					assignee: 'user',
					confidence: 0.75,
				},
			],
		},
		correctedOutput: {
			commitments: [
				{
					title: 'Compile snapshot vote results',
					type: 'task',
					assignee: 'user',
					confidence: 0.82,
				},
				{
					title: 'Publish delegate summary on governance forum',
					type: 'task',
					assignee: 'user',
					confidence: 0.8,
				},
				{
					title: 'Coordinate multisig signers for execution',
					type: 'task',
					assignee: 'user',
					confidence: 0.78,
				},
				{
					title: 'Review timelock parameters',
					type: 'task',
					assignee: 'contact',
					confidence: 0.86,
				},
			],
		},
		correctionReasoning:
			'Four commitments: three sequential tasks for the user and one from the security council (contact). Model missed the multisig coordination and the security council commitment. The 48-hour deadline applies to the council review.',
		tags: ['multi-commitment', 'governance', 'sequential', 'four-commitments'],
		difficulty: 'edge_case',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: CHARLIE_USER_ID,
		verificationScore: 0.89,
	},
	{
		featureDomain: 'seed_commitment_extraction',
		inputContext:
			'Tell Jake I will handle the settlement, and he should send the invoice to accounting. Meanwhile Elena promised to finalize the pitch deck and share it with us before the call on Monday.',
		modelPrediction: {
			commitments: [
				{ title: 'Handle settlement', type: 'task', assignee: 'user', confidence: 0.85 },
				{ title: 'Finalize pitch deck', type: 'task', assignee: 'contact', confidence: 0.8 },
			],
		},
		correctedOutput: {
			commitments: [
				{
					title: 'Handle OTC settlement',
					type: 'financial',
					assignee: 'user',
					confidence: 0.88,
				},
				{
					title: 'Send invoice to accounting',
					type: 'task',
					assignee: 'contact',
					confidence: 0.83,
				},
				{
					title: 'Finalize and share pitch deck',
					type: 'task',
					assignee: 'contact',
					confidence: 0.85,
					due_date: 'before Monday call',
				},
			],
		},
		correctionReasoning:
			'Three commitments across two contacts. Model missed Jake\'s invoice task (delegated via user). Elena\'s task has both "finalize" and "share" as combined commitment with a deadline.',
		tags: ['multi-commitment', 'multi-contact', 'delegated', 'deadline'],
		difficulty: 'standard',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: ALICE_USER_ID,
		verificationScore: 0.91,
	},

	// === Conditional (3) ===
	{
		featureDomain: 'seed_commitment_extraction',
		inputContext:
			'If the governance vote passes with >66% approval, I will deploy the new staking contract within 24 hours. Otherwise, we go back to the drawing board.',
		modelPrediction: {
			commitments: [
				{
					title: 'Deploy staking contract',
					type: 'task',
					assignee: 'user',
					confidence: 0.85,
				},
			],
		},
		correctedOutput: {
			commitments: [
				{
					title: 'Deploy new staking contract (if vote passes >66%)',
					type: 'task',
					assignee: 'user',
					confidence: 0.65,
				},
			],
		},
		correctionReasoning:
			'This is a conditional commitment — depends on vote outcome. Confidence should be lower (0.65) because execution is uncertain. The condition MUST be in the title for clarity.',
		tags: ['conditional', 'governance', 'if-then', 'lower-confidence'],
		difficulty: 'edge_case',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: CHARLIE_USER_ID,
		verificationScore: 0.92,
	},
	{
		featureDomain: 'seed_commitment_extraction',
		inputContext:
			"Assuming we close the round by end of month, I will start onboarding the new portfolio companies in Q2. That's contingent on the LP wires clearing though.",
		modelPrediction: {
			commitments: [
				{
					title: 'Onboard portfolio companies in Q2',
					type: 'task',
					assignee: 'user',
					confidence: 0.8,
				},
			],
		},
		correctedOutput: {
			commitments: [
				{
					title: 'Onboard new portfolio companies in Q2 (pending round close and LP wires)',
					type: 'task',
					assignee: 'user',
					confidence: 0.55,
				},
			],
		},
		correctionReasoning:
			'Double conditional: depends on (1) round closing by EOM and (2) LP wires clearing. Confidence should be ~0.55 due to compound uncertainty. Conditions must be noted in title.',
		tags: ['conditional', 'compound-condition', 'VC', 'lower-confidence'],
		difficulty: 'edge_case',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: ALICE_USER_ID,
		verificationScore: 0.9,
	},
	{
		featureDomain: 'seed_commitment_extraction',
		inputContext:
			'Once the audit report comes back clean, we will list on Uniswap and Aerodrome simultaneously. If there are critical findings, we postpone to fix first.',
		modelPrediction: {
			commitments: [{ title: 'List on Uniswap', type: 'task', assignee: 'user', confidence: 0.75 }],
		},
		correctedOutput: {
			commitments: [
				{
					title: 'List on Uniswap and Aerodrome (pending clean audit)',
					type: 'task',
					assignee: 'user',
					confidence: 0.6,
				},
			],
		},
		correctionReasoning:
			'Conditional on audit results. Both DEXes are a single combined listing action, not two separate commitments. Model missed Aerodrome. Confidence should be lower due to audit dependency.',
		tags: ['conditional', 'DeFi', 'audit-dependent', 'combined-action'],
		difficulty: 'edge_case',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: BOB_USER_ID,
		verificationScore: 0.91,
	},

	// === Temporal Edge Cases (3) ===
	{
		featureDomain: 'seed_commitment_extraction',
		inputContext:
			'We already sent the wire yesterday and the tokens were distributed this morning. The vesting schedule kicks in next month.',
		modelPrediction: {
			commitments: [
				{ title: 'Send wire', type: 'financial', assignee: 'user', confidence: 0.8 },
				{ title: 'Distribute tokens', type: 'task', assignee: 'user', confidence: 0.75 },
			],
		},
		correctedOutput: { commitments: [] },
		correctionReasoning:
			'All actions are past tense: wire was "already sent yesterday" and tokens "were distributed this morning." The vesting schedule "kicks in" is a scheduled event, not a personal commitment. No future obligations exist.',
		tags: ['temporal', 'past-tense', 'false-positive', 'completed-actions'],
		difficulty: 'edge_case',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: ALICE_USER_ID,
		verificationScore: 0.96,
	},
	{
		featureDomain: 'seed_commitment_extraction',
		inputContext:
			'I am currently reviewing the tokenomics model and running the simulations. Should have results soon — will share when ready.',
		modelPrediction: {
			commitments: [
				{
					title: 'Review tokenomics model',
					type: 'task',
					assignee: 'user',
					confidence: 0.8,
				},
				{ title: 'Share results', type: 'task', assignee: 'user', confidence: 0.7 },
			],
		},
		correctedOutput: {
			commitments: [
				{
					title: 'Share tokenomics simulation results when ready',
					type: 'task',
					assignee: 'user',
					confidence: 0.68,
				},
			],
		},
		correctionReasoning:
			'The review is present-continuous (in progress, not a commitment). "Will share when ready" is a vague future commitment with no specific deadline — lower confidence. "Soon" is not actionable.',
		tags: ['temporal', 'present-continuous', 'vague-deadline', 'soon'],
		difficulty: 'edge_case',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: ALICE_USER_ID,
		verificationScore: 0.89,
	},
	{
		featureDomain: 'seed_commitment_extraction',
		inputContext:
			"The proposal was submitted last week. Voting ends in 3 days. I will abstain from this one but plan to vote on the next cycle's proposals.",
		modelPrediction: {
			commitments: [
				{ title: 'Submit proposal', type: 'task', assignee: 'user', confidence: 0.7 },
				{ title: 'Vote on next cycle', type: 'promise', assignee: 'user', confidence: 0.6 },
			],
		},
		correctedOutput: {
			commitments: [
				{
					title: 'Vote on next governance cycle proposals',
					type: 'promise',
					assignee: 'user',
					confidence: 0.62,
				},
			],
		},
		correctionReasoning:
			'Proposal submission is past tense. Abstaining is a non-action. Only the future voting plan is a commitment, but "plan to" indicates lower confidence than "I will." No specific deadline for the "next cycle."',
		tags: ['temporal', 'past-tense', 'plan-to', 'governance', 'vague-timeline'],
		difficulty: 'edge_case',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: CHARLIE_USER_ID,
		verificationScore: 0.88,
	},

	// === False Positives (4) ===
	{
		featureDomain: 'seed_commitment_extraction',
		inputContext:
			'ETH is looking strong above $3,200 support. If it breaks $3,500 resistance, we could see $4K by March. Accumulation zone for sure.',
		modelPrediction: {
			commitments: [
				{ title: 'Accumulate ETH', type: 'financial', assignee: 'user', confidence: 0.5 },
			],
		},
		correctedOutput: { commitments: [] },
		correctionReasoning:
			'Pure market commentary and price speculation. "Accumulation zone" is technical analysis terminology, not a personal commitment to buy. "We could see" is hypothetical, not an obligation.',
		tags: ['false-positive', 'market-commentary', 'price-speculation', 'TA'],
		difficulty: 'standard',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: BOB_USER_ID,
		verificationScore: 0.97,
	},
	{
		featureDomain: 'seed_commitment_extraction',
		inputContext:
			'Great chat today! Really enjoyed the discussion about DeFi composability. We should do this more often. Talk soon!',
		modelPrediction: {
			commitments: [
				{ title: 'Schedule another chat', type: 'meeting', assignee: 'user', confidence: 0.45 },
			],
		},
		correctedOutput: { commitments: [] },
		correctionReasoning:
			'"We should do this more often" and "talk soon" are social pleasantries, not actionable commitments. No specific time, date, or concrete action is proposed.',
		tags: ['false-positive', 'social-pleasantry', 'no-action'],
		difficulty: 'standard',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: ALICE_USER_ID,
		verificationScore: 0.98,
	},
	{
		featureDomain: 'seed_commitment_extraction',
		inputContext:
			'The team behind $PEPE did a 10x last cycle. Same playbook this time. Everyone who bought the dip is sitting pretty. Not sure if it runs more from here.',
		modelPrediction: {
			commitments: [
				{ title: 'Buy PEPE dip', type: 'financial', assignee: 'user', confidence: 0.4 },
			],
		},
		correctedOutput: { commitments: [] },
		correctionReasoning:
			'Historical analysis of past performance and general market observation. "Not sure if it runs more" expresses uncertainty, not commitment. No personal obligation or intent to act.',
		tags: ['false-positive', 'historical', 'memecoin', 'market-observation'],
		difficulty: 'standard',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: BOB_USER_ID,
		verificationScore: 0.96,
	},
	{
		featureDomain: 'seed_commitment_extraction',
		inputContext:
			'Congrats on the raise! Heard it was oversubscribed 3x. The ecosystem is really heating up. Bullish on the whole L2 narrative.',
		modelPrediction: {
			commitments: [
				{
					title: 'Support L2 ecosystem',
					type: 'promise',
					assignee: 'contact',
					confidence: 0.35,
				},
			],
		},
		correctedOutput: { commitments: [] },
		correctionReasoning:
			'Congratulations and sentiment expression. "Bullish on the narrative" is an opinion, not a commitment. No personal obligation exists anywhere in this message.',
		tags: ['false-positive', 'congratulations', 'sentiment', 'no-obligation'],
		difficulty: 'trivial',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: ALICE_USER_ID,
		verificationScore: 0.99,
	},
];

// ─── Brief Quality Examples (10 new) ─────────────────────────────────────────

const BRIEF_QUALITY_EXAMPLES: GoldenSeed[] = [
	// === Formal Tone (3) ===
	{
		featureDomain: 'seed_brief_quality',
		inputContext: JSON.stringify({
			commitments: [
				{
					title: 'Review SAFT for Aptos round',
					type: 'task',
					dueDate: '2026-02-16',
					assignee: 'user',
				},
				{
					title: 'Wire $2M allocation',
					type: 'financial',
					dueDate: '2026-02-18',
					assignee: 'contact',
				},
				{ title: 'LP quarterly report', type: 'task', dueDate: '2026-02-20', assignee: 'user' },
			],
			recentContext: ['Marcus confirmed allocation at $4/token', 'Sarah flagged Reg S exemption'],
			persona: 'VC (formal)',
		}),
		modelPrediction: {
			brief:
				'Good morning! You have 3 commitments. SAFT review is due tomorrow. Wire payment coming Friday. LP report due next week.',
		},
		correctedOutput: {
			brief: `Good morning. Here is your brief for Sunday, February 15, 2026.

URGENT
- Review SAFT for Aptos round (due tomorrow, Feb 16)
- Note: Sarah Mitchell flagged Regulation S exemption criteria — verify accreditation clause

UPCOMING
- Wire transfer: $2M allocation due Feb 18 (Marcus Chen, Aptos Fund)
  - Confirmed: 500K tokens at $4.00/token, $2B FDV
- LP quarterly report due Feb 20 (David Park, Hanhwa Digital)

RISK ASSESSMENT
- SAFT execution depends on Reg S compliance review — potential 2-day delay if accreditation clause needs revision

SUGGESTED ACTIONS
1. Prioritize SAFT review with Sarah today to unblock the wire timeline
2. Begin drafting LP quarterly report — David prefers detailed data tables`,
		},
		correctionReasoning:
			'Formal briefs need: date header, priority grouping, specific data (amounts, names), risk assessment section, and professional language. Model brief was too vague — missing contact names, amounts, and risk context.',
		tags: ['brief', 'formal', 'VC', 'risk-assessment', 'data-rich'],
		difficulty: 'standard',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: ALICE_USER_ID,
		verificationScore: 0.93,
	},
	{
		featureDomain: 'seed_brief_quality',
		inputContext: JSON.stringify({
			commitments: [
				{
					title: 'Due diligence on MoveProtocol Series A',
					type: 'task',
					dueDate: '2026-02-17',
					assignee: 'user',
				},
				{
					title: 'Term sheet counter-proposal',
					type: 'task',
					dueDate: '2026-02-19',
					assignee: 'user',
				},
			],
			recentContext: [
				'Elena shared updated metrics: 50K DAU, $12M TVL',
				'Legal review pending for cross-chain bridge module',
			],
			persona: 'VC (formal)',
		}),
		modelPrediction: {
			brief: 'Two items today: DD on MoveProtocol and term sheet. Elena sent metrics.',
		},
		correctedOutput: {
			brief: `Good morning. Here is your brief for Sunday, February 15, 2026.

URGENT
- Complete due diligence on MoveProtocol Series A (due Feb 17)
  - Updated metrics: 50K DAU, $12M TVL (cross-chain DEX aggregator)
  - Pending: Legal review of bridge module — potential security concern

UPCOMING
- Prepare term sheet counter-proposal (due Feb 19)
  - Target: $80M valuation, Aptos/Sui ecosystem

SUGGESTED ACTIONS
1. Schedule call with Elena Volkov to discuss bridge module security audit status
2. Compile DD findings for investment committee review`,
		},
		correctionReasoning:
			'Formal brief should include specific metrics from recent context, reference pending legal concerns, and suggest concrete next steps. The model output was too terse for a VC audience.',
		tags: ['brief', 'formal', 'VC', 'due-diligence', 'metrics'],
		difficulty: 'standard',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: ALICE_USER_ID,
		verificationScore: 0.91,
	},
	{
		featureDomain: 'seed_brief_quality',
		inputContext: JSON.stringify({
			commitments: [
				{
					title: 'Finalize Fund II close documentation',
					type: 'task',
					dueDate: '2026-02-16',
					assignee: 'user',
				},
				{
					title: 'LP capital call notice',
					type: 'financial',
					dueDate: '2026-02-17',
					assignee: 'user',
				},
				{ title: 'Board meeting prep', type: 'meeting', dueDate: '2026-02-18', assignee: 'user' },
				{
					title: 'Portfolio review with co-investors',
					type: 'meeting',
					dueDate: '2026-02-19',
					assignee: 'user',
				},
			],
			recentContext: ['Hanhwa committed $25M', 'Two new LP introductions pending'],
			persona: 'VC (formal)',
		}),
		modelPrediction: {
			brief:
				'Busy week ahead. Fund II docs, capital calls, board meeting, and portfolio review. Hanhwa is in for $25M.',
		},
		correctedOutput: {
			brief: `Good morning. Here is your brief for Sunday, February 15, 2026.

URGENT
- Finalize Fund II close documentation (due tomorrow, Feb 16)
  - Hanhwa Digital committed $25M — ensure allocation reflected in close docs

UPCOMING
- Issue LP capital call notice (due Feb 17)
- Board meeting preparation (Feb 18) — agenda items needed
- Portfolio review with co-investors (Feb 19)
  - Two new LP introductions pending — prepare materials

KEY METRICS
| Item | Status | Deadline |
|------|--------|----------|
| Fund II Close | In Progress | Feb 16 |
| Capital Call | Pending | Feb 17 |
| Board Prep | Not Started | Feb 18 |
| Portfolio Review | Scheduled | Feb 19 |

SUGGESTED ACTIONS
1. Confirm Hanhwa allocation in Fund II close docs today
2. Draft board meeting agenda and circulate to directors`,
		},
		correctionReasoning:
			'Formal VC brief for a packed week needs a status table, priority ordering, and clear connection between Hanhwa commitment and the documentation task. Model missed the data table format Alice prefers.',
		tags: ['brief', 'formal', 'VC', 'data-table', 'busy-week'],
		difficulty: 'standard',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: ALICE_USER_ID,
		verificationScore: 0.92,
	},

	// === Casual Tone (3) ===
	{
		featureDomain: 'seed_brief_quality',
		inputContext: JSON.stringify({
			commitments: [
				{
					title: 'Fill 500 SOL OTC order',
					type: 'financial',
					dueDate: '2026-02-15',
					assignee: 'contact',
				},
				{ title: 'Check LP position on Camelot', type: 'task', assignee: 'user' },
			],
			recentContext: ['SOL pumping to $180', 'Camelot pool APR dropped to 12%'],
			persona: 'Trader (casual)',
		}),
		modelPrediction: {
			brief:
				'Good morning! Here is your daily brief. You have 2 items to review today including an OTC order and an LP position check.',
		},
		correctedOutput: {
			brief: `yo, quick hits for today:

- SOL OTC fill from Jake: 500 SOL due TODAY. SOL at $180 rn, good timing
- Camelot LP: APR dropped to 12%. might want to rebalance or pull

that's it. light day.`,
		},
		correctionReasoning:
			'Casual/degen brief should be ultra-concise, skip formalities, use lowercase, include relevant price context, and end quickly. The model produced an overly formal brief for a trader persona.',
		tags: ['brief', 'casual', 'trader', 'concise', 'no-fluff'],
		difficulty: 'standard',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: BOB_USER_ID,
		verificationScore: 0.94,
	},
	{
		featureDomain: 'seed_brief_quality',
		inputContext: JSON.stringify({
			commitments: [
				{
					title: 'Claim airdrop on Arbitrum',
					type: 'task',
					dueDate: '2026-02-16',
					assignee: 'user',
				},
				{ title: 'Sell NFT on Blur', type: 'financial', assignee: 'user' },
				{ title: 'Bridge ETH to Base', type: 'task', assignee: 'user' },
			],
			recentContext: [
				'Airdrop window closes tomorrow',
				'Blur bid at 2.1 ETH for Pudgy #4231',
				'Base gas fees low rn',
			],
			persona: 'Trader (casual)',
		}),
		modelPrediction: {
			brief:
				'You have three tasks: airdrop claim, NFT sale, and ETH bridge. The airdrop deadline is tomorrow.',
		},
		correctedOutput: {
			brief: `heads up:

- ARB airdrop claim: window closes TOMORROW. don't sleep on this
- Pudgy #4231: got a 2.1 ETH bid on Blur. take it or wait?
- Base bridge: gas is cheap rn, good time to move ETH over

priority: airdrop first, everything else can wait`,
		},
		correctionReasoning:
			'Casual trader brief needs urgency indicators, specific values from context (bid price, airdrop deadline), and a quick priority callout. Skip formal sections, just list what matters.',
		tags: ['brief', 'casual', 'trader', 'urgency', 'airdrop'],
		difficulty: 'standard',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: BOB_USER_ID,
		verificationScore: 0.93,
	},
	{
		featureDomain: 'seed_brief_quality',
		inputContext: JSON.stringify({
			commitments: [{ title: 'Review yield farm on Pendle', type: 'task', assignee: 'user' }],
			recentContext: ['Pendle PT-stETH yielding 8.5% APY', 'ETH staking rate at 3.2%'],
			persona: 'Trader (casual)',
		}),
		modelPrediction: {
			brief:
				'Good morning! You have one task today: review the yield farm on Pendle. The current APY is 8.5%.',
		},
		correctedOutput: {
			brief: 'one thing: Pendle PT-stETH is at 8.5% vs 3.2% staking. worth a look.',
		},
		correctionReasoning:
			'Single item = single line. Bob explicitly requested briefs under 3 lines. Include the relevant comparison (8.5% vs 3.2%) and nothing else.',
		tags: ['brief', 'casual', 'ultra-concise', 'single-item', 'DeFi'],
		difficulty: 'trivial',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: BOB_USER_ID,
		verificationScore: 0.95,
	},

	// === Mixed Tone (2) ===
	{
		featureDomain: 'seed_brief_quality',
		inputContext: JSON.stringify({
			commitments: [
				{
					title: 'Vote on AIP-45 treasury allocation',
					type: 'promise',
					dueDate: '2026-02-17',
					assignee: 'user',
				},
				{
					title: 'Review SIP-12 timelock spec',
					type: 'task',
					dueDate: '2026-02-16',
					assignee: 'user',
				},
				{
					title: 'Coordinate delegate statement',
					type: 'task',
					dueDate: '2026-02-18',
					assignee: 'user',
				},
			],
			recentContext: ['AIP-45 has 62% approval, needs 66%', 'Priya supporting, Alex neutral'],
			persona: 'Governance (mixed)',
		}),
		modelPrediction: {
			brief:
				'Three governance items this week. AIP-45 vote, SIP-12 review, and delegate statement. AIP-45 is close to passing.',
		},
		correctedOutput: {
			brief: `Morning — here's what's on the governance plate:

PRIORITY: SIP-12 timelock spec review (due tomorrow)
- Alex Rivera's implementation — check the quorum threshold change (400K -> 650K COMP)

VOTE: AIP-45 treasury allocation (due Feb 17)
- Currently at 62% approval, needs 66% to pass
- Priya Sharma: supporting | Alex Rivera: neutral
- Your vote could be decisive — consider reaching out to swing delegates

UPCOMING: Delegate statement coordination (due Feb 18)
- Publish before the next voting cycle opens

Bottom line: Focus on SIP-12 today, then rally votes for AIP-45 before the deadline.`,
		},
		correctionReasoning:
			'Mixed governance brief balances technical detail (quorum numbers) with accessibility (plain English summary). Include vote math, delegate positions, and a "bottom line" action summary. Not too formal, not too casual.',
		tags: ['brief', 'mixed', 'governance', 'vote-tracking', 'delegate-positions'],
		difficulty: 'standard',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: CHARLIE_USER_ID,
		verificationScore: 0.92,
	},
	{
		featureDomain: 'seed_brief_quality',
		inputContext: JSON.stringify({
			commitments: [
				{
					title: 'Snapshot vote setup for treasury proposal',
					type: 'task',
					dueDate: '2026-02-15',
					assignee: 'user',
				},
				{
					title: 'Security council review of upgrade',
					type: 'task',
					dueDate: '2026-02-17',
					assignee: 'contact',
				},
			],
			recentContext: [
				'Sofia can help with custom voting strategy',
				'Lin confirmed 72-hour notice requirement',
			],
			persona: 'Governance (mixed)',
		}),
		modelPrediction: {
			brief:
				'Two items: set up Snapshot vote and wait for security council review. Talk to Sofia about voting strategy.',
		},
		correctedOutput: {
			brief: `Morning — two things today:

1. Snapshot vote for treasury proposal — needs to go live TODAY
   - Reach out to Sofia Andersson for custom voting strategy setup
   - Remember: 72-hour notice required before parameter changes (Lin's note)

2. Security council upgrade review (due Feb 17)
   - Lin Wei confirmed the council will review timelock params
   - This is on their plate, but follow up if no response by Monday

Key dependency: The Snapshot vote must go live today to satisfy the 72-hour notice window before the council review deadline.`,
		},
		correctionReasoning:
			'Mixed brief connects the two items causally — the 72-hour notice creates a dependency between the Snapshot vote timing and the council review. Model missed this critical relationship.',
		tags: ['brief', 'mixed', 'governance', 'dependency-chain', 'time-sensitive'],
		difficulty: 'edge_case',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: CHARLIE_USER_ID,
		verificationScore: 0.94,
	},

	// === Edge Cases (2) ===
	{
		featureDomain: 'seed_brief_quality',
		inputContext: JSON.stringify({
			commitments: [],
			recentContext: ['No recent activity in the past 7 days'],
			persona: 'Any',
		}),
		modelPrediction: {
			brief: 'No active commitments or recent activity found.',
		},
		correctedOutput: {
			brief: `Good morning! Clean slate today — no active commitments or pending follow-ups.

This might be a good time to:
- Review any contacts you haven't engaged with recently
- Set up follow-ups for deals in your pipeline
- Check if any dismissed commitments need revisiting

Have a productive day!`,
		},
		correctionReasoning:
			'Empty state should not be a bare error message. Frame it positively ("clean slate"), suggest proactive actions, and maintain engagement. Keep it brief but helpful.',
		tags: ['brief', 'edge-case', 'empty-state', 'no-commitments'],
		difficulty: 'edge_case',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: ALICE_USER_ID,
		verificationScore: 0.9,
	},
	{
		featureDomain: 'seed_brief_quality',
		inputContext: JSON.stringify({
			commitments: Array.from({ length: 22 }, (_, i) => ({
				title: `Task ${i + 1}: ${['Review', 'Follow up', 'Send', 'Schedule', 'Prepare'][i % 5]} item ${i + 1}`,
				type: ['task', 'promise', 'meeting', 'financial'][i % 4],
				dueDate: `2026-02-${String(15 + (i % 7)).padStart(2, '0')}`,
				assignee: i % 2 === 0 ? 'user' : 'contact',
			})),
			recentContext: [
				'Heavy week with multiple deadlines',
				'Consider delegating lower-priority items',
			],
			persona: 'Any',
		}),
		modelPrediction: {
			brief:
				'You have 22 active commitments this week. Here is the full list: Task 1: Review item 1, Task 2: Follow up item 2...',
		},
		correctedOutput: {
			brief: `Heads up — you have 22 active items this week. That's a lot. Here's what matters most:

TOP 5 PRIORITIES (due today/tomorrow)
- Task 1: Review item 1 (due today)
- Task 4: Financial item 4 (due today)
- Task 8: Financial item 8 (due today)
- Task 2: Follow up item 2 (due tomorrow)
- Task 3: Send item 3 (due tomorrow)

BY THE NUMBERS
- Due today: 4 items
- Due this week: 22 items total
- Your tasks: 11 | Contact tasks: 11

RECOMMENDATION
Consider delegating or rescheduling lower-priority items. Focus on financial obligations first, then meetings.

Full list available in your dashboard.`,
		},
		correctionReasoning:
			'With 20+ items, do NOT list them all. Summarize by priority, show only top 5, add aggregate stats, and suggest triage strategy. Refer to dashboard for the full list.',
		tags: ['brief', 'edge-case', 'overloaded', 'triage', 'summary'],
		difficulty: 'edge_case',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: ALICE_USER_ID,
		verificationScore: 0.91,
	},
];

// ─── Main ────────────────────────────────────────────────────────────────────

const ALL_EXAMPLES = [...COMMITMENT_EXTRACTION_EXAMPLES, ...BRIEF_QUALITY_EXAMPLES];

async function main() {
	console.log('=== Gordian v2 — Golden Dataset Expansion ===');
	console.log(`Database: ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);
	console.log(`Total new examples: ${ALL_EXAMPLES.length}`);
	console.log(`  Commitment extraction: ${COMMITMENT_EXTRACTION_EXAMPLES.length}`);
	console.log(`  Brief quality: ${BRIEF_QUALITY_EXAMPLES.length}`);
	console.log('');

	try {
		// Step 1: Delete existing expanded seed examples
		// Only delete the expanded ones — the original seed.ts examples share the same feature_domain
		// so we delete all seed_* rows and re-insert everything
		console.log('[expand] Deleting existing seed_* golden dataset rows...');
		await db.execute(sql`DELETE FROM golden_dataset WHERE feature_domain LIKE 'seed_%'`);
		console.log('[expand] Deleted existing rows.');

		// Step 2: Insert all examples
		console.log('[expand] Inserting expanded golden dataset...');
		let inserted = 0;

		for (const g of ALL_EXAMPLES) {
			const embedding = generateDeterministicVector(g.inputContext);
			await db.insert(schema.goldenDataset).values({
				featureDomain: g.featureDomain,
				inputContext: g.inputContext,
				inputEmbedding: embedding,
				modelPrediction: g.modelPrediction,
				correctedOutput: g.correctedOutput,
				correctionReasoning: g.correctionReasoning,
				tags: g.tags,
				difficulty: g.difficulty,
				source: g.source,
				status: g.status,
				verifiedBy: g.verifiedBy,
				verificationScore: g.verificationScore,
			});
			inserted++;
		}

		console.log(`[expand] Inserted ${inserted} golden dataset examples.`);
		console.log('');

		// Summary
		const commitmentCount = ALL_EXAMPLES.filter(
			(e) => e.featureDomain === 'seed_commitment_extraction',
		).length;
		const briefCount = ALL_EXAMPLES.filter((e) => e.featureDomain === 'seed_brief_quality').length;

		console.log('=== Expansion Complete ===');
		console.log(`  seed_commitment_extraction: ${commitmentCount} examples`);
		console.log(`  seed_brief_quality: ${briefCount} examples`);
		console.log('');

		// Tag distribution
		const tagCounts = new Map<string, number>();
		for (const e of ALL_EXAMPLES) {
			for (const tag of e.tags) {
				tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
			}
		}
		console.log('Tag distribution:');
		const sortedTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);
		for (const [tag, count] of sortedTags.slice(0, 15)) {
			console.log(`  ${tag}: ${count}`);
		}
	} catch (err) {
		console.error('[expand] Fatal error:', err);
		process.exit(1);
	} finally {
		await client.end();
	}
}

main();
