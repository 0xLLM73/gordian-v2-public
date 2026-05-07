/**
 * Golden Seed Script for Gordian v2
 *
 * Populates the database with causally coherent Web3 CRM test data
 * to validate recursive learning features (Thompson Sampling, hybrid search,
 * morning briefs, commitment extraction, prompt caching).
 *
 * 3 personas: VC Alice (formal), Degen Bob (casual), Governance Charlie (mixed)
 * Idempotent: cleans and re-seeds on every run.
 *
 * Usage: pnpm tsx scripts/seed.ts
 */

import { createHash, randomBytes } from 'node:crypto';
import { deriveKeys, keyStore } from '@repo/crypto';
import { hashPassword } from 'better-auth/crypto';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../packages/db/src/schema/index';
import { loadRootEnv } from './lib/load-root-env.mjs';

loadRootEnv();

// ─── Config ──────────────────────────────────────────────────────────────────

const DATABASE_URL =
	process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/gordian_dev';

const client = postgres(DATABASE_URL, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

// ─── Deterministic Mock Embedding Generator ──────────────────────────────────

function generateDeterministicVector(text: string, dim: 512 | 1536): number[] {
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

// ─── Entity Masking (simplified for seed) ────────────────────────────────────

function maskContent(raw: string): string {
	return raw
		.replace(/0x[a-fA-F0-9]{40}/g, '[ETH_ADDRESS]')
		.replace(/[13][a-km-zA-HJ-NP-Z1-9]{25,34}/g, '[BTC_ADDRESS]')
		.replace(/@[a-zA-Z0-9_]{5,}/g, '[TG_HANDLE]')
		.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[PHONE]')
		.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]');
}

// ─── Fixed UUIDs for idempotency ─────────────────────────────────────────────

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

// SAFETY: These IDs are interpolated via sql.raw() in cleanup queries below.
// They are derived from compile-time string constants — never from external input.
const ALICE_USER_ID = deterministicUUID('alice');
const BOB_USER_ID = deterministicUUID('bob');
const CHARLIE_USER_ID = deterministicUUID('charlie');

const ALICE_WORKSPACE_ID = deterministicUUID('alice-workspace');
const BOB_WORKSPACE_ID = deterministicUUID('bob-workspace');
const CHARLIE_WORKSPACE_ID = deterministicUUID('charlie-workspace');

// Contact IDs (per workspace)
const ALICE_CONTACTS = {
	aptosFund: deterministicUUID('alice-contact-aptos-fund'),
	saftLawyer: deterministicUUID('alice-contact-saft-lawyer'),
	lpPartner: deterministicUUID('alice-contact-lp-partner'),
	tokenProject: deterministicUUID('alice-contact-token-project'),
};

const BOB_CONTACTS = {
	otcDesk: deterministicUUID('bob-contact-otc-desk'),
	degenFriend: deterministicUUID('bob-contact-degen-friend'),
	nftTrader: deterministicUUID('bob-contact-nft-trader'),
	liquidityProvider: deterministicUUID('bob-contact-liquidity'),
};

const CHARLIE_CONTACTS = {
	daoDelegate: deterministicUUID('charlie-contact-dao-delegate'),
	protocolDev: deterministicUUID('charlie-contact-protocol-dev'),
	governanceCouncil: deterministicUUID('charlie-contact-governance'),
	snapshotAdmin: deterministicUUID('charlie-contact-snapshot'),
};

// ─── Dev WRK (bypasses KMS for local development) ────────────────────────────

const DEV_WRK = randomBytes(32);
const DEV_WRK_BASE64 = DEV_WRK.toString('base64');

async function withDevKeys<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
	const keys = await deriveKeys(DEV_WRK, workspaceId, 1);
	return keyStore.run(keys, fn);
}

// ─── Step 1: Clean slate ─────────────────────────────────────────────────────

async function cleanDatabase() {
	console.log('[seed] Cleaning existing seed data...');
	// Delete in dependency order
	await db.execute(
		sql`DELETE FROM bandit_ledger WHERE user_id IN (${sql.raw(`'${ALICE_USER_ID}','${BOB_USER_ID}','${CHARLIE_USER_ID}'`)})`,
	);
	await db.execute(
		sql`DELETE FROM golden_dataset WHERE verified_by IN (${sql.raw(`'${ALICE_USER_ID}','${BOB_USER_ID}','${CHARLIE_USER_ID}'`)}) OR verified_by IS NULL AND feature_domain LIKE 'seed_%'`,
	);
	await db.execute(
		sql`DELETE FROM causal_edges WHERE source_id IN (SELECT id FROM user_decisions WHERE workspace_id IN (${sql.raw(`'${ALICE_WORKSPACE_ID}','${BOB_WORKSPACE_ID}','${CHARLIE_WORKSPACE_ID}'`)}))`,
	);
	await db.execute(
		sql`DELETE FROM user_decisions WHERE workspace_id IN (${sql.raw(`'${ALICE_WORKSPACE_ID}','${BOB_WORKSPACE_ID}','${CHARLIE_WORKSPACE_ID}'`)})`,
	);
	await db.execute(
		sql`DELETE FROM deals WHERE workspace_id IN (${sql.raw(`'${ALICE_WORKSPACE_ID}','${BOB_WORKSPACE_ID}','${CHARLIE_WORKSPACE_ID}'`)})`,
	);
	await db.execute(
		sql`DELETE FROM commitments WHERE workspace_id IN (${sql.raw(`'${ALICE_WORKSPACE_ID}','${BOB_WORKSPACE_ID}','${CHARLIE_WORKSPACE_ID}'`)})`,
	);
	await db.execute(
		sql`DELETE FROM memories WHERE workspace_id IN (${sql.raw(`'${ALICE_WORKSPACE_ID}','${BOB_WORKSPACE_ID}','${CHARLIE_WORKSPACE_ID}'`)})`,
	);
	await db.execute(
		sql`DELETE FROM contacts WHERE workspace_id IN (${sql.raw(`'${ALICE_WORKSPACE_ID}','${BOB_WORKSPACE_ID}','${CHARLIE_WORKSPACE_ID}'`)})`,
	);
	await db.execute(
		sql`DELETE FROM workspace_members WHERE workspace_id IN (${sql.raw(`'${ALICE_WORKSPACE_ID}','${BOB_WORKSPACE_ID}','${CHARLIE_WORKSPACE_ID}'`)})`,
	);
	await db.execute(
		sql`DELETE FROM workspaces WHERE id IN (${sql.raw(`'${ALICE_WORKSPACE_ID}','${BOB_WORKSPACE_ID}','${CHARLIE_WORKSPACE_ID}'`)})`,
	);
	await db.execute(
		sql`DELETE FROM accounts WHERE user_id IN (${sql.raw(`'${ALICE_USER_ID}','${BOB_USER_ID}','${CHARLIE_USER_ID}'`)})`,
	);
	await db.execute(
		sql`DELETE FROM sessions WHERE user_id IN (${sql.raw(`'${ALICE_USER_ID}','${BOB_USER_ID}','${CHARLIE_USER_ID}'`)})`,
	);
	await db.execute(
		sql`DELETE FROM users WHERE id IN (${sql.raw(`'${ALICE_USER_ID}','${BOB_USER_ID}','${CHARLIE_USER_ID}'`)})`,
	);
	console.log('[seed] Clean complete.');
}

// ─── Step 2: Users & Workspaces ──────────────────────────────────────────────

async function seedUsersAndWorkspaces() {
	console.log('[seed] Creating users...');

	const userRows = [
		{ id: ALICE_USER_ID, email: 'alice@gordian.dev', name: 'VC Alice', emailVerified: true },
		{ id: BOB_USER_ID, email: 'bob@gordian.dev', name: 'Degen Bob', emailVerified: true },
		{
			id: CHARLIE_USER_ID,
			email: 'charlie@gordian.dev',
			name: 'Governance Charlie',
			emailVerified: true,
		},
	];

	for (const u of userRows) {
		await db.insert(schema.users).values(u).onConflictDoNothing();
	}

	console.log('[seed] Creating workspaces...');

	const workspaceRows = [
		{
			id: ALICE_WORKSPACE_ID,
			name: 'Alice Capital',
			ownerId: ALICE_USER_ID,
			encryptedWrk: DEV_WRK_BASE64,
			kmsContext: { WorkspaceID: ALICE_WORKSPACE_ID },
			wrkVersion: 1,
		},
		{
			id: BOB_WORKSPACE_ID,
			name: 'Bob Trading',
			ownerId: BOB_USER_ID,
			encryptedWrk: DEV_WRK_BASE64,
			kmsContext: { WorkspaceID: BOB_WORKSPACE_ID },
			wrkVersion: 1,
		},
		{
			id: CHARLIE_WORKSPACE_ID,
			name: 'Charlie DAO',
			ownerId: CHARLIE_USER_ID,
			encryptedWrk: DEV_WRK_BASE64,
			kmsContext: { WorkspaceID: CHARLIE_WORKSPACE_ID },
			wrkVersion: 1,
		},
	];

	for (const ws of workspaceRows) {
		await db.insert(schema.workspaces).values(ws).onConflictDoNothing();
	}

	console.log('[seed] Creating workspace members...');

	const memberRows = [
		{ workspaceId: ALICE_WORKSPACE_ID, userId: ALICE_USER_ID, role: 'owner' as const },
		{ workspaceId: BOB_WORKSPACE_ID, userId: BOB_USER_ID, role: 'owner' as const },
		{ workspaceId: CHARLIE_WORKSPACE_ID, userId: CHARLIE_USER_ID, role: 'owner' as const },
	];

	for (const m of memberRows) {
		await db.insert(schema.workspaceMembers).values(m).onConflictDoNothing();
	}
}

// ─── Step 2b: Auth Accounts (loginable credentials) ──────────────────────────

const SEED_PASSWORD = process.env.SEED_PASSWORD || 'gordian-demo';

async function seedAccounts() {
	console.log('[seed] Creating auth accounts (credential provider)...');

	const hashedPw = await hashPassword(SEED_PASSWORD);

	const accountRows = [
		{
			accountId: ALICE_USER_ID,
			providerId: 'credential',
			userId: ALICE_USER_ID,
			password: hashedPw,
		},
		{
			accountId: BOB_USER_ID,
			providerId: 'credential',
			userId: BOB_USER_ID,
			password: hashedPw,
		},
		{
			accountId: CHARLIE_USER_ID,
			providerId: 'credential',
			userId: CHARLIE_USER_ID,
			password: hashedPw,
		},
	];

	for (const a of accountRows) {
		await db.insert(schema.accounts).values(a).onConflictDoNothing();
	}

	console.log(`[seed] Created ${accountRows.length} auth accounts.`);
}

// ─── Step 3: Contacts (encrypted fields) ─────────────────────────────────────

interface ContactSeed {
	id: string;
	workspaceId: string;
	telegramId: string;
	firstName: string;
	lastName: string;
	phone: string;
	email: string;
	notes: string;
}

const CONTACTS_DATA: ContactSeed[] = [
	// Alice's contacts (VC world)
	{
		id: ALICE_CONTACTS.aptosFund,
		workspaceId: ALICE_WORKSPACE_ID,
		telegramId: '100001',
		firstName: 'Marcus',
		lastName: 'Chen',
		phone: '+1-415-555-0101',
		email: 'marcus@aptos-fund.capital',
		notes: 'Aptos ecosystem fund lead. Managing $500M AUM. Met at Token2049.',
	},
	{
		id: ALICE_CONTACTS.saftLawyer,
		workspaceId: ALICE_WORKSPACE_ID,
		telegramId: '100002',
		firstName: 'Sarah',
		lastName: 'Mitchell',
		phone: '+1-212-555-0202',
		email: 'sarah@cryptolaw.io',
		notes: 'Securities lawyer specializing in SAFT/SAFE instruments. Very responsive.',
	},
	{
		id: ALICE_CONTACTS.lpPartner,
		workspaceId: ALICE_WORKSPACE_ID,
		telegramId: '100003',
		firstName: 'David',
		lastName: 'Park',
		phone: '+82-10-5555-0303',
		email: 'david@hanhwa-digital.kr',
		notes: 'LP from Hanhwa Digital Assets. Committed $25M to Fund II.',
	},
	{
		id: ALICE_CONTACTS.tokenProject,
		workspaceId: ALICE_WORKSPACE_ID,
		telegramId: '100004',
		firstName: 'Elena',
		lastName: 'Volkov',
		phone: '+44-20-5555-0404',
		email: 'elena@moveprotocol.xyz',
		notes: 'CEO of MoveProtocol. Series A target. Building on Aptos/Sui.',
	},

	// Bob's contacts (Degen trader world)
	{
		id: BOB_CONTACTS.otcDesk,
		workspaceId: BOB_WORKSPACE_ID,
		telegramId: '200001',
		firstName: 'Jake',
		lastName: 'Thunder',
		phone: '+1-305-555-1001',
		email: 'jake@cumberlandotc.net',
		notes: 'OTC desk. Does 8-figure fills on SOL and ETH. Fast settlement.',
	},
	{
		id: BOB_CONTACTS.degenFriend,
		workspaceId: BOB_WORKSPACE_ID,
		telegramId: '200002',
		firstName: 'Anon',
		lastName: 'Frog',
		phone: '',
		email: '',
		notes: 'CT mutual. Apes into everything. Good alpha on Solana memecoins.',
	},
	{
		id: BOB_CONTACTS.nftTrader,
		workspaceId: BOB_WORKSPACE_ID,
		telegramId: '200003',
		firstName: 'Pixel',
		lastName: 'Chad',
		phone: '+1-786-555-1003',
		email: 'pixel@nftflips.gg',
		notes: 'NFT flipper. Whale wallet 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045.',
	},
	{
		id: BOB_CONTACTS.liquidityProvider,
		workspaceId: BOB_WORKSPACE_ID,
		telegramId: '200004',
		firstName: 'Yuki',
		lastName: 'Tanaka',
		phone: '+81-90-5555-1004',
		email: 'yuki@defivault.io',
		notes: 'Runs Uniswap v3 concentrated liquidity positions. $2M+ TVL.',
	},

	// Charlie's contacts (Governance world)
	{
		id: CHARLIE_CONTACTS.daoDelegate,
		workspaceId: CHARLIE_WORKSPACE_ID,
		telegramId: '300001',
		firstName: 'Priya',
		lastName: 'Sharma',
		phone: '+91-98-5555-2001',
		email: 'priya@arbitrum-dao.org',
		notes: 'Top 10 Arbitrum delegate. 5M ARB voting power. Very active on Snapshot.',
	},
	{
		id: CHARLIE_CONTACTS.protocolDev,
		workspaceId: CHARLIE_WORKSPACE_ID,
		telegramId: '300002',
		firstName: 'Alex',
		lastName: 'Rivera',
		phone: '+1-650-555-2002',
		email: 'alex@compound-gov.xyz',
		notes: 'Core dev on Compound governance. Wrote the timelock upgrade spec.',
	},
	{
		id: CHARLIE_CONTACTS.governanceCouncil,
		workspaceId: CHARLIE_WORKSPACE_ID,
		telegramId: '300003',
		firstName: 'Lin',
		lastName: 'Wei',
		phone: '+86-139-5555-2003',
		email: 'lin@optimism-collective.eth',
		notes: 'Optimism Security Council member. Focus on SIP-12 implementation.',
	},
	{
		id: CHARLIE_CONTACTS.snapshotAdmin,
		workspaceId: CHARLIE_WORKSPACE_ID,
		telegramId: '300004',
		firstName: 'Sofia',
		lastName: 'Andersson',
		phone: '+46-70-555-2004',
		email: 'sofia@snapshot.org',
		notes: 'Snapshot Labs team. Can help with custom voting strategies.',
	},
];

async function seedContacts() {
	console.log('[seed] Creating contacts (encrypted)...');

	// Group contacts by workspace and insert within keyStore context
	const byWorkspace = new Map<string, ContactSeed[]>();
	for (const c of CONTACTS_DATA) {
		const list = byWorkspace.get(c.workspaceId) ?? [];
		list.push(c);
		byWorkspace.set(c.workspaceId, list);
	}

	for (const [wsId, contactList] of byWorkspace) {
		await withDevKeys(wsId, async () => {
			for (const c of contactList) {
				await db
					.insert(schema.contacts)
					.values({
						id: c.id,
						workspaceId: c.workspaceId,
						telegramId: c.telegramId,
						firstName: c.firstName,
						lastName: c.lastName,
						phone: c.phone || undefined,
						email: c.email || undefined,
						notes: c.notes,
						firstNameBidx: c.firstName,
						lastNameBidx: c.lastName,
						phoneBidx: c.phone || undefined,
						emailBidx: c.email || undefined,
					})
					.onConflictDoNothing();
			}
		});
	}

	console.log(`[seed] Created ${CONTACTS_DATA.length} contacts.`);
}

// ─── Step 4: Memories (Web3-specific content with embeddings) ────────────────

interface MemorySeed {
	workspaceId: string;
	contactId: string;
	category: (typeof schema.memoryCategoryEnum.enumValues)[number];
	content: string;
	metadata?: Record<string, unknown>;
}

const MEMORIES_DATA: MemorySeed[] = [
	// ── Alice's memories (VC / institutional) ──
	{
		workspaceId: ALICE_WORKSPACE_ID,
		contactId: ALICE_CONTACTS.aptosFund,
		category: 'financial',
		content:
			'The valuation for the Aptos round is set at $2B FDV. Sending the SAFT now. Marcus confirmed allocation of 500K tokens at $4.00 per token.',
		metadata: { keywords: ['valuation', 'Aptos', 'SAFT', 'FDV', 'allocation'] },
	},
	{
		workspaceId: ALICE_WORKSPACE_ID,
		contactId: ALICE_CONTACTS.aptosFund,
		category: 'commitment',
		content:
			'Marcus: "We will wire the $2M by Friday. Please have the execution version of the SAFT ready. Our legal team needs the draft by Wednesday."',
		metadata: { keywords: ['wire', 'SAFT', 'execution version', 'deadline'] },
	},
	{
		workspaceId: ALICE_WORKSPACE_ID,
		contactId: ALICE_CONTACTS.saftLawyer,
		category: 'financial',
		content:
			'Sarah reviewed the SAFT template and flagged Regulation S exemption criteria. She recommends adding an investor accreditation clause for non-US participants.',
		metadata: { keywords: ['SAFT', 'Regulation S', 'accreditation', 'legal'] },
	},
	{
		workspaceId: ALICE_WORKSPACE_ID,
		contactId: ALICE_CONTACTS.lpPartner,
		category: 'relationship',
		content:
			'David confirmed $25M commitment to Fund II. Hanhwa Digital prefers quarterly distributions. They want exposure to Move-based L1s specifically.',
		metadata: { keywords: ['LP', 'commitment', 'Fund II', 'Hanhwa', 'Move'] },
	},
	{
		workspaceId: ALICE_WORKSPACE_ID,
		contactId: ALICE_CONTACTS.tokenProject,
		category: 'project',
		content:
			'MoveProtocol is building a cross-chain DEX aggregator on Aptos and Sui. They raised $5M seed and are targeting Series A at $80M valuation. Elena wants to schedule a deep dive next week.',
		metadata: { keywords: ['MoveProtocol', 'DEX', 'Aptos', 'Sui', 'Series A'] },
	},
	{
		workspaceId: ALICE_WORKSPACE_ID,
		contactId: ALICE_CONTACTS.saftLawyer,
		category: 'temporal',
		content:
			'Hey, are we still on for the governance call at 5 PM? Need to discuss the token unlock schedule before the board meeting.',
		metadata: { keywords: ['governance', 'call', '5 PM', 'token unlock', 'board'] },
	},
	{
		workspaceId: ALICE_WORKSPACE_ID,
		contactId: ALICE_CONTACTS.lpPartner,
		category: 'preference',
		content:
			'David strongly prefers detailed, formal morning briefs with full data tables and risk assessments. He specifically asked for no informal language.',
		metadata: { keywords: ['preference', 'formal', 'detailed', 'morning brief'] },
	},

	// ── Bob's memories (Degen trader) ──
	{
		workspaceId: BOB_WORKSPACE_ID,
		contactId: BOB_CONTACTS.otcDesk,
		category: 'financial',
		content:
			'Jake quoted 50 ETH OTC at $3,200 per. Settlement via 0xABCDEF1234567890ABCDEF1234567890ABCDEF12. He can do same-day fills up to $500K.',
		metadata: { keywords: ['OTC', 'ETH', 'settlement', 'fill', 'same-day'] },
	},
	{
		workspaceId: BOB_WORKSPACE_ID,
		contactId: BOB_CONTACTS.degenFriend,
		category: 'financial',
		content:
			'LFG! Anon just aped 100 SOL into $BONK at floor price. CA: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU. Liquidity looking thicc fr fr.',
		metadata: { keywords: ['LFG', 'SOL', 'BONK', 'ape', 'liquidity', 'Solana'] },
	},
	{
		workspaceId: BOB_WORKSPACE_ID,
		contactId: BOB_CONTACTS.nftTrader,
		category: 'financial',
		content:
			'Pixel flipped 3 Pudgy Penguins for 2.5 ETH profit. Whale wallet 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 is accumulating. Floor might pump.',
		metadata: { keywords: ['NFT', 'Pudgy Penguins', 'flip', 'whale', 'floor'] },
	},
	{
		workspaceId: BOB_WORKSPACE_ID,
		contactId: BOB_CONTACTS.liquidityProvider,
		category: 'technical',
		content:
			'Yuki moved $2M into concentrated liquidity on ETH/USDC 0.3% fee tier. Range: $2,800-$3,600. IL risk is manageable with current volatility.',
		metadata: { keywords: ['Uniswap', 'concentrated liquidity', 'ETH/USDC', 'IL'] },
	},
	{
		workspaceId: BOB_WORKSPACE_ID,
		contactId: BOB_CONTACTS.otcDesk,
		category: 'commitment',
		content:
			'Jake: "I will have the SOL fill ready by 3pm UTC. Sending 500 SOL to your wallet. Confirm the address: DRpbCBMxVnDK7maPMoA6tqRBkYcn3bRvH3RJGAmqJgQi"',
		metadata: { keywords: ['SOL', 'fill', 'wallet', 'OTC', 'deadline'] },
	},
	{
		workspaceId: BOB_WORKSPACE_ID,
		contactId: BOB_CONTACTS.degenFriend,
		category: 'preference',
		content:
			'Anon says the morning briefs are way too long. Just wants quick alpha: token, direction, conviction. No fluff. Keep it under 3 lines.',
		metadata: { keywords: ['preference', 'concise', 'casual', 'morning brief'] },
	},

	// ── Charlie's memories (Governance) ──
	{
		workspaceId: CHARLIE_WORKSPACE_ID,
		contactId: CHARLIE_CONTACTS.daoDelegate,
		category: 'organization',
		content:
			'Priya has 5M ARB delegated voting power. She voted FOR AIP-42 (treasury diversification) and AGAINST AIP-38 (team token extension). Very principled voter.',
		metadata: { keywords: ['ARB', 'delegate', 'voting', 'AIP', 'governance'] },
	},
	{
		workspaceId: CHARLIE_WORKSPACE_ID,
		contactId: CHARLIE_CONTACTS.protocolDev,
		category: 'technical',
		content:
			'Alex submitted the SIP-12 implementation spec for Compound governance timelock upgrade. Quorum threshold needs to change from 400K to 650K COMP. Snapshot vote scheduled for Monday.',
		metadata: { keywords: ['SIP-12', 'Compound', 'timelock', 'quorum', 'Snapshot'] },
	},
	{
		workspaceId: CHARLIE_WORKSPACE_ID,
		contactId: CHARLIE_CONTACTS.governanceCouncil,
		category: 'organization',
		content:
			'Lin confirmed the Security Council will review the timelock parameters. OP token holders need 72-hour notice before any parameter changes per the DAO charter.',
		metadata: { keywords: ['Security Council', 'timelock', 'OP', 'DAO charter'] },
	},
	{
		workspaceId: CHARLIE_WORKSPACE_ID,
		contactId: CHARLIE_CONTACTS.snapshotAdmin,
		category: 'technical',
		content:
			'Sofia can set up a custom Snapshot voting strategy for weighted quadratic voting. Needs the token contract address and the delegation registry.',
		metadata: { keywords: ['Snapshot', 'voting strategy', 'quadratic', 'delegation'] },
	},
	{
		workspaceId: CHARLIE_WORKSPACE_ID,
		contactId: CHARLIE_CONTACTS.daoDelegate,
		category: 'commitment',
		content:
			'Priya: "I will publish my delegate statement for the next cycle by Thursday. Also committing to vote on all proposals with >1M ARB quorum requirement."',
		metadata: { keywords: ['delegate statement', 'vote', 'quorum', 'commitment'] },
	},
	{
		workspaceId: CHARLIE_WORKSPACE_ID,
		contactId: CHARLIE_CONTACTS.protocolDev,
		category: 'preference',
		content:
			'Alex wants morning briefs that balance technical detail with governance context. Not too formal, not too casual. Include relevant proposal numbers.',
		metadata: { keywords: ['preference', 'mixed', 'balanced', 'morning brief'] },
	},
];

async function seedMemories() {
	console.log('[seed] Creating memories with deterministic embeddings...');

	const byWorkspace = new Map<string, MemorySeed[]>();
	for (const m of MEMORIES_DATA) {
		const list = byWorkspace.get(m.workspaceId) ?? [];
		list.push(m);
		byWorkspace.set(m.workspaceId, list);
	}

	for (const [wsId, memories] of byWorkspace) {
		await withDevKeys(wsId, async () => {
			for (const m of memories) {
				const sanitized = maskContent(m.content);
				const embedding = generateDeterministicVector(sanitized, 512);

				await db.insert(schema.memories).values({
					workspaceId: m.workspaceId,
					contactId: m.contactId,
					category: m.category,
					content: m.content,
					contentSanitized: sanitized,
					embedding,
					metadata: m.metadata ?? {},
				});
			}
		});
	}

	console.log(`[seed] Created ${MEMORIES_DATA.length} memories.`);
}

// ─── Step 5: Commitments ─────────────────────────────────────────────────────

interface CommitmentSeed {
	workspaceId: string;
	contactId: string;
	title: string;
	commitmentType: 'promise' | 'task' | 'meeting' | 'financial';
	status: 'active' | 'completed' | 'dismissed' | 'draft';
	assignee: string;
	confidence: number;
	dueDate?: Date;
	quote: string;
}

const now = new Date();
function daysFromNow(days: number): Date {
	return new Date(now.getTime() + days * 86400000);
}

const COMMITMENTS_DATA: CommitmentSeed[] = [
	// Alice's commitments
	{
		workspaceId: ALICE_WORKSPACE_ID,
		contactId: ALICE_CONTACTS.aptosFund,
		title: 'Wire $2M for Aptos SAFT',
		commitmentType: 'financial',
		status: 'active',
		assignee: 'contact',
		confidence: 0.92,
		dueDate: daysFromNow(5),
		quote: 'We will wire the $2M by Friday',
	},
	{
		workspaceId: ALICE_WORKSPACE_ID,
		contactId: ALICE_CONTACTS.aptosFund,
		title: 'Prepare execution version of SAFT',
		commitmentType: 'task',
		status: 'active',
		assignee: 'user',
		confidence: 0.95,
		dueDate: daysFromNow(3),
		quote: 'Please have the execution version of the SAFT ready',
	},
	{
		workspaceId: ALICE_WORKSPACE_ID,
		contactId: ALICE_CONTACTS.tokenProject,
		title: 'Schedule deep dive with MoveProtocol',
		commitmentType: 'meeting',
		status: 'draft',
		assignee: 'user',
		confidence: 0.78,
		dueDate: daysFromNow(7),
		quote: 'Elena wants to schedule a deep dive next week',
	},
	{
		workspaceId: ALICE_WORKSPACE_ID,
		contactId: ALICE_CONTACTS.saftLawyer,
		title: 'Add Reg S accreditation clause to SAFT',
		commitmentType: 'task',
		status: 'active',
		assignee: 'user',
		confidence: 0.88,
		quote: 'recommends adding an investor accreditation clause',
	},

	// Bob's commitments
	{
		workspaceId: BOB_WORKSPACE_ID,
		contactId: BOB_CONTACTS.otcDesk,
		title: 'Deliver 500 SOL fill',
		commitmentType: 'financial',
		status: 'active',
		assignee: 'contact',
		confidence: 0.9,
		dueDate: daysFromNow(0),
		quote: 'I will have the SOL fill ready by 3pm UTC',
	},
	{
		workspaceId: BOB_WORKSPACE_ID,
		contactId: BOB_CONTACTS.otcDesk,
		title: 'Confirm wallet address for SOL transfer',
		commitmentType: 'task',
		status: 'completed',
		assignee: 'user',
		confidence: 0.95,
		quote: 'Confirm the address',
	},
	{
		workspaceId: BOB_WORKSPACE_ID,
		contactId: BOB_CONTACTS.liquidityProvider,
		title: 'Review concentrated liquidity position performance',
		commitmentType: 'task',
		status: 'draft',
		assignee: 'user',
		confidence: 0.65,
		dueDate: daysFromNow(14),
		quote: 'IL risk is manageable with current volatility',
	},

	// Charlie's commitments
	{
		workspaceId: CHARLIE_WORKSPACE_ID,
		contactId: CHARLIE_CONTACTS.daoDelegate,
		title: 'Publish delegate statement',
		commitmentType: 'promise',
		status: 'active',
		assignee: 'contact',
		confidence: 0.91,
		dueDate: daysFromNow(4),
		quote: 'I will publish my delegate statement for the next cycle by Thursday',
	},
	{
		workspaceId: CHARLIE_WORKSPACE_ID,
		contactId: CHARLIE_CONTACTS.daoDelegate,
		title: 'Vote on all >1M ARB quorum proposals',
		commitmentType: 'promise',
		status: 'active',
		assignee: 'contact',
		confidence: 0.86,
		quote: 'committing to vote on all proposals with >1M ARB quorum requirement',
	},
	{
		workspaceId: CHARLIE_WORKSPACE_ID,
		contactId: CHARLIE_CONTACTS.protocolDev,
		title: 'Review SIP-12 timelock upgrade spec',
		commitmentType: 'task',
		status: 'active',
		assignee: 'user',
		confidence: 0.88,
		dueDate: daysFromNow(2),
		quote: 'SIP-12 implementation spec for Compound governance timelock upgrade',
	},
	{
		workspaceId: CHARLIE_WORKSPACE_ID,
		contactId: CHARLIE_CONTACTS.governanceCouncil,
		title: 'Ensure 72-hour notice for parameter changes',
		commitmentType: 'task',
		status: 'draft',
		assignee: 'user',
		confidence: 0.72,
		quote: 'OP token holders need 72-hour notice before any parameter changes',
	},
];

async function seedCommitments() {
	console.log('[seed] Creating commitments with embeddings...');

	const byWorkspace = new Map<string, CommitmentSeed[]>();
	for (const c of COMMITMENTS_DATA) {
		const list = byWorkspace.get(c.workspaceId) ?? [];
		list.push(c);
		byWorkspace.set(c.workspaceId, list);
	}

	for (const [wsId, commitments] of byWorkspace) {
		await withDevKeys(wsId, async () => {
			for (const c of commitments) {
				const embedding = generateDeterministicVector(c.title, 512);
				await db.insert(schema.commitments).values({
					workspaceId: c.workspaceId,
					contactId: c.contactId,
					title: c.title,
					commitmentType: c.commitmentType,
					status: c.status,
					assignee: c.assignee,
					confidence: c.confidence,
					dueDate: c.dueDate,
					quote: c.quote,
					embedding,
				});
			}
		});
	}

	console.log(`[seed] Created ${COMMITMENTS_DATA.length} commitments.`);
}

// ─── Step 5b: Deals ──────────────────────────────────────────────────────────

const ALICE_DEALS = {
	aptosSeries: deterministicUUID('alice-deal-aptos-series'),
	moveProtocolSeed: deterministicUUID('alice-deal-moveprotocol-seed'),
	fundIILP: deterministicUUID('alice-deal-fund-ii-lp'),
	tokenWarrant: deterministicUUID('alice-deal-token-warrant'),
};

const BOB_DEALS = {
	solOtc: deterministicUUID('bob-deal-sol-otc'),
	pudgyFlip: deterministicUUID('bob-deal-pudgy-flip'),
	ethUsdcLP: deterministicUUID('bob-deal-eth-usdc-lp'),
	bonkPlay: deterministicUUID('bob-deal-bonk-play'),
};

const CHARLIE_DEALS = {
	arbDelegation: deterministicUUID('charlie-deal-arb-delegation'),
	compoundAudit: deterministicUUID('charlie-deal-compound-audit'),
	snapshotBuild: deterministicUUID('charlie-deal-snapshot-build'),
	opRetainer: deterministicUUID('charlie-deal-op-retainer'),
};

interface DealSeed {
	id: string;
	workspaceId: string;
	contactId: string;
	title: string;
	status: 'open' | 'negotiating' | 'won' | 'lost';
	value: number; // cents
	notes?: string;
}

const DEALS_DATA: DealSeed[] = [
	// Alice's deals (VC)
	{
		id: ALICE_DEALS.aptosSeries,
		workspaceId: ALICE_WORKSPACE_ID,
		contactId: ALICE_CONTACTS.aptosFund,
		title: 'Aptos Series A',
		status: 'negotiating',
		value: 200_000_000, // $2,000,000
		notes: 'Co-lead with Paradigm. SAFT terms under review.',
	},
	{
		id: ALICE_DEALS.moveProtocolSeed,
		workspaceId: ALICE_WORKSPACE_ID,
		contactId: ALICE_CONTACTS.tokenProject,
		title: 'MoveProtocol Seed Extension',
		status: 'open',
		value: 50_000_000, // $500,000
		notes: 'Cross-chain DEX aggregator on Aptos/Sui. Deep dive scheduled.',
	},
	{
		id: ALICE_DEALS.fundIILP,
		workspaceId: ALICE_WORKSPACE_ID,
		contactId: ALICE_CONTACTS.lpPartner,
		title: 'Fund II LP Commitment',
		status: 'won',
		value: 2_000_000_000, // $20,000,000 (int32 max ~$21.4M in cents)
		notes: 'Hanhwa Digital committed $20M. Quarterly distribution preference.',
	},
	{
		id: ALICE_DEALS.tokenWarrant,
		workspaceId: ALICE_WORKSPACE_ID,
		contactId: ALICE_CONTACTS.saftLawyer,
		title: 'Token Warrant — SAFT',
		status: 'negotiating',
		value: 15_000_000, // $150,000
		notes: 'Reg S exemption flagged. Adding accreditation clause.',
	},

	// Bob's deals (Trader)
	{
		id: BOB_DEALS.solOtc,
		workspaceId: BOB_WORKSPACE_ID,
		contactId: BOB_CONTACTS.otcDesk,
		title: 'SOL OTC Block',
		status: 'open',
		value: 16_000_000, // $160,000
		notes: '500 SOL fill pending. Same-day settlement.',
	},
	{
		id: BOB_DEALS.pudgyFlip,
		workspaceId: BOB_WORKSPACE_ID,
		contactId: BOB_CONTACTS.nftTrader,
		title: 'Pudgy Penguins Flip',
		status: 'won',
		value: 750_000, // $7,500
		notes: 'Flipped 3 Pudgys for 2.5 ETH profit. Whale wallet accumulating.',
	},
	{
		id: BOB_DEALS.ethUsdcLP,
		workspaceId: BOB_WORKSPACE_ID,
		contactId: BOB_CONTACTS.liquidityProvider,
		title: 'ETH/USDC LP Position',
		status: 'negotiating',
		value: 200_000_000, // $2,000,000
		notes: 'Concentrated liquidity 0.3% fee tier. Range: $2,800-$3,600.',
	},
	{
		id: BOB_DEALS.bonkPlay,
		workspaceId: BOB_WORKSPACE_ID,
		contactId: BOB_CONTACTS.degenFriend,
		title: 'BONK Memecoin Play',
		status: 'lost',
		value: 1_500_000, // $15,000
		notes: 'Liquidity dried up. Took the L.',
	},

	// Charlie's deals (Governance)
	{
		id: CHARLIE_DEALS.arbDelegation,
		workspaceId: CHARLIE_WORKSPACE_ID,
		contactId: CHARLIE_CONTACTS.daoDelegate,
		title: 'ARB Delegation Agreement',
		status: 'open',
		value: 0, // $0
		notes: '5M ARB voting power delegation. Non-monetary.',
	},
	{
		id: CHARLIE_DEALS.compoundAudit,
		workspaceId: CHARLIE_WORKSPACE_ID,
		contactId: CHARLIE_CONTACTS.protocolDev,
		title: 'Compound Timelock Audit',
		status: 'negotiating',
		value: 8_000_000, // $80,000
		notes: 'SIP-12 timelock upgrade spec review. Quorum threshold change.',
	},
	{
		id: CHARLIE_DEALS.snapshotBuild,
		workspaceId: CHARLIE_WORKSPACE_ID,
		contactId: CHARLIE_CONTACTS.snapshotAdmin,
		title: 'Snapshot Strategy Build',
		status: 'won',
		value: 2_500_000, // $25,000
		notes: 'Custom weighted quadratic voting strategy delivered.',
	},
	{
		id: CHARLIE_DEALS.opRetainer,
		workspaceId: CHARLIE_WORKSPACE_ID,
		contactId: CHARLIE_CONTACTS.governanceCouncil,
		title: 'OP Security Council Retainer',
		status: 'open',
		value: 12_000_000, // $120,000
		notes: 'Monthly retainer for Security Council advisory. SIP-12 focus.',
	},
];

async function seedDeals() {
	console.log('[seed] Creating deals...');

	const byWorkspace = new Map<string, DealSeed[]>();
	for (const d of DEALS_DATA) {
		const list = byWorkspace.get(d.workspaceId) ?? [];
		list.push(d);
		byWorkspace.set(d.workspaceId, list);
	}

	for (const [wsId, deals] of byWorkspace) {
		await withDevKeys(wsId, async () => {
			for (const d of deals) {
				await db
					.insert(schema.deals)
					.values({
						id: d.id,
						workspaceId: d.workspaceId,
						contactId: d.contactId,
						title: d.title,
						status: d.status,
						value: d.value,
						notes: d.notes,
					})
					.onConflictDoNothing();
			}
		});
	}

	console.log(`[seed] Created ${DEALS_DATA.length} deals.`);
}

// ─── Step 6: Golden Dataset (commitment extraction examples) ─────────────────

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

const GOLDEN_DATA: GoldenSeed[] = [
	// Commitment extraction examples
	{
		featureDomain: 'seed_commitment_extraction',
		inputContext:
			'Marcus said: "We will wire the $2M by Friday. Please have the execution version of the SAFT ready."',
		modelPrediction: {
			commitments: [
				{ title: 'Wire $2M', type: 'financial', assignee: 'contact', confidence: 0.88 },
			],
		},
		correctedOutput: {
			commitments: [
				{
					title: 'Wire $2M for Aptos SAFT',
					type: 'financial',
					assignee: 'contact',
					confidence: 0.92,
				},
				{
					title: 'Prepare execution version of SAFT',
					type: 'task',
					assignee: 'user',
					confidence: 0.95,
				},
			],
		},
		correctionReasoning:
			'Model missed the second implicit commitment (user needs to prepare the SAFT). Also missed Aptos context for the first commitment title.',
		tags: ['SAFT', 'financial', 'dual-commitment', 'implicit'],
		difficulty: 'standard',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: ALICE_USER_ID,
		verificationScore: 0.95,
	},
	{
		featureDomain: 'seed_commitment_extraction',
		inputContext:
			'LFG! Just aped 100 SOL into $BONK. CA: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU. Liquidity looking thicc.',
		modelPrediction: {
			commitments: [
				{ title: 'Buy BONK tokens', type: 'financial', assignee: 'contact', confidence: 0.7 },
			],
		},
		correctedOutput: {
			commitments: [],
		},
		correctionReasoning:
			'No actionable commitment exists. This is a past-tense report of a trade already executed, not a future obligation. The model should not extract commitments from historical trade reports.',
		tags: ['degen', 'false-positive', 'past-tense', 'no-commitment'],
		difficulty: 'edge_case',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: BOB_USER_ID,
		verificationScore: 0.98,
	},
	{
		featureDomain: 'seed_commitment_extraction',
		inputContext:
			'I will publish my delegate statement for the next cycle by Thursday. Also committing to vote on all proposals with >1M ARB quorum requirement.',
		modelPrediction: {
			commitments: [
				{
					title: 'Publish delegate statement',
					type: 'promise',
					assignee: 'contact',
					confidence: 0.9,
				},
			],
		},
		correctedOutput: {
			commitments: [
				{
					title: 'Publish delegate statement by Thursday',
					type: 'promise',
					assignee: 'contact',
					confidence: 0.91,
				},
				{
					title: 'Vote on all >1M ARB quorum proposals',
					type: 'promise',
					assignee: 'contact',
					confidence: 0.86,
				},
			],
		},
		correctionReasoning:
			'Model missed the second commitment (ongoing voting promise). Also should include the deadline "by Thursday" in the first commitment title.',
		tags: ['governance', 'dual-commitment', 'deadline', 'ongoing'],
		difficulty: 'standard',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: CHARLIE_USER_ID,
		verificationScore: 0.93,
	},
	{
		featureDomain: 'seed_commitment_extraction',
		inputContext: 'The valuation for the Aptos round is set at $2B FDV. Sending the SAFT now.',
		modelPrediction: {
			commitments: [{ title: 'Send SAFT', type: 'task', assignee: 'user', confidence: 0.8 }],
		},
		correctedOutput: {
			commitments: [
				{ title: 'Send SAFT document', type: 'task', assignee: 'user', confidence: 0.85 },
			],
		},
		correctionReasoning:
			'"Sending the SAFT now" is present continuous, suggesting an in-progress action not a future commitment. Lower confidence but still extract as active task.',
		tags: ['SAFT', 'present-tense', 'in-progress'],
		difficulty: 'standard',
		source: 'user_edit',
		status: 'verified',
		verifiedBy: ALICE_USER_ID,
		verificationScore: 0.88,
	},

	// Regulatory / compliance golden dataset (for prompt caching Layer 2)
	{
		featureDomain: 'seed_regulatory_knowledge',
		inputContext:
			'SAFT Compliance Guide: A Simple Agreement for Future Tokens (SAFT) is a pre-functional token investment framework. Under Regulation D (Rule 506(c)), SAFTs may only be sold to accredited investors. The issuer must take reasonable steps to verify investor accreditation status. SAFTs sold under Regulation S are exempt from SEC registration for offshore transactions. Key requirements: (1) Good faith belief of accredited status, (2) Token delivery only upon network launch, (3) KYC/AML compliance for all participants, (4) Lock-up periods per applicable vesting schedules.',
		modelPrediction: {},
		correctedOutput: {
			summary:
				'SAFT instruments require Reg D 506(c) for US investors (accredited only) and Reg S for offshore. KYC/AML mandatory. Tokens delivered post-launch with vesting lock-ups.',
		},
		correctionReasoning: 'Reference document for prompt caching. No model prediction needed.',
		tags: ['SAFT', 'Regulation D', 'Regulation S', 'compliance', 'KYC', 'AML'],
		difficulty: 'trivial',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: ALICE_USER_ID,
		verificationScore: 1.0,
	},
	{
		featureDomain: 'seed_regulatory_knowledge',
		inputContext:
			'Token Unlock Schedule Best Practices: Vesting schedules for protocol tokens typically follow a cliff+linear model. Common parameters: 6-12 month cliff, 24-48 month linear vest. Team tokens should not exceed 20% of total supply. Investor tokens (SAFT/SAFE) typically vest over 18-36 months. Treasury tokens should have governance-controlled release. All unlock events must be announced 72 hours in advance per most DAO charters.',
		modelPrediction: {},
		correctedOutput: {
			summary:
				'Standard vesting: 6-12mo cliff + 24-48mo linear. Team <20%, investor 18-36mo, treasury governance-controlled. 72hr advance notice required.',
		},
		correctionReasoning: 'Reference document for prompt caching. No model prediction needed.',
		tags: ['vesting', 'token unlock', 'treasury', 'governance'],
		difficulty: 'trivial',
		source: 'expert_review',
		status: 'verified',
		verifiedBy: CHARLIE_USER_ID,
		verificationScore: 1.0,
	},
];

async function seedGoldenDataset() {
	console.log('[seed] Creating golden dataset entries...');

	for (const g of GOLDEN_DATA) {
		const embedding = generateDeterministicVector(g.inputContext, 1536);
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
	}

	console.log(`[seed] Created ${GOLDEN_DATA.length} golden dataset entries.`);
}

// ─── Step 7: Bandit Ledger (biased Thompson Sampling priors) ─────────────────

interface BanditTrialSeed {
	promptVariant: string;
	featureContext: string;
	rewardScore: number;
	isFinalized: boolean;
	userId: string;
}

function generateBanditTrials(): BanditTrialSeed[] {
	const trials: BanditTrialSeed[] = [];

	// Alice: Strong preference for formal briefs (alpha=50, beta=2 equivalent)
	// 50 successes for formal, 2 successes for casual
	for (let i = 0; i < 50; i++) {
		trials.push({
			promptVariant: 'brief_tone_formal',
			featureContext: 'morning_brief_tone',
			rewardScore: 1.0,
			isFinalized: true,
			userId: ALICE_USER_ID,
		});
	}
	for (let i = 0; i < 2; i++) {
		trials.push({
			promptVariant: 'brief_tone_formal',
			featureContext: 'morning_brief_tone',
			rewardScore: 0.0,
			isFinalized: true,
			userId: ALICE_USER_ID,
		});
	}
	for (let i = 0; i < 2; i++) {
		trials.push({
			promptVariant: 'brief_tone_casual',
			featureContext: 'morning_brief_tone',
			rewardScore: 1.0,
			isFinalized: true,
			userId: ALICE_USER_ID,
		});
	}
	for (let i = 0; i < 50; i++) {
		trials.push({
			promptVariant: 'brief_tone_casual',
			featureContext: 'morning_brief_tone',
			rewardScore: 0.0,
			isFinalized: true,
			userId: ALICE_USER_ID,
		});
	}

	// Bob: Inverse — strong preference for casual briefs
	for (let i = 0; i < 2; i++) {
		trials.push({
			promptVariant: 'brief_tone_formal',
			featureContext: 'morning_brief_tone',
			rewardScore: 1.0,
			isFinalized: true,
			userId: BOB_USER_ID,
		});
	}
	for (let i = 0; i < 50; i++) {
		trials.push({
			promptVariant: 'brief_tone_formal',
			featureContext: 'morning_brief_tone',
			rewardScore: 0.0,
			isFinalized: true,
			userId: BOB_USER_ID,
		});
	}
	for (let i = 0; i < 50; i++) {
		trials.push({
			promptVariant: 'brief_tone_casual',
			featureContext: 'morning_brief_tone',
			rewardScore: 1.0,
			isFinalized: true,
			userId: BOB_USER_ID,
		});
	}
	for (let i = 0; i < 2; i++) {
		trials.push({
			promptVariant: 'brief_tone_casual',
			featureContext: 'morning_brief_tone',
			rewardScore: 0.0,
			isFinalized: true,
			userId: BOB_USER_ID,
		});
	}

	// Charlie: Mixed/neutral — tests exploration phase
	// ~15 successes each for both variants (roughly equal priors)
	for (let i = 0; i < 15; i++) {
		trials.push({
			promptVariant: 'brief_tone_formal',
			featureContext: 'morning_brief_tone',
			rewardScore: 1.0,
			isFinalized: true,
			userId: CHARLIE_USER_ID,
		});
	}
	for (let i = 0; i < 12; i++) {
		trials.push({
			promptVariant: 'brief_tone_formal',
			featureContext: 'morning_brief_tone',
			rewardScore: 0.0,
			isFinalized: true,
			userId: CHARLIE_USER_ID,
		});
	}
	for (let i = 0; i < 13; i++) {
		trials.push({
			promptVariant: 'brief_tone_casual',
			featureContext: 'morning_brief_tone',
			rewardScore: 1.0,
			isFinalized: true,
			userId: CHARLIE_USER_ID,
		});
	}
	for (let i = 0; i < 14; i++) {
		trials.push({
			promptVariant: 'brief_tone_casual',
			featureContext: 'morning_brief_tone',
			rewardScore: 0.0,
			isFinalized: true,
			userId: CHARLIE_USER_ID,
		});
	}

	// Additional bandit dimension: brief_detail_level
	// Alice: prefers detailed
	for (let i = 0; i < 40; i++) {
		trials.push({
			promptVariant: 'brief_detail_high',
			featureContext: 'morning_brief_detail',
			rewardScore: 1.0,
			isFinalized: true,
			userId: ALICE_USER_ID,
		});
	}
	for (let i = 0; i < 5; i++) {
		trials.push({
			promptVariant: 'brief_detail_low',
			featureContext: 'morning_brief_detail',
			rewardScore: 1.0,
			isFinalized: true,
			userId: ALICE_USER_ID,
		});
	}

	// Bob: prefers concise
	for (let i = 0; i < 5; i++) {
		trials.push({
			promptVariant: 'brief_detail_high',
			featureContext: 'morning_brief_detail',
			rewardScore: 1.0,
			isFinalized: true,
			userId: BOB_USER_ID,
		});
	}
	for (let i = 0; i < 40; i++) {
		trials.push({
			promptVariant: 'brief_detail_low',
			featureContext: 'morning_brief_detail',
			rewardScore: 1.0,
			isFinalized: true,
			userId: BOB_USER_ID,
		});
	}

	return trials;
}

async function seedBanditLedger() {
	console.log('[seed] Creating bandit ledger trials...');
	const trials = generateBanditTrials();

	// Batch insert for performance
	const batchSize = 50;
	for (let i = 0; i < trials.length; i += batchSize) {
		const batch = trials.slice(i, i + batchSize);
		await db.insert(schema.banditLedger).values(batch);
	}

	console.log(`[seed] Created ${trials.length} bandit ledger trials.`);

	// Print summary
	const summary = {
		alice: {
			formal_wins: trials.filter(
				(t) =>
					t.userId === ALICE_USER_ID &&
					t.promptVariant === 'brief_tone_formal' &&
					t.rewardScore === 1.0,
			).length,
			casual_wins: trials.filter(
				(t) =>
					t.userId === ALICE_USER_ID &&
					t.promptVariant === 'brief_tone_casual' &&
					t.rewardScore === 1.0,
			).length,
		},
		bob: {
			formal_wins: trials.filter(
				(t) =>
					t.userId === BOB_USER_ID &&
					t.promptVariant === 'brief_tone_formal' &&
					t.rewardScore === 1.0,
			).length,
			casual_wins: trials.filter(
				(t) =>
					t.userId === BOB_USER_ID &&
					t.promptVariant === 'brief_tone_casual' &&
					t.rewardScore === 1.0,
			).length,
		},
		charlie: {
			formal_wins: trials.filter(
				(t) =>
					t.userId === CHARLIE_USER_ID &&
					t.promptVariant === 'brief_tone_formal' &&
					t.rewardScore === 1.0,
			).length,
			casual_wins: trials.filter(
				(t) =>
					t.userId === CHARLIE_USER_ID &&
					t.promptVariant === 'brief_tone_casual' &&
					t.rewardScore === 1.0,
			).length,
		},
	};
	console.log('[seed] Bandit summary (tone wins):', JSON.stringify(summary, null, 2));
}

// ─── Step 8: User Decisions (causal graph) ───────────────────────────────────

async function seedDecisions() {
	console.log('[seed] Creating user decisions and causal edges...');

	const decisions = [
		{
			id: deterministicUUID('decision-alice-1'),
			workspaceId: ALICE_WORKSPACE_ID,
			userId: ALICE_USER_ID,
			rawContent: 'Reviewed Aptos SAFT terms and decided to proceed with investment',
			decisionType: 'commitment' as const,
			interactionMetadata: { source: 'telegram', contactId: ALICE_CONTACTS.aptosFund },
		},
		{
			id: deterministicUUID('decision-alice-2'),
			workspaceId: ALICE_WORKSPACE_ID,
			userId: ALICE_USER_ID,
			rawContent: 'Initiated wire transfer for $2M Aptos allocation',
			decisionType: 'purchase' as const,
			interactionMetadata: { source: 'telegram', contactId: ALICE_CONTACTS.aptosFund },
		},
		{
			id: deterministicUUID('decision-bob-1'),
			workspaceId: BOB_WORKSPACE_ID,
			userId: BOB_USER_ID,
			rawContent: 'Decided to fill 500 SOL OTC order from Jake',
			decisionType: 'purchase' as const,
			interactionMetadata: { source: 'telegram', contactId: BOB_CONTACTS.otcDesk },
		},
		{
			id: deterministicUUID('decision-charlie-1'),
			workspaceId: CHARLIE_WORKSPACE_ID,
			userId: CHARLIE_USER_ID,
			rawContent: 'Voted FOR AIP-42 treasury diversification proposal',
			decisionType: 'commitment' as const,
			interactionMetadata: { source: 'telegram', contactId: CHARLIE_CONTACTS.daoDelegate },
		},
	];

	const byWorkspace = new Map<string, typeof decisions>();
	for (const d of decisions) {
		const list = byWorkspace.get(d.workspaceId) ?? [];
		list.push(d);
		byWorkspace.set(d.workspaceId, list);
	}

	for (const [wsId, workspaceDecisions] of byWorkspace) {
		await withDevKeys(wsId, async () => {
			for (const d of workspaceDecisions) {
				const embedding = generateDeterministicVector(d.rawContent, 1536);
				await db.insert(schema.userDecisions).values({
					id: d.id,
					workspaceId: d.workspaceId,
					userId: d.userId,
					rawContent: d.rawContent,
					embedding,
					decisionType: d.decisionType,
					interactionMetadata: d.interactionMetadata,
				});
			}
		});
	}

	// Create causal edges: Alice's SAFT review → wire transfer
	await db.insert(schema.causalEdges).values({
		workspaceId: ALICE_WORKSPACE_ID,
		sourceId: deterministicUUID('decision-alice-1'),
		targetId: deterministicUUID('decision-alice-2'),
		weight: 0.9,
		edgeType: 'explicit_reply',
		confidenceScore: 0.92,
	});

	console.log(`[seed] Created ${decisions.length} decisions and 1 causal edge.`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
	console.log('=== Gordian v2 Golden Seed Script ===');
	console.log(`Database: ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);
	console.log('');

	try {
		await cleanDatabase();
		await seedUsersAndWorkspaces();
		await seedAccounts();
		await seedContacts();
		await seedMemories();
		await seedCommitments();
		await seedDeals();
		await seedGoldenDataset();
		await seedBanditLedger();
		await seedDecisions();

		console.log('');
		console.log('=== Seed complete! ===');
		console.log('');
		console.log('Users:');
		console.log(`  VC Alice:            ${ALICE_USER_ID}`);
		console.log(`  Degen Bob:           ${BOB_USER_ID}`);
		console.log(`  Governance Charlie:  ${CHARLIE_USER_ID}`);
		console.log('');
		console.log('Demo login:');
		console.log('  Email:    alice@gordian.dev');
		console.log(`  Password: ${SEED_PASSWORD}`);
		console.log('');
		console.log('Workspaces:');
		console.log(`  Alice Capital:       ${ALICE_WORKSPACE_ID}`);
		console.log(`  Bob Trading:         ${BOB_WORKSPACE_ID}`);
		console.log(`  Charlie DAO:         ${CHARLIE_WORKSPACE_ID}`);
		console.log('');
		console.log('Dev WRK (base64):');
		console.log(`  ${DEV_WRK_BASE64}`);
		console.log('');
		console.log('Bandit expectations:');
		console.log('  Alice  → Thompson should select "formal" tone >95% of the time');
		console.log('  Bob    → Thompson should select "casual" tone >95% of the time');
		console.log('  Charlie → Thompson should explore ~50/50 (mixed priors)');
	} catch (err) {
		console.error('[seed] Fatal error:', err);
		process.exit(1);
	} finally {
		await client.end();
	}
}

main();
