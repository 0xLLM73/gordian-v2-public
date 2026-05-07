/**
 * Verify that recursive learning features work against the seeded data.
 * Tests: Thompson Sampling, Hybrid Search, Golden Dataset retrieval.
 *
 * Usage: pnpm tsx scripts/verify-learning.ts
 */

import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../packages/db/src/schema/index';

const DATABASE_URL =
	process.env.DATABASE_URL ?? 'postgresql://gordian:gordian@localhost:5433/gordian_dev';

const client = postgres(DATABASE_URL, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

// ─── Deterministic embedding (same as seed script) ───────────────────────────

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

// ─── Thompson Sampling (same algorithm as bandit.ts) ─────────────────────────

function gammaVariate(alpha: number): number {
	if (alpha < 1) {
		const u = Math.random();
		return gammaVariate(alpha + 1) * u ** (1 / alpha);
	}
	const d = alpha - 1 / 3;
	const c = 1 / Math.sqrt(9 * d);
	for (;;) {
		let x: number;
		let v: number;
		do {
			x = normalRandom();
			v = 1 + c * x;
		} while (v <= 0);
		v = v * v * v;
		const u = Math.random();
		if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
		if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
	}
}

function normalRandom(): number {
	const u1 = Math.random();
	const u2 = Math.random();
	return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function sampleBeta(alpha: number, beta: number): number {
	const x = gammaVariate(alpha);
	const y = gammaVariate(beta);
	return x / (x + y);
}

// ─── Test 1: Thompson Sampling convergence ───────────────────────────────────

async function testThompsonSampling() {
	console.log('\n=== Test 1: Thompson Sampling Convergence ===\n');

	// Get bandit stats from DB (same query as getBanditStats in DAL)
	const stats = await db.execute(sql`
		SELECT
			user_id,
			prompt_variant,
			feature_context,
			1 + COALESCE(SUM(reward_score) FILTER (WHERE is_finalized), 0) AS alpha,
			1 + COALESCE(COUNT(*) FILTER (WHERE is_finalized) - SUM(reward_score) FILTER (WHERE is_finalized), 0) AS beta
		FROM bandit_ledger
		WHERE feature_context = 'morning_brief_tone'
			AND created_at > NOW() - INTERVAL '90 days'
		GROUP BY user_id, prompt_variant, feature_context
		ORDER BY user_id, prompt_variant
	`);

	const rows = stats as unknown as Array<{
		user_id: string;
		prompt_variant: string;
		feature_context: string;
		alpha: number;
		beta: number;
	}>;

	// Get user names
	const userNames = await db.execute(
		sql`SELECT id, name FROM users WHERE email LIKE '%@gordian.dev'`,
	);
	const nameMap = new Map(
		(userNames as unknown as Array<{ id: string; name: string }>).map((u) => [u.id, u.name]),
	);

	// Group by user
	const byUser = new Map<string, Array<{ variant: string; alpha: number; beta: number }>>();
	for (const row of rows) {
		const name = nameMap.get(row.user_id) ?? row.user_id;
		const list = byUser.get(name) ?? [];
		list.push({ variant: row.prompt_variant, alpha: Number(row.alpha), beta: Number(row.beta) });
		byUser.set(name, list);
	}

	// Simulate 1000 Thompson Sampling draws per user
	const DRAWS = 1000;
	let allPassed = true;

	for (const [userName, variants] of byUser) {
		const wins: Record<string, number> = {};
		for (const v of variants) {
			wins[v.variant] = 0;
		}

		for (let i = 0; i < DRAWS; i++) {
			let bestVariant = '';
			let bestSample = -1;
			for (const v of variants) {
				const sample = sampleBeta(v.alpha, v.beta);
				if (sample > bestSample) {
					bestSample = sample;
					bestVariant = v.variant;
				}
			}
			wins[bestVariant] = (wins[bestVariant] ?? 0) + 1;
		}

		const formalPct = (((wins.brief_tone_formal ?? 0) / DRAWS) * 100).toFixed(1);
		const casualPct = (((wins.brief_tone_casual ?? 0) / DRAWS) * 100).toFixed(1);

		console.log(`  ${userName}:`);
		for (const v of variants) {
			console.log(`    ${v.variant}: alpha=${v.alpha}, beta=${v.beta}`);
		}
		console.log(`    → Thompson selects: formal=${formalPct}%, casual=${casualPct}%`);

		// Verify expected behavior
		if (userName === 'VC Alice') {
			const pass = Number(formalPct) > 90;
			console.log(`    ✓ Expected: formal >90% → ${pass ? 'PASS' : 'FAIL'}`);
			if (!pass) allPassed = false;
		} else if (userName === 'Degen Bob') {
			const pass = Number(casualPct) > 90;
			console.log(`    ✓ Expected: casual >90% → ${pass ? 'PASS' : 'FAIL'}`);
			if (!pass) allPassed = false;
		} else if (userName === 'Governance Charlie') {
			const formalNum = Number(formalPct);
			const pass = formalNum > 20 && formalNum < 80;
			console.log(`    ✓ Expected: mixed (20-80% each) → ${pass ? 'PASS' : 'FAIL'}`);
			if (!pass) allPassed = false;
		}
		console.log('');
	}

	return allPassed;
}

// ─── Test 2: Semantic search (vector cosine similarity) ──────────────────────

async function testSemanticSearch() {
	console.log('=== Test 2: Semantic Search (Vector Exact Match) ===\n');

	// Mock embeddings are hash-based (deterministic but NOT semantic).
	// Same text → same vector (dist=0), different text → uncorrelated distance.
	// Use the exact sanitized content to verify the pipeline works end-to-end.
	const queryText =
		'The valuation for the Aptos round is set at $2B FDV. Sending the SAFT now. Marcus confirmed allocation of 500K tokens at $4.00 per token.';
	const queryVec = generateDeterministicVector(queryText);
	const vecStr = `[${queryVec.join(',')}]`;

	// Search memories by cosine distance
	const results = await db.execute(sql`
		SELECT
			content_sanitized,
			category,
			(embedding::vector(1536) <=> ${vecStr}::vector(1536)) as distance
		FROM memories
		WHERE embedding IS NOT NULL
		ORDER BY embedding::vector(1536) <=> ${vecStr}::vector(1536)
		LIMIT 5
	`);

	const rows = results as unknown as Array<{
		content_sanitized: string;
		category: string;
		distance: number;
	}>;

	console.log('  Query: exact Aptos SAFT content (mock embedding = exact match test)\n');
	let topIsExact = false;
	for (let i = 0; i < rows.length; i++) {
		const r = rows[i];
		const dist = Number(r.distance).toFixed(6);
		const snippet = r.content_sanitized.slice(0, 80);
		console.log(`  ${i + 1}. [${r.category}] dist=${dist} — "${snippet}..."`);
		if (i === 0 && Number(r.distance) < 0.001) {
			topIsExact = true;
		}
	}

	console.log(
		`\n  ✓ Exact content → exact embedding match (dist≈0) → ${topIsExact ? 'PASS' : 'FAIL'}`,
	);
	console.log('  ℹ  Mock embeddings are hash-based. For true semantic search, use OPENAI_API_KEY.');
	console.log('');
	return topIsExact;
}

// ─── Test 3: Golden Dataset retrieval ────────────────────────────────────────

async function testGoldenDataset() {
	console.log('=== Test 3: Golden Dataset Retrieval ===\n');

	// Query for commitment extraction examples using vector similarity
	const queryText =
		'Marcus said: "We will wire the $2M by Friday. Please have the execution version of the SAFT ready."';
	const queryVec = generateDeterministicVector(queryText);
	const vecStr = `[${queryVec.join(',')}]`;

	const results = await db.execute(sql`
		SELECT
			feature_domain,
			left(input_context, 80) as context_preview,
			status,
			verification_score,
			(input_embedding <=> ${vecStr}::vector(1536)) as distance
		FROM golden_dataset
		WHERE status = 'verified'
		ORDER BY input_embedding <=> ${vecStr}::vector(1536)
		LIMIT 3
	`);

	const rows = results as unknown as Array<{
		feature_domain: string;
		context_preview: string;
		status: string;
		verification_score: number;
		distance: number;
	}>;

	console.log('  Query: "SAFT wire $2M by Friday"\n');
	let topIsExact = false;
	for (let i = 0; i < rows.length; i++) {
		const r = rows[i];
		const dist = Number(r.distance).toFixed(4);
		console.log(
			`  ${i + 1}. [${r.feature_domain}] dist=${dist} score=${r.verification_score} — "${r.context_preview}..."`,
		);
		if (i === 0 && Number(r.distance) < 0.001) {
			topIsExact = true;
		}
	}

	console.log(`\n  ✓ Exact match found (dist≈0) → ${topIsExact ? 'PASS' : 'FAIL'}`);
	console.log('');
	return topIsExact;
}

// ─── Test 4: Causal graph traversal ──────────────────────────────────────────

async function testCausalGraph() {
	console.log('=== Test 4: Causal Graph (Decision → Consequence) ===\n');

	const edges = await db.execute(sql`
		SELECT
			s.raw_content as source_decision,
			t.raw_content as target_decision,
			e.weight,
			e.edge_type,
			e.confidence_score
		FROM causal_edges e
		JOIN user_decisions s ON s.id = e.source_id
		JOIN user_decisions t ON t.id = e.target_id
	`);

	const rows = edges as unknown as Array<{
		source_decision: string;
		target_decision: string;
		weight: number;
		edge_type: string;
		confidence_score: number;
	}>;

	let hasEdge = false;
	for (const r of rows) {
		console.log(`  Source: "${r.source_decision}"`);
		console.log(`  Target: "${r.target_decision}"`);
		console.log(
			`  Edge: type=${r.edge_type}, weight=${r.weight}, confidence=${r.confidence_score}`,
		);
		hasEdge = true;
	}

	console.log(`\n  ✓ Causal edge exists → ${hasEdge ? 'PASS' : 'FAIL'}`);
	console.log('');
	return hasEdge;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
	console.log('╔══════════════════════════════════════════════════╗');
	console.log('║  Gordian v2 — Recursive Learning Verification   ║');
	console.log('╚══════════════════════════════════════════════════╝');

	const results = {
		thompson: await testThompsonSampling(),
		semantic: await testSemanticSearch(),
		golden: await testGoldenDataset(),
		causal: await testCausalGraph(),
	};

	console.log('═══════════════════════════════════════');
	console.log('  RESULTS');
	console.log('═══════════════════════════════════════');
	console.log(`  Thompson Sampling:  ${results.thompson ? '✅ PASS' : '❌ FAIL'}`);
	console.log(`  Semantic Search:    ${results.semantic ? '✅ PASS' : '❌ FAIL'}`);
	console.log(`  Golden Dataset:     ${results.golden ? '✅ PASS' : '❌ FAIL'}`);
	console.log(`  Causal Graph:       ${results.causal ? '✅ PASS' : '❌ FAIL'}`);
	console.log('═══════════════════════════════════════');

	const allPassed = Object.values(results).every(Boolean);
	console.log(
		`\n  ${allPassed ? '✅ All recursive learning features verified!' : '❌ Some features failed.'}\n`,
	);

	await client.end();
	process.exit(allPassed ? 0 : 1);
}

main();
