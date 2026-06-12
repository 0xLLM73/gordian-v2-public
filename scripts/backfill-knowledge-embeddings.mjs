/**
 * One-time backfill: re-embed all knowledge node embeddings with ELM masking.
 *
 * Before SEC-122 (1764bab), knowledge node embeddings were generated from raw
 * unmasked text. This script re-embeds them using maskEntities + prefilterEntities
 * to ensure consistency with the new pipeline.
 *
 * Usage:
 *   npx tsx scripts/backfill-knowledge-embeddings.mjs              # real run
 *   npx tsx scripts/backfill-knowledge-embeddings.mjs --dry-run    # preview only
 *
 * Requires: DIRECT_URL, AWS credentials (for KMS unwrap), and either local
 * knowledge embeddings or AI_PROCESSING_ENABLED=true for cloud embeddings.
 */
import 'dotenv/config';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const postgres = require('../packages/db/node_modules/postgres');

import { generateEmbedding } from '../apps/worker/src/ai/embeddings.ts';
import { prefilterEntities } from '../apps/worker/src/ai/prefilter.ts';
import { deriveKeys, maskEntities, unwrapWrk } from '../packages/crypto/src/index.ts';

// ─── Config ──────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 50;
const RATE_LIMIT_MS = 100;

const DIRECT_URL = process.env.DIRECT_URL;
if (!DIRECT_URL) {
	console.error('Missing DIRECT_URL env var');
	process.exit(1);
}

const sql = postgres(DIRECT_URL, { prepare: false });

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
	const startTime = Date.now();

	console.log(`[backfill] Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
	console.log('[backfill] Fetching workspaces with knowledge nodes...');

	// Fetch workspaces that have knowledge nodes
	const workspaces = await sql`
		SELECT DISTINCT kn.workspace_id, w.encrypted_wrk, w.kms_context, w.wrk_version
		FROM knowledge_nodes kn
		JOIN workspaces w ON w.id = kn.workspace_id
	`;

	if (workspaces.length === 0) {
		console.log('[backfill] No workspaces with knowledge nodes found.');
		await sql.end();
		return;
	}

	console.log(`[backfill] Found ${workspaces.length} workspace(s) with knowledge nodes`);

	let totalReembedded = 0;
	let totalErrors = 0;

	for (const ws of workspaces) {
		const workspaceId = ws.workspace_id;
		console.log(`\n[backfill] Processing workspace=${workspaceId.slice(0, 8)}...`);

		// Derive workspaceSalt from envelope
		let workspaceSalt;
		try {
			const rawCtx = ws.kms_context;
			const kmsContext = typeof rawCtx === 'string' ? JSON.parse(rawCtx) : rawCtx;

			const envelope = {
				encryptedWrk: Buffer.from(ws.encrypted_wrk, 'base64'),
				kmsContext,
				wrkVersion: ws.wrk_version,
			};

			const wrk = await unwrapWrk(envelope);
			const keys = await deriveKeys(wrk, workspaceId, envelope.wrkVersion);
			workspaceSalt = keys.bik;
		} catch (err) {
			console.error(
				`[backfill] Failed to derive salt for workspace=${workspaceId.slice(0, 8)}: ${err.message}`,
			);
			totalErrors++;
			continue;
		}

		// Fetch all knowledge nodes for this workspace
		const nodes = await sql`
			SELECT id, type, display_name, description
			FROM knowledge_nodes
			WHERE workspace_id = ${workspaceId}
		`;

		console.log(`[backfill] Found ${nodes.length} nodes in workspace=${workspaceId.slice(0, 8)}`);

		let wsReembedded = 0;
		let wsErrors = 0;

		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i];

			try {
				// Reconstruct composite embedding input (same as llmExtractEntities)
				const rawInput = node.description
					? `Type: ${node.type} | Name: ${node.display_name} | Context: ${node.description}`
					: `Type: ${node.type} | Name: ${node.display_name}`;

				// Mask with ELM
				const detected = prefilterEntities(rawInput);
				const { maskedText } = maskEntities(rawInput, workspaceSalt, detected);

				if (DRY_RUN) {
					console.log(
						`[backfill] [DRY RUN] Would re-embed node=${node.id.slice(0, 8)} "${node.display_name}" → masked="${maskedText.slice(0, 80)}..."`,
					);
					wsReembedded++;
				} else {
					// Generate new embedding from masked text
					const embedding = await generateEmbedding(maskedText, { purpose: 'document' });
					const embeddingStr = `[${embedding.join(',')}]`;

					// Update in database
					await sql`
						UPDATE knowledge_nodes
						SET embedding = ${embeddingStr}::vector
						WHERE id = ${node.id} AND workspace_id = ${workspaceId}
					`;

					wsReembedded++;

					// Rate limit
					await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
				}
			} catch (err) {
				console.error(
					`[backfill] Error on node=${node.id.slice(0, 8)} "${node.display_name}": ${err.message}`,
				);
				wsErrors++;
			}

			// Progress log every BATCH_SIZE nodes
			if ((i + 1) % BATCH_SIZE === 0) {
				console.log(
					`[backfill] Progress: ${i + 1}/${nodes.length} nodes (workspace=${workspaceId.slice(0, 8)})`,
				);
			}
		}

		console.log(
			`[backfill] Workspace=${workspaceId.slice(0, 8)} done: ${wsReembedded} re-embedded, ${wsErrors} errors`,
		);

		totalReembedded += wsReembedded;
		totalErrors += wsErrors;
	}

	const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

	console.log(`\n${'='.repeat(60)}`);
	console.log(`[backfill] Complete${DRY_RUN ? ' (DRY RUN)' : ''}`);
	console.log(`[backfill] Total re-embedded: ${totalReembedded}`);
	console.log(`[backfill] Total errors: ${totalErrors}`);
	console.log(`[backfill] Elapsed: ${elapsed}s`);
	console.log('='.repeat(60));

	await sql.end();
}

main().catch((err) => {
	console.error('[backfill] Fatal error:', err);
	process.exit(1);
});
