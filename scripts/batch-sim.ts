/**
 * Batch Pipeline Simulation
 *
 * Runs N rounds of the full learning pipeline for all 3 users:
 * 1. Generate conversation template
 * 2. Extract commitments (Claude API via bandit)
 * 3. Embed + store (OpenAI API)
 * 4. Generate brief (Claude API via bandit)
 * 5. Auto-score feedback
 * 6. Finalize bandit rewards
 *
 * CLI flags:
 *   --rounds N       Number of rounds per user (default: 10)
 *   --user <name>    alice|bob|charlie|all (default: all)
 *   --cleanup        Delete sim-created rows after summary
 *   --dry-run        Log what would happen without API calls
 *
 * Usage: pnpm tsx scripts/batch-sim.ts --rounds 5
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../.env.local') });

import type { SealedEnvelope } from '@repo/crypto';
import { maskEntities } from '@repo/crypto';
import { createCommitment, db, finalizeBanditReward, getBanditStats, sql } from '@repo/db';
import { extractCommitmentsWithBandit } from '../apps/worker/src/ai/commitment-extraction';
import { generateEmbedding } from '../apps/worker/src/ai/embeddings';
import { generateBriefWithBandit } from '../apps/worker/src/ai/morning-brief';
import { prefilterEntities } from '../apps/worker/src/ai/prefilter';

// ─── CLI Argument Parsing ────────────────────────────────────────────────────

function parseArgs(): {
	rounds: number;
	userFilter: 'alice' | 'bob' | 'charlie' | 'all';
	cleanup: boolean;
	dryRun: boolean;
} {
	const args = process.argv.slice(2);
	let rounds = 10;
	let userFilter: 'alice' | 'bob' | 'charlie' | 'all' = 'all';
	let cleanup = false;
	let dryRun = false;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--rounds' && args[i + 1]) {
			rounds = Number.parseInt(args[i + 1], 10);
			i++;
		} else if (args[i] === '--user' && args[i + 1]) {
			const val = args[i + 1].toLowerCase();
			if (val === 'alice' || val === 'bob' || val === 'charlie' || val === 'all') {
				userFilter = val;
			}
			i++;
		} else if (args[i] === '--cleanup') {
			cleanup = true;
		} else if (args[i] === '--dry-run') {
			dryRun = true;
		}
	}

	return { rounds, userFilter, cleanup, dryRun };
}

// ─── Deterministic UUIDs (same as seed.ts) ───────────────────────────────────

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

// ─── User Definitions ────────────────────────────────────────────────────────

interface UserProfile {
	name: string;
	userId: string;
	workspaceId: string;
	contactId: string;
	tonePreference: 'formal' | 'casual' | 'random';
	detailPreference: 'high' | 'low' | 'random';
}

const USERS: Record<string, UserProfile> = {
	alice: {
		name: 'VC Alice',
		userId: deterministicUUID('alice'),
		workspaceId: deterministicUUID('alice-workspace'),
		contactId: deterministicUUID('alice-contact-aptos-fund'),
		tonePreference: 'formal',
		detailPreference: 'high',
	},
	bob: {
		name: 'Degen Bob',
		userId: deterministicUUID('bob'),
		workspaceId: deterministicUUID('bob-workspace'),
		contactId: deterministicUUID('bob-contact-otc-desk'),
		tonePreference: 'casual',
		detailPreference: 'low',
	},
	charlie: {
		name: 'Governance Charlie',
		userId: deterministicUUID('charlie'),
		workspaceId: deterministicUUID('charlie-workspace'),
		contactId: deterministicUUID('charlie-contact-dao-delegate'),
		tonePreference: 'random',
		detailPreference: 'random',
	},
};

// ─── Conversation Templates (30 total, 10 per persona) ──────────────────────

interface ConversationTemplate {
	persona: string;
	topic: string;
	messages: Array<{ role: string; content: string }>;
}

const ALICE_TEMPLATES: ConversationTemplate[] = [
	{
		persona: 'alice',
		topic: 'SAFT negotiation',
		messages: [
			{
				role: 'user',
				content:
					'Marcus, the SAFT terms look good overall but we need to revise the cliff period from 6 to 12 months. I will send the revised draft by end of day.',
			},
			{
				role: 'assistant',
				content:
					'Understood. I also need you to confirm the investor accreditation status for the offshore participants by Wednesday.',
			},
		],
	},
	{
		persona: 'alice',
		topic: 'LP update',
		messages: [
			{
				role: 'user',
				content:
					'David from Hanhwa wants the Q4 portfolio performance report. I promised to deliver it with the full NAV breakdown by Friday.',
			},
			{
				role: 'assistant',
				content:
					'He also asked about increasing allocation to the Move ecosystem. Should I schedule a call for next week?',
			},
		],
	},
	{
		persona: 'alice',
		topic: 'Due diligence',
		messages: [
			{
				role: 'user',
				content:
					'Elena shared the MoveProtocol metrics: 50K DAU, $12M TVL. I will run our standard DD checklist and prepare the IC memo by Monday.',
			},
			{
				role: 'assistant',
				content:
					'The technical audit from Trail of Bits is expected next Thursday. We should wait for that before finalizing our position.',
			},
		],
	},
	{
		persona: 'alice',
		topic: 'Portfolio review',
		messages: [
			{
				role: 'user',
				content:
					'Three of our portfolio companies need follow-up this week: SuiSwap (token launch delay), AptosLend (Series B prep), and MoveBridge (security incident). I will prioritize the MoveBridge situation.',
			},
			{
				role: 'assistant',
				content: 'Agreed. The MoveBridge team promised to deliver the post-mortem by Wednesday.',
			},
		],
	},
	{
		persona: 'alice',
		topic: 'Term sheet',
		messages: [
			{
				role: 'user',
				content:
					'We are offering $5M at $80M pre-money for Series A. I need to prepare the term sheet and send it to Sarah for legal review by tomorrow.',
			},
			{
				role: 'assistant',
				content:
					'Sarah mentioned she can turn around the review in 48 hours if we get it to her today.',
			},
		],
	},
	{
		persona: 'alice',
		topic: 'Tokenomics review',
		messages: [
			{
				role: 'user',
				content:
					'The token allocation model needs adjustment. Team allocation is 22%, which exceeds our 20% guideline. I will ask the founders to revise to 18% with a longer vest.',
			},
			{
				role: 'assistant',
				content:
					'Good call. Also, the community allocation should be increased to compensate. Elena will update the model by Friday.',
			},
		],
	},
	{
		persona: 'alice',
		topic: 'Regulatory call',
		messages: [
			{
				role: 'user',
				content:
					'The SEC guidance on token classifications is coming out next month. I will schedule a call with our compliance team to review implications for Fund II.',
			},
			{
				role: 'assistant',
				content:
					'Sarah recommends we also consult with outside counsel on the Reg D filing timeline.',
			},
		],
	},
	{
		persona: 'alice',
		topic: 'Co-investment',
		messages: [
			{
				role: 'user',
				content:
					'Paradigm is leading the round and offered us co-invest rights. I will confirm our $2M allocation and send the side letter by Thursday.',
			},
			{
				role: 'assistant',
				content:
					'Marcus needs to countersign. He said he can do it by Friday if we get it to him early Thursday.',
			},
		],
	},
	{
		persona: 'alice',
		topic: 'Exit planning',
		messages: [
			{
				role: 'user',
				content:
					'The Binance listing discussions are progressing. The team will submit the application next week. I need to prepare the liquidity plan and token distribution schedule.',
			},
			{
				role: 'assistant',
				content:
					'We should also coordinate with the market maker. I will reach out to Wintermute for a quote by Wednesday.',
			},
		],
	},
	{
		persona: 'alice',
		topic: 'Fund operations',
		messages: [
			{
				role: 'user',
				content:
					'Management fee calculation for Q1 is due. I will prepare the fee notice and distribute it to LPs by the 15th. Also need to update the GP commitment tracking.',
			},
			{
				role: 'assistant',
				content:
					'David asked if we can switch to quarterly distributions instead of annual. I will draft the LPA amendment for review.',
			},
		],
	},
];

const BOB_TEMPLATES: ConversationTemplate[] = [
	{
		persona: 'bob',
		topic: 'OTC fill',
		messages: [
			{
				role: 'user',
				content:
					'Jake, need 200 ETH OTC at market. Can you fill by 3pm UTC? Settlement to the usual wallet.',
			},
			{
				role: 'assistant',
				content:
					'Quoted at $3,180 per ETH. I will have the fill confirmed within the hour. Send wallet address when ready.',
			},
		],
	},
	{
		persona: 'bob',
		topic: 'Memecoin alpha',
		messages: [
			{
				role: 'user',
				content:
					'Anon just tipped me on a new Solana memecoin launching tonight. Dev is doxxed, liquidity locked for 6 months. I will ape in with 10 SOL at launch.',
			},
			{
				role: 'assistant',
				content:
					'Be careful fren, last three launches all rugged. But if the liquidity is actually locked, could be a play.',
			},
		],
	},
	{
		persona: 'bob',
		topic: 'NFT flip',
		messages: [
			{
				role: 'user',
				content:
					'Pixel just swept 5 Pudgy Penguins below floor. Smart money is accumulating. I will list my 2 for 20% above floor tomorrow if the momentum continues.',
			},
			{
				role: 'assistant',
				content:
					'Floor moved from 8.5 to 9.2 ETH in the last hour. Whale wallet still buying. Could run more.',
			},
		],
	},
	{
		persona: 'bob',
		topic: 'LP position',
		messages: [
			{
				role: 'user',
				content:
					'The ETH/USDC pool on Uniswap is showing 45% APR with the incentives. I will add another $50K in concentrated liquidity in the $3,000-$3,400 range tonight.',
			},
			{
				role: 'assistant',
				content:
					'Yuki says the IL risk is manageable in that range. She will adjust her position too after the fee tier analysis.',
			},
		],
	},
	{
		persona: 'bob',
		topic: 'Yield farming',
		messages: [
			{
				role: 'user',
				content:
					'The Pendle PT-stETH pool is paying 8.5% APY with no IL risk. I will move 100 ETH from Aave to Pendle by end of day.',
			},
			{
				role: 'assistant',
				content: 'Make sure to check the maturity date. The March expiry might have better rates.',
			},
		],
	},
	{
		persona: 'bob',
		topic: 'Airdrop hunting',
		messages: [
			{
				role: 'user',
				content:
					'LayerZero airdrop criteria just leaked: need 50+ cross-chain txns. I will bridge across 5 chains today to qualify. Already have 30 txns.',
			},
			{
				role: 'assistant',
				content:
					"Don't forget to do some volume on Stargate too. That's their main product. I will send you the optimal route.",
			},
		],
	},
	{
		persona: 'bob',
		topic: 'Degen play',
		messages: [
			{
				role: 'user',
				content:
					'Just spotted a basis trade opportunity: perp funding is -0.05% while spot is flat. I will open a 10x long perp and short spot for the funding arb. $100K position.',
			},
			{
				role: 'assistant',
				content:
					'Careful with the leverage, last time funding flipped fast. Set a stop at 2% drawdown.',
			},
		],
	},
	{
		persona: 'bob',
		topic: 'Whale watching',
		messages: [
			{
				role: 'user',
				content:
					'Whale 0xd8dA just deposited 50K ETH to Coinbase. Might be a sell signal. I will reduce my ETH exposure by 20% if we break $3,100 support.',
			},
			{
				role: 'assistant',
				content:
					'Could also be a custody move. But better safe than sorry. I will set the limit orders now.',
			},
		],
	},
	{
		persona: 'bob',
		topic: 'Arbitrage',
		messages: [
			{
				role: 'user',
				content:
					'USDC is trading at $1.002 on Curve and $0.998 on Binance. Classic arb opportunity. I will execute $500K in circular trades tonight.',
			},
			{
				role: 'assistant',
				content:
					'Gas is at 15 gwei, good time. The spread should be enough after fees. I will prep the swap routes.',
			},
		],
	},
	{
		persona: 'bob',
		topic: 'Market analysis',
		messages: [
			{
				role: 'user',
				content:
					'BTC dominance is at 55% and climbing. Historically that means alt season is coming when it peaks. I will start accumulating L2 tokens: ARB, OP, and MATIC. Target $200K total allocation.',
			},
			{
				role: 'assistant',
				content:
					'Good thesis. Jake can fill the ARB and OP OTC. For MATIC we might need to go on-chain.',
			},
		],
	},
];

const CHARLIE_TEMPLATES: ConversationTemplate[] = [
	{
		persona: 'charlie',
		topic: 'Proposal drafting',
		messages: [
			{
				role: 'user',
				content:
					'I need to draft AIP-46 for the community treasury allocation. Proposing $5M for ecosystem grants over 6 months. I will have the draft ready for review by Thursday.',
			},
			{
				role: 'assistant',
				content:
					'Priya suggested including a milestone-based disbursement schedule. Good idea to prevent front-loading.',
			},
		],
	},
	{
		persona: 'charlie',
		topic: 'Delegate coordination',
		messages: [
			{
				role: 'user',
				content:
					'We need 5 more delegates supporting AIP-45 to reach quorum. I will personally reach out to the top 10 delegates this week. Priya already committed her 5M ARB.',
			},
			{
				role: 'assistant',
				content:
					'Two delegates are on the fence. If you can address their concerns about the vesting schedule, they might flip.',
			},
		],
	},
	{
		persona: 'charlie',
		topic: 'Snapshot vote',
		messages: [
			{
				role: 'user',
				content:
					'The Snapshot vote for the treasury diversification needs to go live today. Sofia is helping with the custom quadratic voting strategy. I will finalize the parameters by noon.',
			},
			{
				role: 'assistant',
				content:
					'Remember the 72-hour voting window. If we launch today, results will be in by Friday.',
			},
		],
	},
	{
		persona: 'charlie',
		topic: 'Security council',
		messages: [
			{
				role: 'user',
				content:
					'Lin confirmed the Security Council will review the timelock parameters. I need to prepare the technical specification document and submit it by Monday.',
			},
			{
				role: 'assistant',
				content:
					'The council has a 48-hour SLA for critical reviews. Make sure to flag this as priority.',
			},
		],
	},
	{
		persona: 'charlie',
		topic: 'Timelock upgrade',
		messages: [
			{
				role: 'user',
				content:
					'Alex submitted the SIP-12 spec for the timelock upgrade. I will review the quorum threshold change from 400K to 650K COMP and provide feedback by Wednesday.',
			},
			{
				role: 'assistant',
				content:
					'The community is split on this. Some think 650K is too high and will slow down governance. We should address that in the forum post.',
			},
		],
	},
	{
		persona: 'charlie',
		topic: 'Quorum changes',
		messages: [
			{
				role: 'user',
				content:
					'Current quorum is only being met on 60% of votes. I will propose a dynamic quorum model that adjusts based on participation rates. Draft by next Monday.',
			},
			{
				role: 'assistant',
				content:
					'Compound and Uniswap both tried this. I will compile their results and lessons learned for your draft.',
			},
		],
	},
	{
		persona: 'charlie',
		topic: 'Treasury management',
		messages: [
			{
				role: 'user',
				content:
					'The DAO treasury has $50M in stablecoins earning nothing. I will propose allocating 30% to low-risk DeFi strategies: Aave lending and Maker DSR.',
			},
			{
				role: 'assistant',
				content:
					'Good timing. Maker DSR is at 5% and Aave USDC is at 3.8%. I will prepare the risk analysis for the proposal.',
			},
		],
	},
	{
		persona: 'charlie',
		topic: 'Grants program',
		messages: [
			{
				role: 'user',
				content:
					'We received 47 grant applications this cycle. I will review and shortlist the top 10 by Friday. Each grant is capped at $100K.',
			},
			{
				role: 'assistant',
				content:
					'Priya offered to help with the technical review of the DeFi applications. She will complete her reviews by Thursday.',
			},
		],
	},
	{
		persona: 'charlie',
		topic: 'Retroactive funding',
		messages: [
			{
				role: 'user',
				content:
					'Three contributors deserve retroactive funding for their governance tooling work. I will draft the retro funding proposal with specific amounts and impact metrics.',
			},
			{
				role: 'assistant',
				content:
					'Sofia built the Snapshot analytics dashboard — she should definitely be included. I will gather usage stats to support the case.',
			},
		],
	},
	{
		persona: 'charlie',
		topic: 'Protocol upgrade',
		messages: [
			{
				role: 'user',
				content:
					'The v2 to v3 migration plan needs community approval. I will prepare the migration guide and host a governance call next Wednesday to walk delegates through the changes.',
			},
			{
				role: 'assistant',
				content:
					'Alex can present the technical details. He will prepare the architecture comparison slides by Tuesday.',
			},
		],
	},
];

const TEMPLATES_BY_PERSONA: Record<string, ConversationTemplate[]> = {
	alice: ALICE_TEMPLATES,
	bob: BOB_TEMPLATES,
	charlie: CHARLIE_TEMPLATES,
};

// ─── Tracking ────────────────────────────────────────────────────────────────

const createdCommitmentIds: string[] = [];
const createdBanditTraceIds: string[] = [];

// ─── Simulation Round ────────────────────────────────────────────────────────

interface RoundResult {
	user: string;
	round: number;
	topic: string;
	extractionVariant: string;
	extractionTraceId: string;
	commitmentsFound: number;
	toneVariant: string;
	detailVariant: string;
	toneTraceId: string;
	detailTraceId: string;
	extractionReward: number;
	toneReward: number;
	detailReward: number;
}

async function runRound(
	user: UserProfile,
	round: number,
	template: ConversationTemplate,
	envelope: SealedEnvelope,
	dryRun: boolean,
): Promise<RoundResult> {
	const now = new Date().toISOString();
	const messages = template.messages.map((m) => ({
		...m,
		timestamp: now,
	}));

	if (dryRun) {
		return {
			user: user.name,
			round,
			topic: template.topic,
			extractionVariant: 'extraction_default (dry-run)',
			extractionTraceId: 'dry-run',
			commitmentsFound: 0,
			toneVariant: 'brief_tone_formal (dry-run)',
			detailVariant: 'brief_detail_high (dry-run)',
			toneTraceId: 'dry-run',
			detailTraceId: 'dry-run',
			extractionReward: 0,
			toneReward: 0,
			detailReward: 0,
		};
	}

	// 1. Extract commitments with bandit
	const extractResult = await extractCommitmentsWithBandit(messages, now, user.userId);
	createdBanditTraceIds.push(extractResult.traceId);

	// 2. Embed + store commitments
	for (const commitment of extractResult.commitments) {
		if (commitment.confidence <= 0.5) continue;

		const salt = Buffer.from(user.workspaceId);
		const entities = prefilterEntities(commitment.title);
		const { maskedText } = maskEntities(commitment.title, salt, entities);
		const embedding = await generateEmbedding(maskedText);

		const stored = await createCommitment(
			user.workspaceId,
			{
				contactId: user.contactId,
				title: commitment.title,
				commitmentType: commitment.commitment_type,
				assignee: commitment.assignee,
				confidence: commitment.confidence,
				dueDate: commitment.due_date ? new Date(commitment.due_date) : undefined,
				quote: commitment.quote,
				embedding,
				banditTraceId: extractResult.traceId,
			},
			envelope,
		);

		if (stored) {
			createdCommitmentIds.push(stored.id);
		}
	}

	// 3. Generate brief with bandit
	const briefResult = await generateBriefWithBandit(user.userId, user.workspaceId, envelope);
	createdBanditTraceIds.push(briefResult.toneTraceId, briefResult.detailTraceId);

	// 4. Auto-score feedback
	const avgConfidence =
		extractResult.commitments.length > 0
			? extractResult.commitments.reduce((sum, c) => sum + c.confidence, 0) /
				extractResult.commitments.length
			: 0;
	const extractionReward = avgConfidence > 0.7 ? 1.0 : 0.0;

	let toneReward: number;
	if (user.tonePreference === 'random') {
		toneReward = Math.random() > 0.5 ? 1.0 : 0.0;
	} else {
		const preferredTone = `brief_tone_${user.tonePreference}`;
		toneReward = briefResult.toneVariant === preferredTone ? 1.0 : 0.0;
	}

	let detailReward: number;
	if (user.detailPreference === 'random') {
		detailReward = Math.random() > 0.5 ? 1.0 : 0.0;
	} else {
		const preferredDetail = `brief_detail_${user.detailPreference}`;
		detailReward = briefResult.detailVariant === preferredDetail ? 1.0 : 0.0;
	}

	// 5. Finalize rewards
	await finalizeBanditReward(extractResult.traceId, extractionReward);
	await finalizeBanditReward(briefResult.toneTraceId, toneReward);
	await finalizeBanditReward(briefResult.detailTraceId, detailReward);

	return {
		user: user.name,
		round,
		topic: template.topic,
		extractionVariant: extractResult.variant,
		extractionTraceId: extractResult.traceId,
		commitmentsFound: extractResult.commitments.length,
		toneVariant: briefResult.toneVariant,
		detailVariant: briefResult.detailVariant,
		toneTraceId: briefResult.toneTraceId,
		detailTraceId: briefResult.detailTraceId,
		extractionReward,
		toneReward,
		detailReward,
	};
}

// ─── Convergence Table ───────────────────────────────────────────────────────

interface StatsSnapshot {
	promptVariant: string;
	alphaScore: number;
	betaScore: number;
}

function printConvergenceTable(userLabel: string, before: StatsSnapshot[], after: StatsSnapshot[]) {
	const allVariants = new Set([
		...before.map((s) => s.promptVariant),
		...after.map((s) => s.promptVariant),
	]);

	const variantWidth = 26;
	const colWidth = 16;

	const header = `${'Variant'.padEnd(variantWidth)}${'Before (a/b)'.padEnd(colWidth)}${'After (a/b)'.padEnd(colWidth)}Delta`;
	const sep = '-'.repeat(header.length + 10);

	console.log(`\n  ${userLabel}:`);
	console.log(`  ${sep}`);
	console.log(`  ${header}`);
	console.log(`  ${sep}`);

	for (const variant of [...allVariants].sort()) {
		const b = before.find((s) => s.promptVariant === variant);
		const a = after.find((s) => s.promptVariant === variant);

		const bAlpha = b?.alphaScore ?? 1;
		const bBeta = b?.betaScore ?? 1;
		const aAlpha = a?.alphaScore ?? 1;
		const aBeta = a?.betaScore ?? 1;

		const bStr = `${bAlpha.toFixed(1)}/${bBeta.toFixed(1)}`;
		const aStr = `${aAlpha.toFixed(1)}/${aBeta.toFixed(1)}`;
		const deltaAlpha = aAlpha - bAlpha;
		const deltaBeta = aBeta - bBeta;
		const deltaStr = `a${deltaAlpha >= 0 ? '+' : ''}${deltaAlpha.toFixed(1)} b${deltaBeta >= 0 ? '+' : ''}${deltaBeta.toFixed(1)}`;

		console.log(
			`  ${variant.padEnd(variantWidth)}${bStr.padEnd(colWidth)}${aStr.padEnd(colWidth)}${deltaStr}`,
		);
	}
	console.log(`  ${sep}`);
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

async function cleanup() {
	console.log('\n[cleanup] Deleting simulation-created rows...');

	if (createdCommitmentIds.length > 0) {
		for (const id of createdCommitmentIds) {
			await db.execute(sql`DELETE FROM commitments WHERE id = ${id}::uuid`);
		}
		console.log(`  Deleted ${createdCommitmentIds.length} commitments`);
	}

	if (createdBanditTraceIds.length > 0) {
		for (const id of createdBanditTraceIds) {
			await db.execute(sql`DELETE FROM bandit_ledger WHERE trace_id = ${id}::uuid`);
		}
		console.log(`  Deleted ${createdBanditTraceIds.length} bandit traces`);
	}

	console.log('  Cleanup complete.');
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
	const { rounds, userFilter, cleanup: doCleanup, dryRun } = parseArgs();

	console.log('=== Gordian v2 — Batch Pipeline Simulation ===');
	console.log(`ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? 'set' : 'MISSING'}`);
	console.log(`OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? 'set' : 'MISSING'}`);
	console.log('');
	console.log(`Rounds per user: ${rounds}`);
	console.log(`User filter: ${userFilter}`);
	console.log(`Cleanup after: ${doCleanup}`);
	console.log(`Dry run: ${dryRun}`);
	console.log('');

	if (!dryRun) {
		if (!process.env.ANTHROPIC_API_KEY) {
			console.error('ERROR: ANTHROPIC_API_KEY must be set');
			process.exit(1);
		}
		if (!process.env.OPENAI_API_KEY) {
			console.error('ERROR: OPENAI_API_KEY must be set');
			process.exit(1);
		}
	}

	// Determine which users to simulate
	const userKeys = userFilter === 'all' ? ['alice', 'bob', 'charlie'] : [userFilter];

	try {
		// Snapshot bandit stats before
		const statsBefore = new Map<string, StatsSnapshot[]>();
		for (const key of userKeys) {
			const user = USERS[key];
			const stats = await getBanditStats(user.userId);
			statsBefore.set(key, stats);
			console.log(`[before] ${user.name}: ${stats.length} variant stats`);
		}

		// Build envelopes
		const envelopes = new Map<string, SealedEnvelope>();
		for (const key of userKeys) {
			const user = USERS[key];
			const wsResult = await db.execute(
				sql`SELECT encrypted_wrk, kms_context, wrk_version FROM workspaces WHERE id = ${user.workspaceId}`,
			);
			const ws = (
				wsResult as unknown as Array<{
					encrypted_wrk: string;
					kms_context: Record<string, string>;
					wrk_version: number;
				}>
			)[0];

			if (!ws) {
				console.error(`Workspace ${user.workspaceId} not found for ${user.name} — run seed first`);
				process.exit(1);
			}

			envelopes.set(key, {
				encryptedWrk: Buffer.from(ws.encrypted_wrk, 'base64'),
				kmsContext: ws.kms_context,
				wrkVersion: ws.wrk_version,
			});
		}

		console.log('');

		// Run rounds
		const results: RoundResult[] = [];
		let totalRounds = 0;

		for (let r = 0; r < rounds; r++) {
			for (const key of userKeys) {
				const user = USERS[key];
				const templates = TEMPLATES_BY_PERSONA[key];
				const template = templates[r % templates.length];
				const envelope = envelopes.get(key);

				if (!envelope) continue;

				totalRounds++;
				console.log(
					`[round ${r + 1}/${rounds}] ${user.name} — ${template.topic}${dryRun ? ' (dry-run)' : ''}`,
				);

				const result = await runRound(user, r + 1, template, envelope, dryRun);
				results.push(result);

				if (!dryRun) {
					console.log(
						`  extraction=${result.extractionVariant} (${result.commitmentsFound} found, reward=${result.extractionReward})`,
					);
					console.log(
						`  tone=${result.toneVariant} (reward=${result.toneReward}) detail=${result.detailVariant} (reward=${result.detailReward})`,
					);
				}
			}
		}

		console.log(`\n[summary] Completed ${totalRounds} rounds`);

		// Snapshot bandit stats after
		const statsAfter = new Map<string, StatsSnapshot[]>();
		for (const key of userKeys) {
			const user = USERS[key];
			const stats = await getBanditStats(user.userId);
			statsAfter.set(key, stats);
		}

		// Print convergence tables
		console.log('\n=== Convergence Results ===');
		for (const key of userKeys) {
			const user = USERS[key];
			const before = statsBefore.get(key) ?? [];
			const after = statsAfter.get(key) ?? [];
			printConvergenceTable(user.name, before, after);
		}

		// Print round summary
		console.log('\n=== Round Details ===');
		for (const r of results) {
			const rewards = dryRun
				? '(dry-run)'
				: `ext=${r.extractionReward} tone=${r.toneReward} detail=${r.detailReward}`;
			console.log(
				`  ${r.user.padEnd(22)} R${String(r.round).padStart(2)} ${r.topic.padEnd(24)} ${rewards}`,
			);
		}

		// Aggregate stats
		if (!dryRun && results.length > 0) {
			const avgExtReward = results.reduce((s, r) => s + r.extractionReward, 0) / results.length;
			const avgToneReward = results.reduce((s, r) => s + r.toneReward, 0) / results.length;
			const avgDetailReward = results.reduce((s, r) => s + r.detailReward, 0) / results.length;

			console.log('\n=== Aggregate Rewards ===');
			console.log(`  Extraction: ${(avgExtReward * 100).toFixed(1)}% positive`);
			console.log(`  Tone match: ${(avgToneReward * 100).toFixed(1)}% aligned with preference`);
			console.log(`  Detail match: ${(avgDetailReward * 100).toFixed(1)}% aligned with preference`);
		}

		// Cleanup if requested
		if (doCleanup) {
			await cleanup();
		}

		console.log('\n=== Batch Simulation Complete ===\n');
	} catch (err) {
		console.error('\n=== Batch Simulation FAILED ===');
		console.error(err);

		if (doCleanup) {
			try {
				await cleanup();
			} catch {
				console.error('Cleanup also failed');
			}
		}

		process.exit(1);
	}
}

main();
