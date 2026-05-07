/**
 * Smoke test: Verify the AI Learning Feedback Loop is wired end-to-end.
 *
 * Checks that the feedback loop tables have data and the domain mismatch
 * bug is fixed. Does NOT trigger extraction — just verifies the pipeline
 * state against a live database.
 *
 * Usage: pnpm tsx scripts/smoke-feedback-loop.ts
 *
 * Optional: WORKER_URL + INTERNAL_AUTH_SECRET to also trigger a reprocess.
 */

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const DATABASE_URL =
	process.env.DATABASE_URL ?? 'postgresql://gordian:gordian@localhost:5433/gordian_dev';

const client = postgres(DATABASE_URL, { prepare: false, max: 5 });
const db = drizzle(client);

type TestResult = { name: string; passed: boolean; detail: string };
const results: TestResult[] = [];

function record(name: string, passed: boolean, detail: string) {
	results.push({ name, passed, detail });
	const icon = passed ? '✅' : '❌';
	console.log(`  ${icon} ${name}: ${detail}`);
}

// ─── Test 1: Domain mismatch fix ──────────────────────────────────────────────

async function testDomainMismatch() {
	console.log('\n=== Test 1: Golden Dataset Domain Mismatch Fix ===\n');

	// Check if any rows still use the old broken domain
	const oldDomain = (await db.execute(
		sql`SELECT count(*) AS cnt FROM golden_dataset WHERE feature_domain = 'seed_commitment_extraction'`,
	)) as unknown as Array<{ cnt: string }>;

	const oldCount = Number(oldDomain[0]?.cnt ?? 0);

	// Check how many rows use the correct domain
	const newDomain = (await db.execute(
		sql`SELECT count(*) AS cnt FROM golden_dataset WHERE feature_domain = 'commitment_extraction'`,
	)) as unknown as Array<{ cnt: string }>;

	const newCount = Number(newDomain[0]?.cnt ?? 0);

	if (oldCount > 0) {
		record(
			'Domain mismatch fix',
			false,
			`${oldCount} rows still use 'seed_commitment_extraction' — run: UPDATE golden_dataset SET feature_domain = 'commitment_extraction' WHERE feature_domain = 'seed_commitment_extraction'`,
		);
	} else {
		record(
			'Domain mismatch fix',
			true,
			`No rows with old domain. ${newCount} rows use 'commitment_extraction'.`,
		);
	}
}

// ─── Test 2: Golden examples from implicit signals ────────────────────────────

async function testImplicitGoldenExamples() {
	console.log('\n=== Test 2: Implicit Signal Golden Examples ===\n');

	const rows = (await db.execute(
		sql`SELECT count(*) AS cnt FROM golden_dataset WHERE source = 'implicit_signal'`,
	)) as unknown as Array<{ cnt: string }>;

	const count = Number(rows[0]?.cnt ?? 0);

	record(
		'Implicit golden examples exist',
		count > 0,
		count > 0
			? `${count} auto-generated golden examples from extraction feedback`
			: 'No implicit_signal examples yet — run an extraction to generate them',
	);
}

// ─── Test 3: Correction diffs ─────────────────────────────────────────────────

async function testCorrectionDiffs() {
	console.log('\n=== Test 3: Correction Diffs ===\n');

	const total = (await db.execute(
		sql`SELECT count(*) AS cnt FROM correction_diffs`,
	)) as unknown as Array<{ cnt: string }>;

	const totalCount = Number(total[0]?.cnt ?? 0);

	const byType = (await db.execute(
		sql`SELECT diff_type, count(*) AS cnt FROM correction_diffs GROUP BY diff_type ORDER BY cnt DESC`,
	)) as unknown as Array<{ diff_type: string; cnt: string }>;

	const breakdown = byType.map((r) => `${r.diff_type}=${r.cnt}`).join(', ');

	record(
		'Correction diffs exist',
		totalCount > 0,
		totalCount > 0
			? `${totalCount} diffs (${breakdown})`
			: 'No correction diffs yet — run extraction or promote/reject examples',
	);

	// Check embedded diffs
	const embedded = (await db.execute(
		sql`SELECT count(*) AS cnt FROM correction_diffs WHERE mistake_embedding IS NOT NULL`,
	)) as unknown as Array<{ cnt: string }>;

	const embeddedCount = Number(embedded[0]?.cnt ?? 0);

	record(
		'Diff embeddings generated',
		embeddedCount > 0 || totalCount === 0,
		totalCount === 0
			? 'N/A — no diffs to embed yet'
			: `${embeddedCount}/${totalCount} diffs have embeddings`,
	);
}

// ─── Test 4: Bandit ledger finalization ───────────────────────────────────────

async function testBanditLedger() {
	console.log('\n=== Test 4: Bandit Ledger Finalization ===\n');

	const total = (await db.execute(
		sql`SELECT count(*) AS cnt FROM bandit_ledger`,
	)) as unknown as Array<{ cnt: string }>;

	const totalCount = Number(total[0]?.cnt ?? 0);

	const finalized = (await db.execute(
		sql`SELECT count(*) AS cnt FROM bandit_ledger WHERE is_finalized = true`,
	)) as unknown as Array<{ cnt: string }>;

	const finalizedCount = Number(finalized[0]?.cnt ?? 0);

	record(
		'Bandit trials exist',
		totalCount > 0,
		totalCount > 0
			? `${totalCount} total trials`
			: 'No bandit trials yet — run an extraction to generate them',
	);

	record(
		'Bandit rewards finalized',
		finalizedCount > 0 || totalCount === 0,
		totalCount === 0
			? 'N/A — no trials yet'
			: `${finalizedCount}/${totalCount} trials finalized with rewards`,
	);
}

// ─── Test 5: Semantic patterns ────────────────────────────────────────────────

async function testSemanticPatterns() {
	console.log('\n=== Test 5: Semantic Patterns (from DBSCAN clustering) ===\n');

	const rows = (await db.execute(
		sql`SELECT count(*) AS cnt FROM semantic_patterns WHERE feature_domain = 'commitment_extraction'`,
	)) as unknown as Array<{ cnt: string }>;

	const count = Number(rows[0]?.cnt ?? 0);

	record(
		'Semantic patterns exist',
		count > 0,
		count > 0
			? `${count} patterns for commitment_extraction domain`
			: 'No patterns yet — needs correction diffs with embeddings + nightly DBSCAN clustering',
	);

	if (count > 0) {
		const top = (await db.execute(
			sql`SELECT pattern_text, confidence_score FROM semantic_patterns
				WHERE feature_domain = 'commitment_extraction'
				ORDER BY confidence_score DESC LIMIT 3`,
		)) as unknown as Array<{ pattern_text: string; confidence_score: number }>;

		for (const p of top) {
			console.log(
				`    → "${p.pattern_text}" (confidence: ${Number(p.confidence_score).toFixed(2)})`,
			);
		}
	}
}

// ─── Test 6: Trigger extraction via admin (optional) ──────────────────────────

async function testAdminReprocess() {
	const workerUrl = process.env.WORKER_URL;
	const internalSecret = process.env.INTERNAL_AUTH_SECRET;

	if (!workerUrl || !internalSecret) {
		console.log('\n=== Test 6: Admin Reprocess (skipped) ===\n');
		console.log('  ⏭️  Set WORKER_URL and INTERNAL_AUTH_SECRET to enable admin endpoint tests');
		return;
	}

	console.log('\n=== Test 6: Admin Reprocess Trigger ===\n');

	// Get a workspace to reprocess
	const workspace = (await db.execute(
		sql`SELECT w.id AS workspace_id, wm.user_id
			FROM workspaces w
			JOIN workspace_members wm ON wm.workspace_id = w.id
			LIMIT 1`,
	)) as unknown as Array<{ workspace_id: string; user_id: string }>;

	if (workspace.length === 0) {
		record('Admin reprocess', false, 'No workspaces found');
		return;
	}

	const { workspace_id, user_id } = workspace[0];

	try {
		const res = await fetch(`${workerUrl}/admin/reprocess-messages`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': internalSecret,
			},
			body: JSON.stringify({ workspaceId: workspace_id, userId: user_id }),
		});

		const body = await res.json();
		record(
			'Admin reprocess trigger',
			res.ok,
			res.ok
				? `Queued ${body.contactsProcessed} contacts for reprocessing`
				: `HTTP ${res.status}: ${JSON.stringify(body)}`,
		);
	} catch (err) {
		record('Admin reprocess trigger', false, `Network error: ${(err as Error).message}`);
	}
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
	console.log('╔══════════════════════════════════════════════════╗');
	console.log('║  Gordian v2 — Feedback Loop Smoke Test          ║');
	console.log('╚══════════════════════════════════════════════════╝');

	await testDomainMismatch();
	await testImplicitGoldenExamples();
	await testCorrectionDiffs();
	await testBanditLedger();
	await testSemanticPatterns();
	await testAdminReprocess();

	console.log('\n═══════════════════════════════════════');
	console.log('  SUMMARY');
	console.log('═══════════════════════════════════════');

	for (const r of results) {
		console.log(`  ${r.passed ? '✅' : '❌'} ${r.name}`);
	}

	const passed = results.filter((r) => r.passed).length;
	const total = results.length;
	console.log(`\n  ${passed}/${total} checks passed\n`);

	await client.end();

	const allPassed = results.every((r) => r.passed);
	process.exit(allPassed ? 0 : 1);
}

main();
