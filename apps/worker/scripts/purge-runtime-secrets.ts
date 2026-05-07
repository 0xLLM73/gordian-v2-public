import Redis from 'ioredis';
import postgres from 'postgres';
import { loadRootEnv } from '../../../scripts/lib/load-root-env.mjs';

loadRootEnv();

type CountRow = { count: string };
type IdRow = { id: string };
type PurgeResult = {
	changed: number | null;
	matched: number;
	name: string;
	skipped?: string;
};

type DatabaseStep = {
	count: (sql: postgres.Sql) => Promise<number>;
	name: string;
	purge: (sql: postgres.Sql) => Promise<number>;
};

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const confirm = args.has('--confirm');

function usage(): void {
	console.log(`Usage:
  pnpm purge:secrets -- --dry-run
  pnpm purge:secrets -- --confirm

Purges runtime credentials without printing any secret values:
  - Telegram MTProto session ciphertext in accounts
  - account access, refresh, and ID tokens
  - Better Auth sessions and verification values
  - calendar OAuth access and refresh tokens
  - volatile Telegram auth/send/session-lock Redis keys`);
}

if (args.has('--help') || args.has('-h')) {
	usage();
	process.exit(0);
}

if (dryRun && confirm) {
	console.error('Choose either --dry-run or --confirm, not both.');
	process.exit(1);
}

if (!dryRun && !confirm) {
	usage();
	console.error('\nRefusing to purge without --confirm. Use --dry-run to preview counts.');
	process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	console.error('DATABASE_URL is required to purge database-backed secrets.');
	process.exit(1);
}

const redisUrl = process.env.DRAGONFLY_URL || process.env.REDIS_URL;

function errorCode(error: unknown): string | undefined {
	return typeof error === 'object' && error !== null && 'code' in error
		? String((error as { code?: unknown }).code)
		: undefined;
}

function firstCount(rows: CountRow[]): number {
	return Number(rows[0]?.count ?? 0);
}

async function runDatabaseStep(sql: postgres.Sql, step: DatabaseStep): Promise<PurgeResult> {
	try {
		const matched = await step.count(sql);
		const changed = confirm && matched > 0 ? await step.purge(sql) : null;
		return { changed, matched, name: step.name };
	} catch (error) {
		if (errorCode(error) === '42P01') {
			return { changed: null, matched: 0, name: step.name, skipped: 'table missing' };
		}
		throw error;
	}
}

async function deleteRedisPattern(redis: Redis, pattern: string): Promise<PurgeResult> {
	let cursor = '0';
	let matched = 0;
	let changed = 0;

	do {
		const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
		cursor = nextCursor;
		matched += keys.length;

		if (confirm && keys.length > 0) {
			const pipeline = redis.pipeline();
			for (const key of keys) pipeline.del(key);
			const responses = await pipeline.exec();
			changed +=
				responses?.reduce((total, [error, value]) => total + (error ? 0 : Number(value ?? 0)), 0) ??
				0;
		}
	} while (cursor !== '0');

	return {
		changed: confirm ? changed : null,
		matched,
		name: `Redis keys matching ${pattern}`,
	};
}

async function purgeRedisKeys(): Promise<PurgeResult[]> {
	if (!redisUrl) {
		return [
			{
				changed: null,
				matched: 0,
				name: 'Redis volatile Telegram/auth keys',
				skipped: 'DRAGONFLY_URL/REDIS_URL not set',
			},
		];
	}

	const redis = new Redis(redisUrl, {
		enableReadyCheck: false,
		maxRetriesPerRequest: null,
	});

	try {
		const patterns = [
			'auth:phone:*',
			'tg:send:*',
			'telegram:session:lock:*',
			'telegram:session:blocked:*',
		];

		const results: PurgeResult[] = [];
		for (const pattern of patterns) {
			results.push(await deleteRedisPattern(redis, pattern));
		}
		return results;
	} finally {
		await redis.quit();
	}
}

const sql = postgres(databaseUrl, {
	max: 1,
	prepare: false,
});

const databaseSteps: DatabaseStep[] = [
	{
		name: 'Telegram MTProto account sessions/tokens',
		count: async (client) =>
			firstCount(
				await client<CountRow[]>`
					SELECT count(*)::text AS count
					FROM accounts
					WHERE provider_id = 'telegram'
						AND (
							access_token IS NOT NULL
							OR refresh_token IS NOT NULL
							OR id_token IS NOT NULL
							OR access_token_expires_at IS NOT NULL
							OR refresh_token_expires_at IS NOT NULL
							OR session_kek_encrypted IS NOT NULL
						)
				`,
			),
		purge: async (client) => {
			const rows = await client<IdRow[]>`
				UPDATE accounts
				SET access_token = NULL,
					refresh_token = NULL,
					id_token = NULL,
					access_token_expires_at = NULL,
					refresh_token_expires_at = NULL,
					session_kek_encrypted = NULL,
					updated_at = now()
				WHERE provider_id = 'telegram'
					AND (
						access_token IS NOT NULL
						OR refresh_token IS NOT NULL
						OR id_token IS NOT NULL
						OR access_token_expires_at IS NOT NULL
						OR refresh_token_expires_at IS NOT NULL
						OR session_kek_encrypted IS NOT NULL
					)
				RETURNING id
			`;
			return rows.length;
		},
	},
	{
		name: 'Non-Telegram account access/refresh/ID tokens',
		count: async (client) =>
			firstCount(
				await client<CountRow[]>`
					SELECT count(*)::text AS count
					FROM accounts
					WHERE provider_id <> 'telegram'
						AND (
							access_token IS NOT NULL
							OR refresh_token IS NOT NULL
							OR id_token IS NOT NULL
							OR access_token_expires_at IS NOT NULL
							OR refresh_token_expires_at IS NOT NULL
						)
				`,
			),
		purge: async (client) => {
			const rows = await client<IdRow[]>`
				UPDATE accounts
				SET access_token = NULL,
					refresh_token = NULL,
					id_token = NULL,
					access_token_expires_at = NULL,
					refresh_token_expires_at = NULL,
					updated_at = now()
				WHERE provider_id <> 'telegram'
					AND (
						access_token IS NOT NULL
						OR refresh_token IS NOT NULL
						OR id_token IS NOT NULL
						OR access_token_expires_at IS NOT NULL
						OR refresh_token_expires_at IS NOT NULL
					)
				RETURNING id
			`;
			return rows.length;
		},
	},
	{
		name: 'Better Auth sessions',
		count: async (client) =>
			firstCount(await client<CountRow[]>`SELECT count(*)::text AS count FROM sessions`),
		purge: async (client) => {
			const rows = await client<IdRow[]>`DELETE FROM sessions RETURNING id`;
			return rows.length;
		},
	},
	{
		name: 'Better Auth verification values',
		count: async (client) =>
			firstCount(await client<CountRow[]>`SELECT count(*)::text AS count FROM verifications`),
		purge: async (client) => {
			const rows = await client<IdRow[]>`DELETE FROM verifications RETURNING id`;
			return rows.length;
		},
	},
	{
		name: 'Calendar OAuth tokens',
		count: async (client) =>
			firstCount(
				await client<CountRow[]>`
					SELECT count(*)::text AS count
					FROM calendar_connections
					WHERE access_token IS NOT NULL
						OR refresh_token IS NOT NULL
						OR expires_at IS NOT NULL
				`,
			),
		purge: async (client) => {
			const rows = await client<IdRow[]>`
				UPDATE calendar_connections
				SET access_token = NULL,
					refresh_token = NULL,
					expires_at = NULL,
					updated_at = now()
				WHERE access_token IS NOT NULL
					OR refresh_token IS NOT NULL
					OR expires_at IS NOT NULL
				RETURNING id
			`;
			return rows.length;
		},
	},
];

const mode = dryRun ? 'dry run' : 'confirmed purge';
console.log(`Starting runtime secret purge (${mode}). Counts only; no secret values are printed.`);

try {
	const results: PurgeResult[] = [];
	for (const step of databaseSteps) {
		results.push(await runDatabaseStep(sql, step));
	}
	results.push(...(await purgeRedisKeys()));

	for (const result of results) {
		const changedText = result.changed === null ? 'not changed' : `${result.changed} changed`;
		const skippedText = result.skipped ? ` (${result.skipped})` : '';
		console.log(`- ${result.name}: ${result.matched} matched, ${changedText}${skippedText}`);
	}

	if (dryRun) {
		console.log('\nDry run complete. Re-run with --confirm to purge matched runtime credentials.');
	} else {
		console.log('\nPurge complete. Revoke external provider credentials separately.');
	}
} finally {
	await sql.end({ timeout: 5 });
}
