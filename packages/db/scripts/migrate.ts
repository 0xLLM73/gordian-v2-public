import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';
import { loadRootEnv } from '../../../scripts/lib/load-root-env.mjs';
import { splitSqlStatements } from '../src/sql-splitter';

loadRootEnv();

const DATABASE_URL =
	process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/gordian_dev';
const MIGRATIONS_TABLE = '__gordian_migrations';
const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../drizzle');

const client = postgres(DATABASE_URL, { max: 1, prepare: false });

async function relationExists(schemaName: string, relationName: string): Promise<boolean> {
	const [row] = await client<{ exists: boolean }[]>`
		SELECT EXISTS (
			SELECT 1
			FROM pg_class c
			JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname = ${schemaName}
				AND c.relname = ${relationName}
				AND c.relkind IN ('r', 'p')
		) AS exists
	`;
	return row?.exists ?? false;
}

async function shouldSkipCompatibilityMigration(file: string): Promise<boolean> {
	// The initial Drizzle baseline already creates a non-partitioned memories
	// table. This later historical migration attempted to replace it with a
	// partitioned table, which cannot be applied in-place on a fresh baseline DB.
	if (file === '0004_memories.sql') return relationExists('public', 'memories');

	// Supabase creates the realtime schema and messages table outside this app's
	// Drizzle migrations. Plain Postgres demos do not have those objects.
	if (file === '0014_realtime_auth.sql') {
		return !(await relationExists('realtime', 'messages'));
	}

	return false;
}

async function ensurePrerequisites(): Promise<void> {
	await client.unsafe('CREATE EXTENSION IF NOT EXISTS pgcrypto');
	await client.unsafe('CREATE EXTENSION IF NOT EXISTS vector');
	await client.unsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm');
	await client.unsafe(`
		CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
			filename text PRIMARY KEY,
			applied_at timestamptz NOT NULL DEFAULT now()
		)
	`);
}

async function main(): Promise<void> {
	console.log(`[migrate] Database: ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);
	await ensurePrerequisites();

	const files = (await readdir(MIGRATIONS_DIR))
		.filter((file) => file.endsWith('.sql'))
		.sort((a, b) => a.localeCompare(b));

	const appliedRows = await client<{ filename: string }[]>`
		SELECT filename FROM __gordian_migrations
	`;
	const applied = new Set(appliedRows.map((row) => row.filename));

	for (const file of files) {
		if (applied.has(file)) {
			console.log(`[migrate] skip ${file}`);
			continue;
		}

		const migrationSql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
		console.log(`[migrate] apply ${file}`);

		if (await shouldSkipCompatibilityMigration(file)) {
			console.log(`[migrate] compatibility skip ${file}`);
		} else {
			for (const statement of splitSqlStatements(migrationSql)) {
				await client.unsafe(statement);
			}
		}
		await client`
			INSERT INTO __gordian_migrations (filename)
			VALUES (${file})
		`;
	}

	console.log('[migrate] complete');
}

main()
	.catch((err) => {
		console.error('[migrate] failed:', err);
		process.exit(1);
	})
	.finally(async () => {
		await client.end();
	});
