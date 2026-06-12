/**
 * E2E Recursive Learning Loop Test
 *
 * Demonstrates the full learning loop with LIVE API calls:
 * 1. Setup: Read Alice's workspace, construct SealedEnvelope, snapshot bandit stats
 * 2. Inject: 2 synthetic messages (Polygon zkEVM term sheet + tokenomics review)
 * 3. Extract: extractCommitmentsWithBandit() → real Claude API call
 * 4. Embed + Store: generateEmbedding() → real OpenAI call, dedup, store with banditTraceId
 * 5. Brief: generateBriefWithBandit() → real Claude API, prints brief text
 * 6. Feedback: Mark one commitment completed (reward=1.0), dismiss brief (reward=0.0)
 * 7. Verify: Re-read bandit stats, assert alpha/beta shifted correctly
 * 8. Cleanup: Delete test-created rows
 *
 * Usage: pnpm tsx scripts/e2e-loop.ts
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../.env.local') });

import type { SealedEnvelope } from '@repo/crypto';
import { maskEntities } from '@repo/crypto';
import {
	createCommitment,
	createMemory,
	db,
	finalizeBanditReward,
	getBanditStats,
	sql,
	updateCommitmentStatus,
} from '@repo/db';
import { extractCommitmentsWithBandit } from '../apps/worker/src/ai/commitment-extraction';
import { generateEmbedding } from '../apps/worker/src/ai/embeddings';
import { generateBriefWithBandit } from '../apps/worker/src/ai/morning-brief';
import { prefilterEntities } from '../apps/worker/src/ai/prefilter';

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

const ALICE_USER_ID = deterministicUUID('alice');
const ALICE_WORKSPACE_ID = deterministicUUID('alice-workspace');
const ALICE_CONTACTS = {
	aptosFund: deterministicUUID('alice-contact-aptos-fund'),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(phase: string, msg: string) {
	console.log(`\n[${'='.repeat(3)} ${phase} ${'='.repeat(3)}] ${msg}`);
}

function assert(condition: boolean, msg: string) {
	if (!condition) {
		console.error(`ASSERTION FAILED: ${msg}`);
		process.exit(1);
	}
}

// Track IDs for cleanup
const createdCommitmentIds: string[] = [];
const createdMemoryIds: string[] = [];
const createdBanditTraceIds: string[] = [];

// ─── Phase 1: Setup ──────────────────────────────────────────────────────────

async function phase1Setup(): Promise<{
	envelope: SealedEnvelope;
	statsBefore: Awaited<ReturnType<typeof getBanditStats>>;
}> {
	log('PHASE 1', 'Setup — reading Alice workspace and snapshotting bandit stats');

	// Read workspace to get encrypted WRK
	const wsResult = await db.execute(
		sql`SELECT encrypted_wrk, kms_context, wrk_version FROM workspaces WHERE id = ${ALICE_WORKSPACE_ID}`,
	);
	const ws = (
		wsResult as unknown as Array<{
			encrypted_wrk: string;
			kms_context: Record<string, string>;
			wrk_version: number;
		}>
	)[0];

	assert(!!ws, `Alice workspace ${ALICE_WORKSPACE_ID} not found — run seed first`);

	const envelope: SealedEnvelope = {
		encryptedWrk: Buffer.from(ws.encrypted_wrk, 'base64'),
		kmsContext: ws.kms_context,
		wrkVersion: ws.wrk_version,
	};

	console.log(`  Workspace: ${ALICE_WORKSPACE_ID}`);
	console.log(`  User: ${ALICE_USER_ID}`);

	// Snapshot bandit stats for Alice
	const statsBefore = await getBanditStats(ALICE_USER_ID);
	console.log(`  Bandit stats before (${statsBefore.length} variants):`);
	for (const s of statsBefore) {
		console.log(`    ${s.promptVariant}: alpha=${s.alphaScore} beta=${s.betaScore}`);
	}

	return { envelope, statsBefore };
}

// ─── Phase 2: Inject + Extract ───────────────────────────────────────────────

async function phase2Extract(_envelope: SealedEnvelope) {
	log('PHASE 2', 'Inject synthetic messages + extract commitments (Claude API)');

	const syntheticMessages = [
		{
			role: 'user',
			content:
				'Marcus just sent over the Polygon zkEVM term sheet. We need to review the vesting schedule and confirm allocation of 200K POL tokens at $0.80. I will prepare the counter-proposal by Wednesday.',
			timestamp: new Date().toISOString(),
		},
		{
			role: 'assistant',
			content:
				'Got it. I also noticed Marcus mentioned a tokenomics review call scheduled for Friday at 2pm UTC. He said he will send the deck beforehand.',
			timestamp: new Date(Date.now() + 60000).toISOString(),
		},
	];

	console.log(`  Injecting ${syntheticMessages.length} synthetic messages...`);

	// Extract with bandit
	const result = await extractCommitmentsWithBandit(
		syntheticMessages,
		new Date().toISOString(),
		ALICE_USER_ID,
	);

	console.log(`  Variant selected: ${result.variant}`);
	console.log(`  Trace ID: ${result.traceId}`);
	console.log(`  Commitments found: ${result.commitments.length}`);
	createdBanditTraceIds.push(result.traceId);

	for (const c of result.commitments) {
		console.log(`    - "${c.title}" (${c.commitment_type}, confidence=${c.confidence})`);
	}

	assert(result.commitments.length > 0, 'Expected at least 1 commitment from synthetic messages');

	return result;
}

// ─── Phase 3: Embed + Store ──────────────────────────────────────────────────

async function phase3EmbedAndStore(
	extractResult: Awaited<ReturnType<typeof phase2Extract>>,
	envelope: SealedEnvelope,
) {
	log('PHASE 3', 'Generate embeddings (OpenAI API) + store commitments & memories');

	const contactId = ALICE_CONTACTS.aptosFund;
	const salt = Buffer.from(ALICE_WORKSPACE_ID);

	// Store commitments
	for (const commitment of extractResult.commitments) {
		if (commitment.confidence <= 0.5) continue;

		const embedding = await generateEmbedding(commitment.title);
		console.log(`  Embedding for "${commitment.title}": ${embedding.length} dims`);

		const stored = await createCommitment(
			ALICE_WORKSPACE_ID,
			{
				contactId,
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
			console.log(`  Stored commitment: ${stored.id} (status=${stored.status})`);
		}
	}

	// Store a memory with entity masking
	const rawContent =
		'Marcus sent the Polygon zkEVM term sheet. 200K POL tokens at $0.80. Counter-proposal due Wednesday.';
	const entities = prefilterEntities(rawContent);
	const { maskedText } = maskEntities(rawContent, salt, entities);

	console.log(`  Masked content: "${maskedText}"`);

	const memEmbedding = await generateEmbedding(maskedText);
	const mem = await createMemory(
		ALICE_WORKSPACE_ID,
		{
			contactId,
			category: 'financial',
			content: rawContent,
			contentSanitized: maskedText,
			embedding: memEmbedding,
		},
		envelope,
	);

	if (mem) {
		createdMemoryIds.push(mem.id);
		console.log(`  Stored memory: ${mem.id}`);
	}

	console.log(
		`  Total stored: ${createdCommitmentIds.length} commitments, ${createdMemoryIds.length} memories`,
	);
}

// ─── Phase 4: Brief + Feedback ───────────────────────────────────────────────

async function phase4BriefAndFeedback(envelope: SealedEnvelope) {
	log('PHASE 4', 'Generate brief (Claude API) + send feedback rewards');

	// Generate brief with bandit
	const briefResult = await generateBriefWithBandit(ALICE_USER_ID, ALICE_WORKSPACE_ID, envelope);

	console.log(`  Tone variant: ${briefResult.toneVariant}`);
	console.log(`  Detail variant: ${briefResult.detailVariant}`);
	console.log(`  Tone trace: ${briefResult.toneTraceId}`);
	console.log(`  Detail trace: ${briefResult.detailTraceId}`);
	console.log('\n--- BRIEF TEXT ---');
	console.log(briefResult.text);
	console.log('--- END BRIEF ---\n');

	createdBanditTraceIds.push(briefResult.toneTraceId, briefResult.detailTraceId);

	// Feedback: mark first commitment as completed (reward=1.0)
	if (createdCommitmentIds.length > 0) {
		const updated = await updateCommitmentStatus(
			ALICE_WORKSPACE_ID,
			createdCommitmentIds[0],
			'completed',
		);
		console.log(`  Commitment ${createdCommitmentIds[0]} → completed`);

		// Send reward for extraction
		if (updated?.banditTraceId) {
			await finalizeBanditReward(updated.banditTraceId, 1.0);
			console.log(`  Reward 1.0 sent for extraction trace ${updated.banditTraceId}`);
		}
	}

	// Feedback: dismiss brief tone (reward=0.0) to test learning
	await finalizeBanditReward(briefResult.toneTraceId, 0.0);
	console.log(`  Reward 0.0 sent for tone trace ${briefResult.toneTraceId}`);

	// Feedback: accept brief detail (reward=1.0)
	await finalizeBanditReward(briefResult.detailTraceId, 1.0);
	console.log(`  Reward 1.0 sent for detail trace ${briefResult.detailTraceId}`);

	return briefResult;
}

// ─── Phase 5: Verify ─────────────────────────────────────────────────────────

async function phase5Verify(
	statsBefore: Awaited<ReturnType<typeof getBanditStats>>,
	briefResult: Awaited<ReturnType<typeof phase4BriefAndFeedback>>,
) {
	log('PHASE 5', 'Verify bandit stats shifted');

	const statsAfter = await getBanditStats(ALICE_USER_ID);
	console.log(`  Bandit stats after (${statsAfter.length} variants):`);
	for (const s of statsAfter) {
		console.log(`    ${s.promptVariant}: alpha=${s.alphaScore} beta=${s.betaScore}`);
	}

	// Check that the tone variant we dismissed has higher beta (more failures)
	const toneBefore = statsBefore.find((s) => s.promptVariant === briefResult.toneVariant);
	const toneAfter = statsAfter.find((s) => s.promptVariant === briefResult.toneVariant);

	if (toneBefore && toneAfter) {
		assert(
			toneAfter.betaScore > toneBefore.betaScore,
			`Tone variant ${briefResult.toneVariant}: beta should have increased (before=${toneBefore.betaScore}, after=${toneAfter.betaScore})`,
		);
		console.log(
			`  Tone ${briefResult.toneVariant}: beta ${toneBefore.betaScore} → ${toneAfter.betaScore} (increased after dismiss)`,
		);
	} else {
		// New variant — just verify it exists now
		assert(!!toneAfter, `Tone variant ${briefResult.toneVariant} should exist in stats after`);
		console.log(`  Tone ${briefResult.toneVariant}: new variant, beta=${toneAfter?.betaScore}`);
	}

	// Check that the detail variant we accepted has higher alpha (more successes)
	const detailBefore = statsBefore.find((s) => s.promptVariant === briefResult.detailVariant);
	const detailAfter = statsAfter.find((s) => s.promptVariant === briefResult.detailVariant);

	if (detailBefore && detailAfter) {
		assert(
			detailAfter.alphaScore > detailBefore.alphaScore,
			`Detail variant ${briefResult.detailVariant}: alpha should have increased (before=${detailBefore.alphaScore}, after=${detailAfter.alphaScore})`,
		);
		console.log(
			`  Detail ${briefResult.detailVariant}: alpha ${detailBefore.alphaScore} → ${detailAfter.alphaScore} (increased after accept)`,
		);
	} else {
		assert(
			!!detailAfter,
			`Detail variant ${briefResult.detailVariant} should exist in stats after`,
		);
		console.log(
			`  Detail ${briefResult.detailVariant}: new variant, alpha=${detailAfter?.alphaScore}`,
		);
	}

	console.log('\n  All assertions passed!');
}

// ─── Phase 6: Cleanup ────────────────────────────────────────────────────────

async function phase6Cleanup() {
	log('PHASE 6', 'Cleaning up test-created rows');

	if (createdCommitmentIds.length > 0) {
		for (const id of createdCommitmentIds) {
			await db.execute(sql`DELETE FROM commitments WHERE id = ${id}::uuid`);
		}
		console.log(`  Deleted ${createdCommitmentIds.length} commitments`);
	}

	if (createdMemoryIds.length > 0) {
		for (const id of createdMemoryIds) {
			await db.execute(sql`DELETE FROM memories WHERE id = ${id}::uuid`);
		}
		console.log(`  Deleted ${createdMemoryIds.length} memories`);
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
	console.log('=== Gordian v2 — E2E Recursive Learning Loop ===');
	console.log(`ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? 'set' : 'MISSING'}`);
	console.log(`OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? 'set' : 'MISSING'}`);
	console.log('');

	assert(!!process.env.ANTHROPIC_API_KEY, 'ANTHROPIC_API_KEY must be set');
	assert(!!process.env.OPENAI_API_KEY, 'OPENAI_API_KEY must be set');

	try {
		const { envelope, statsBefore } = await phase1Setup();
		const extractResult = await phase2Extract(envelope);
		await phase3EmbedAndStore(extractResult, envelope);
		const briefResult = await phase4BriefAndFeedback(envelope);
		await phase5Verify(statsBefore, briefResult);
		await phase6Cleanup();

		console.log('\n=== E2E LOOP COMPLETE — ALL PHASES PASSED ===\n');
	} catch (err) {
		console.error('\n=== E2E LOOP FAILED ===');
		console.error(err);

		// Still try to clean up
		try {
			await phase6Cleanup();
		} catch {
			console.error('Cleanup also failed');
		}

		process.exit(1);
	}
}

main();
