import { AsyncLocalStorage } from 'node:async_hooks';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { extractSqlText, guardExecute } from './execute-guard';
import * as schema from './schema/index';

// CRITICAL: prepare: false is MANDATORY for Supabase Supavisor (Transaction Mode)
// Without this, you get cryptic "prepared statement already exists" errors (ERR-006)
//
// Lazy initialization via Proxy: DATABASE_URL is read on first use, not at module
// evaluation time. This is required because in ESM, static imports are hoisted and
// evaluated before top-level await (e.g. dotenv loading in apps/worker/src/index.ts).
// Without lazy init, the worker's postgres.js client falls back to localhost:5432.

type Db = ReturnType<typeof drizzle<typeof schema>>;

/** AsyncLocalStorage holds the active RLS-scoped transaction when inside withWorkspaceRLS. */
const rlsTxStore = new AsyncLocalStorage<Db>();

let _db: Db | undefined;
let tempFileLimitWarningEmitted = false;

const DEFAULT_POSTGRES_TEMP_FILE_LIMIT = '256MB';
const DISABLED_POSTGRES_TEMP_FILE_LIMITS = new Set(['', '0', 'off', 'false', 'disabled', 'none']);
const POSTGRES_TEMP_FILE_LIMIT_PATTERN = /^-?1$|^\d+(?:B|kB|MB|GB|TB)?$/i;

function getDatabaseUrl(): string {
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) throw new Error('DATABASE_URL is not set');
	return databaseUrl;
}

function getDb(): Db {
	if (!_db) {
		const client = postgres(getDatabaseUrl(), {
			prepare: false,
			max: 10,
			idle_timeout: 20,
		});
		_db = drizzle(client, { schema });
	}
	return _db;
}

export function getConfiguredPostgresTempFileLimit(): string | null {
	const raw = process.env.POSTGRES_TEMP_FILE_LIMIT?.trim() ?? DEFAULT_POSTGRES_TEMP_FILE_LIMIT;
	if (DISABLED_POSTGRES_TEMP_FILE_LIMITS.has(raw.toLowerCase())) return null;
	if (!POSTGRES_TEMP_FILE_LIMIT_PATTERN.test(raw)) {
		throw new Error(
			`Invalid POSTGRES_TEMP_FILE_LIMIT="${raw}". Use values like 256MB, 1GB, -1, or disable with 0.`,
		);
	}
	return raw;
}

async function setLocalPostgresTempFileLimit(tx: Db, limit: string): Promise<void> {
	await tx.execute(sql`SELECT set_config('temp_file_limit', ${limit}, true)`);
}

export async function withPostgresTempFileLimit<T>(
	context: string,
	fn: (tx: Db) => Promise<T>,
): Promise<T> {
	const limit = getConfiguredPostgresTempFileLimit();
	if (!limit) return fn(getDb());

	let limitApplied = false;
	try {
		return await getDb().transaction(async (tx) => {
			await setLocalPostgresTempFileLimit(tx as unknown as Db, limit);
			limitApplied = true;
			return fn(tx as unknown as Db);
		});
	} catch (error) {
		if (limitApplied) throw error;
		if (!tempFileLimitWarningEmitted) {
			tempFileLimitWarningEmitted = true;
			const message = error instanceof Error ? error.message : String(error);
			console.warn(
				`[db] Could not apply POSTGRES_TEMP_FILE_LIMIT=${limit} for ${context}; continuing without a DB temp-file cap. Cause: ${message}`,
			);
		}
		return fn(getDb());
	}
}

export const db: Db = new Proxy({} as Db, {
	get(_, prop) {
		// If inside withWorkspaceRLS, route all calls through the RLS-scoped transaction
		const rlsTx = rlsTxStore.getStore();
		const effective = rlsTx ?? getDb();
		const target = effective as unknown as Record<string | symbol, unknown>;
		const value = target[prop as string | symbol];

		if (prop === 'execute' && typeof value === 'function') {
			return (...args: unknown[]) => {
				const sqlText = extractSqlText(args[0]);
				if (sqlText) guardExecute(sqlText);
				return (value as (...a: unknown[]) => unknown).apply(effective, args);
			};
		}

		return value;
	},
});

export type Database = typeof db;

/**
 * Wraps a callback in a transaction with RLS workspace context.
 * Sets app.workspace_id locally so RLS policies can enforce
 * workspace isolation at the database level.
 *
 * set_config(..., true) is transaction-scoped and supports bound parameters,
 * which keeps it safe for connection pooling and untrusted workspace IDs.
 */
export async function withWorkspaceRLS<T>(
	workspaceId: string,
	fn: (tx: Db) => Promise<T>,
): Promise<T> {
	return getDb().transaction(async (tx) => {
		await tx.execute(sql`SELECT set_config('app.workspace_id', ${workspaceId}, true)`);
		return rlsTxStore.run(tx as unknown as Db, () => fn(tx as unknown as Db));
	});
}
