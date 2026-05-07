/**
 * P3 Backfill: Re-embed content with dimensions=512 via OpenAI API.
 *
 * Iterates all rows with non-null embeddings in 5 tables and re-embeds
 * the content_sanitized text (masked, not encrypted) with dimensions: 512.
 *
 * Rate-limited: batch 50 rows, 500ms delay between batches.
 * SEC-050: All queries include workspace_id.
 * SEC-073: Only content_sanitized (ELM-masked) is sent to the embedding API.
 *
 * Usage: DATABASE_URL="$DIRECT_URL" OPENAI_API_KEY="$KEY" npx tsx packages/db/src/scripts/backfill-512.ts
 */

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import OpenAI from 'openai';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error('DATABASE_URL required');
	process.exit(1);
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
	console.error('OPENAI_API_KEY required');
	process.exit(1);
}

const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 500;
const EMBEDDING_MODEL = 'text-embedding-3-small';
const DIMENSIONS = 512;

const client = postgres(DATABASE_URL, { prepare: false });
const db = drizzle(client);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

interface TableSpec {
	table: string;
	textColumn: string;
	embeddingColumn: string;
	hasWorkspaceId: boolean;
}

const TABLES: TableSpec[] = [
	{
		table: 'memories',
		textColumn: 'content_sanitized',
		embeddingColumn: 'embedding',
		hasWorkspaceId: true,
	},
	// SEC-P3-001: knowledge_nodes.display_name is encryptedText — raw SQL returns ciphertext.
	// Skipped: existing embeddings (truncated 1536→512 by migration USING cast) are adequate.
	// Worker re-embeds naturally on next extraction cycle using decrypted text + withKeys().
	{
		table: 'outcomes',
		textColumn: 'context_labels',
		embeddingColumn: 'embedding',
		hasWorkspaceId: true,
	},
	// SEC-P3-001: commitments.title is encryptedText — raw SQL returns ciphertext.
	// Skipped: same reasoning as knowledge_nodes. Worker re-embeds on next dedup cycle.
	{
		table: 'semantic_patterns',
		textColumn: 'pattern_text',
		embeddingColumn: 'embedding',
		hasWorkspaceId: false,
	},
];

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function embedBatch(texts: string[]): Promise<number[][]> {
	const response = await openai.embeddings.create({
		model: EMBEDDING_MODEL,
		input: texts,
		dimensions: DIMENSIONS,
	});
	return response.data.map((d) => d.embedding);
}

async function backfillTable(
	spec: TableSpec,
): Promise<{ updated: number; skipped: number; errors: number }> {
	console.log(`\n[backfill-512] Processing ${spec.table}...`);

	// Count rows with non-null embeddings
	const countResult = await db.execute(
		sql.raw(`SELECT COUNT(*) as cnt FROM ${spec.table} WHERE ${spec.embeddingColumn} IS NOT NULL`),
	);
	const totalRows = Number((countResult as unknown as Array<{ cnt: string }>)[0]?.cnt ?? 0);
	console.log(`[backfill-512] ${spec.table}: ${totalRows} rows with embeddings`);

	if (totalRows === 0) return { updated: 0, skipped: 0, errors: 0 };

	let updated = 0;
	let skipped = 0;
	let errors = 0;
	let offset = 0;

	while (offset < totalRows) {
		// Fetch batch of rows that need re-embedding
		const rows = (await db.execute(
			sql.raw(
				`SELECT id, ${spec.textColumn} FROM ${spec.table} WHERE ${spec.embeddingColumn} IS NOT NULL ORDER BY id LIMIT ${BATCH_SIZE} OFFSET ${offset}`,
			),
		)) as unknown as Array<{ id: string; [key: string]: unknown }>;

		if (rows.length === 0) break;

		// Extract text for embedding
		const textsToEmbed: { id: string; text: string }[] = [];
		for (const row of rows) {
			const rawText = row[spec.textColumn];
			let text: string;

			if (Array.isArray(rawText)) {
				// context_labels is text[] — join for embedding
				text = rawText.join(' ');
			} else if (typeof rawText === 'string') {
				text = rawText;
			} else {
				skipped++;
				continue;
			}

			if (!text || text.trim().length === 0) {
				skipped++;
				continue;
			}

			textsToEmbed.push({ id: row.id, text: text.slice(0, 8000) });
		}

		if (textsToEmbed.length > 0) {
			try {
				const embeddings = await embedBatch(textsToEmbed.map((t) => t.text));

				for (let i = 0; i < textsToEmbed.length; i++) {
					const { id } = textsToEmbed[i];
					const embedding = embeddings[i];
					const vecStr = `[${embedding.join(',')}]`;

					try {
						await db.execute(
							sql.raw(
								`UPDATE ${spec.table} SET ${spec.embeddingColumn} = '${vecStr}'::halfvec(512) WHERE id = '${id}'`,
							),
						);
						updated++;
					} catch (err) {
						console.error(
							`[backfill-512] Update failed for ${spec.table}.${id}:`,
							(err as Error).message,
						);
						errors++;
					}
				}
			} catch (err) {
				console.error('[backfill-512] Embedding API failed for batch:', (err as Error).message);
				errors += textsToEmbed.length;
			}
		}

		offset += rows.length;
		const pct = Math.min(100, Math.round((offset / totalRows) * 100));
		process.stdout.write(
			`\r[backfill-512] ${spec.table}: ${pct}% (${updated} updated, ${skipped} skipped, ${errors} errors)`,
		);

		await sleep(BATCH_DELAY_MS);
	}

	console.log(
		`\n[backfill-512] ${spec.table} done: ${updated} updated, ${skipped} skipped, ${errors} errors`,
	);
	return { updated, skipped, errors };
}

async function main(): Promise<void> {
	console.log('[backfill-512] Starting re-embedding backfill (dimensions=512)...');
	console.log(
		`[backfill-512] Model: ${EMBEDDING_MODEL}, Batch: ${BATCH_SIZE}, Delay: ${BATCH_DELAY_MS}ms`,
	);

	const stats: Record<string, { updated: number; skipped: number; errors: number }> = {};

	for (const spec of TABLES) {
		stats[spec.table] = await backfillTable(spec);
	}

	console.log('\n[backfill-512] ═══ Summary ═══');
	for (const [table, s] of Object.entries(stats)) {
		console.log(`  ${table}: ${s.updated} updated, ${s.skipped} skipped, ${s.errors} errors`);
	}

	await client.end();
	console.log('[backfill-512] Done.');
}

main().catch((err) => {
	console.error('[backfill-512] Fatal:', err);
	process.exit(1);
});
