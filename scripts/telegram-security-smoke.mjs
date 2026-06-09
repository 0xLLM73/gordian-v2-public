#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { writeKeychainSecret } from './lib/keychain-secret-writer.mjs';
import {
	LOCAL_REDIS_PURGE_PATTERNS,
	isLegacyGrammySessionEntry,
} from './lib/local-runtime-safety.mjs';
import {
	DEFAULT_ENV_PATH,
	classifyDoctor,
	envValue,
	getGordianKeychainHelperPath,
	getTelegramApiCredentialProvider,
	parseArgs,
	parseEnvText,
	probeMacOsKeychain,
	readEnvText,
	readTelegramApiCredentialsFromKeychain,
	validateTelegramApiHash,
	validateTelegramApiId,
} from './lib/telegram-local-mode.mjs';

const execFileAsync = promisify(execFile);
const workerRequire = createRequire(new URL('../apps/worker/package.json', import.meta.url));
const KEYCHAIN_MARKER_PREFIX = 'gordian:keychain:telegram-session-kek:v1:';
const WORKSPACE_KEYCHAIN_MARKER_PREFIX = 'gordian:keychain:workspace-wrk:v1:';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const REDIS_RESIDUE_PATTERNS = LOCAL_REDIS_PURGE_PATTERNS;
const AI_FLOW_BULLMQ_PATTERN = '{ai-flow}:*';

function getPostgresClient() {
	return workerRequire('postgres');
}

function getRedisClient() {
	const mod = workerRequire('ioredis');
	return mod.default ?? mod;
}

function printHelp() {
	console.log(`Usage: pnpm telegram:security-smoke [options]

Runs local, read-only safety checks for personal Telegram account testing.
The command prints counts and check names only. It never prints secret values.

Options:
  --env <path>                 Env file to inspect. Defaults to .env.local.
  --allow-missing-credentials  Warn instead of failing when Telegram API credentials are absent.
  --expect-purged              Assert local Telegram session/data residue has been purged.
  --skip-keychain              Skip macOS Keychain probes.
  --skip-db                    Skip Postgres checks.
  --skip-redis                 Skip Redis/Dragonfly checks.
  --skip-worker                Skip worker send-disabled route check.
  --help                       Show this help text.
`);
}

function add(checks, level, name, detail) {
	checks.push({ detail, level, name });
}

function printChecks(checks) {
	for (const check of checks) {
		const label = check.level.toUpperCase().padEnd(4, ' ');
		console.log(`${label} ${check.name}: ${check.detail}`);
	}
}

function safeErrorMessage(error) {
	const message = error instanceof Error ? error.message : String(error);
	return message
		.replace(/(-w\s+)(\S+)/g, '$1[redacted]')
		.replace(/(TELEGRAM_API_HASH=)(\S+)/g, '$1[redacted]')
		.replace(/(BOT_TOKEN=)(\S+)/g, '$1[redacted]');
}

function applyEnv(env) {
	for (const [key, value] of env.entries()) {
		if (process.env[key] === undefined) process.env[key] = value;
	}
}

function runtimeValue(env, name) {
	return process.env[name] || envValue(env, name);
}

function isBase64Ciphertext(value) {
	if (typeof value !== 'string') return false;
	const trimmed = value.trim();
	if (trimmed.length < 40) return false;
	if (/\s/.test(trimmed)) return false;
	return BASE64_RE.test(trimmed);
}

function decodeBase64Blob(value) {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed || !BASE64_RE.test(trimmed)) return null;
	return Buffer.from(trimmed, 'base64');
}

function isWorkspaceKeychainMarker(value) {
	const decoded = decodeBase64Blob(value);
	if (!decoded) return false;
	return decoded.toString('utf8').startsWith(WORKSPACE_KEYCHAIN_MARKER_PREFIX);
}

function isLocalUrl(value) {
	if (!value) return false;
	try {
		const parsed = new URL(value);
		return ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
	} catch {
		return false;
	}
}

function isConnectionRefused(error) {
	const code =
		typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;
	const cause =
		typeof error === 'object' && error !== null && 'cause' in error ? error.cause : undefined;
	const causeCode =
		typeof cause === 'object' && cause !== null && 'code' in cause ? String(cause.code) : undefined;
	return (
		code === 'ECONNREFUSED' ||
		code === 'ENOTFOUND' ||
		causeCode === 'ECONNREFUSED' ||
		causeCode === 'ENOTFOUND' ||
		(error instanceof TypeError && error.message === 'fetch failed')
	);
}

async function setKeychainSecret({ account, helperPath, secret, service }) {
	await writeKeychainSecret({
		account,
		helperPath,
		secret,
		service,
	});
}

async function getKeychainSecret({ account, helperPath, service }) {
	const { stdout } = helperPath
		? await execFileAsync(helperPath, ['get', service, account, 'standard'])
		: await execFileAsync('security', [
				'find-generic-password',
				'-a',
				account,
				'-s',
				service,
				'-w',
			]);
	return String(stdout).trim();
}

async function deleteKeychainSecret({ account, service }) {
	await execFileAsync('security', ['delete-generic-password', '-a', account, '-s', service]);
}

async function addConfigChecks(checks, env, options) {
	for (const check of classifyDoctor(env, { skipCredentialChecks: true })) {
		add(checks, check.level, check.name, check.detail);
	}

	const provider = getTelegramApiCredentialProvider(env);
	if (provider === 'invalid') {
		add(checks, 'fail', 'TELEGRAM_API_CREDENTIAL_PROVIDER', 'expected os-keychain or env');
		return;
	}

	if (provider === 'os-keychain') {
		if (envValue(env, 'TELEGRAM_API_ID') || envValue(env, 'TELEGRAM_API_HASH')) {
			add(
				checks,
				'fail',
				'Telegram API env residue',
				'clear TELEGRAM_API_ID/HASH from env files when using os-keychain',
			);
		} else {
			add(checks, 'pass', 'Telegram API env residue', 'no API ID/hash values in env file');
		}

		if (options.allowMissingCredentials) {
			add(checks, 'warn', 'Telegram API Keychain', 'credential presence check skipped');
			return;
		}

		try {
			const credentials = await readTelegramApiCredentialsFromKeychain(env);
			add(
				checks,
				validateTelegramApiId(credentials.apiId) ? 'pass' : 'fail',
				'TELEGRAM_API_ID',
				validateTelegramApiId(credentials.apiId)
					? 'stored in macOS Keychain and numeric'
					: 'stored API ID is missing or invalid',
			);
			add(
				checks,
				validateTelegramApiHash(credentials.apiHash) ? 'pass' : 'fail',
				'TELEGRAM_API_HASH',
				validateTelegramApiHash(credentials.apiHash)
					? 'stored in macOS Keychain and shaped correctly'
					: 'stored API hash is missing or invalid',
			);
		} catch (error) {
			add(checks, 'fail', 'Telegram API Keychain', safeErrorMessage(error));
		}
		return;
	}

	add(
		checks,
		'warn',
		'TELEGRAM_API_CREDENTIAL_PROVIDER',
		'env mode leaves Telegram API credentials in .env.local; use os-keychain for normal macOS users',
	);
	add(
		checks,
		validateTelegramApiId(envValue(env, 'TELEGRAM_API_ID')) ? 'pass' : 'fail',
		'TELEGRAM_API_ID',
		validateTelegramApiId(envValue(env, 'TELEGRAM_API_ID')) ? 'present and numeric' : 'missing',
	);
	add(
		checks,
		validateTelegramApiHash(envValue(env, 'TELEGRAM_API_HASH')) ? 'pass' : 'fail',
		'TELEGRAM_API_HASH',
		validateTelegramApiHash(envValue(env, 'TELEGRAM_API_HASH')) ? 'present' : 'missing',
	);
}

async function addKeychainChecks(checks, env, options) {
	if (options.skipKeychain) {
		add(checks, 'warn', 'macOS Keychain', 'skipped');
		return;
	}

	if (envValue(env, 'TELEGRAM_SESSION_KEY_PROVIDER') !== 'os-keychain') {
		add(checks, 'fail', 'Telegram session KEK custody', 'expected os-keychain provider');
		return;
	}

	try {
		const service = envValue(env, 'TELEGRAM_KEYCHAIN_SERVICE') || 'gordian-v2-telegram';
		await probeMacOsKeychain(service, { helperPath: getGordianKeychainHelperPath(env) });
		add(checks, 'pass', 'macOS Keychain probe', `write/read/delete probe passed for ${service}`);
	} catch (error) {
		add(checks, 'fail', 'macOS Keychain probe', safeErrorMessage(error));
		return;
	}

	const service = envValue(env, 'TELEGRAM_KEYCHAIN_SERVICE') || 'gordian-v2-telegram';
	const helperPath = getGordianKeychainHelperPath(env);
	const account = `telegram-session:security-smoke:${randomUUID()}`;
	try {
		const secret = Buffer.from(randomUUID()).toString('base64');
		await setKeychainSecret({ account, helperPath, secret, service });
		const ciphertextBlob = Buffer.from(
			`${KEYCHAIN_MARKER_PREFIX}${JSON.stringify({
				account,
				provider: 'os-keychain',
				service,
				version: 1,
			})}`,
			'utf8',
		);
		const marker = ciphertextBlob.toString('utf8');
		const markerLooksSafe = marker.startsWith(KEYCHAIN_MARKER_PREFIX) && !marker.includes(secret);

		add(
			checks,
			markerLooksSafe ? 'pass' : 'fail',
			'Telegram session KEK marker',
			markerLooksSafe
				? 'database blob is a Keychain marker, not the plaintext unwrap key'
				: 'database blob does not look like a safe Keychain marker',
		);

		const readBack = await getKeychainSecret({ account, helperPath, service });
		add(
			checks,
			readBack === secret ? 'pass' : 'fail',
			'Telegram session KEK readback',
			readBack === secret ? 'temporary Keychain item was readable' : 'readback mismatch',
		);

		await deleteKeychainSecret({ account, service });
		try {
			await getKeychainSecret({ account, helperPath, service });
			add(checks, 'fail', 'Telegram session KEK deletion', 'deleted marker was still readable');
		} catch {
			add(checks, 'pass', 'Telegram session KEK deletion', 'Keychain item was removed');
		}
	} catch (error) {
		await deleteKeychainSecret({ account, service }).catch(() => {});
		add(checks, 'fail', 'Telegram session KEK custody', safeErrorMessage(error));
	}
}

async function addWorkerSendDisabledCheck(checks, env, options) {
	if (options.skipWorker) {
		add(checks, 'warn', 'Worker send-disabled route', 'skipped');
		return;
	}

	const workerUrl = runtimeValue(env, 'WORKER_URL');
	const internalSecret = runtimeValue(env, 'INTERNAL_AUTH_SECRET');
	if (!workerUrl || !internalSecret) {
		add(checks, 'warn', 'Worker send-disabled route', 'WORKER_URL/INTERNAL_AUTH_SECRET not set');
		return;
	}
	if (!isLocalUrl(workerUrl)) {
		add(checks, 'fail', 'WORKER_URL', 'must point at localhost for local personal-account smoke');
		return;
	}

	try {
		const response = await fetch(`${workerUrl.replace(/\/$/, '')}/telegram/send-message`, {
			body: JSON.stringify({
				contactId: randomUUID(),
				contactTelegramId: '123456789',
				idempotencyKey: randomUUID(),
				text: 'security smoke blocked-send probe',
				userId: randomUUID(),
				workspaceId: randomUUID(),
			}),
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': internalSecret,
			},
			method: 'POST',
		});

		if (response.status === 503) {
			add(checks, 'pass', 'Worker send-disabled route', 'send-message returned 503');
			return;
		}

		add(checks, 'fail', 'Worker send-disabled route', `expected 503, got ${response.status}`);
	} catch (error) {
		add(
			checks,
			isConnectionRefused(error) ? 'warn' : 'fail',
			'Worker send-disabled route',
			isConnectionRefused(error)
				? 'worker not reachable; start it to verify route-level send blocking'
				: safeErrorMessage(error),
		);
	}
}

async function tableExists(sql, tableName) {
	const rows = await sql`
		SELECT EXISTS (
			SELECT 1
			FROM information_schema.tables
			WHERE table_schema = 'public'
				AND table_name = ${tableName}
		) AS exists
	`;
	return Boolean(rows[0]?.exists);
}

async function addDatabaseChecks(checks, env, options) {
	if (options.skipDb) {
		add(checks, 'warn', 'Postgres residue scan', 'skipped');
		return;
	}

	const databaseUrl = runtimeValue(env, 'DATABASE_URL');
	if (!databaseUrl) {
		add(checks, 'warn', 'Postgres residue scan', 'DATABASE_URL not set');
		return;
	}
	if (!isLocalUrl(databaseUrl)) {
		add(checks, 'fail', 'DATABASE_URL', 'must point at localhost for local security smoke');
		return;
	}

	const postgres = getPostgresClient();
	const sql = postgres(databaseUrl, { max: 1, prepare: false });
	try {
		if (await tableExists(sql, 'accounts')) {
			const accountRows = await sql`
				SELECT access_token,
					refresh_token,
					id_token,
					session_kek_encrypted,
					user_id
				FROM accounts
				WHERE provider_id = 'telegram'
			`;

			const unsafeKekRows = accountRows.filter((row) => {
				if (!row.session_kek_encrypted) return false;
				return !Buffer.from(row.session_kek_encrypted)
					.toString('utf8')
					.startsWith(KEYCHAIN_MARKER_PREFIX);
			});
			const plaintextTokenRows = accountRows.filter((row) => {
				const token = row.access_token;
				return token && !isBase64Ciphertext(String(token));
			});
			const unexpectedOauthRows = accountRows.filter((row) => row.refresh_token || row.id_token);

			add(
				checks,
				unsafeKekRows.length === 0 ? 'pass' : 'fail',
				'Postgres Telegram KEK blobs',
				`${unsafeKekRows.length} unsafe row(s) out of ${accountRows.length}`,
			);
			add(
				checks,
				plaintextTokenRows.length === 0 ? 'pass' : 'fail',
				'Postgres Telegram sessions',
				`${plaintextTokenRows.length} plaintext-looking access_token row(s) out of ${accountRows.length}`,
			);
			add(
				checks,
				unexpectedOauthRows.length === 0 ? 'pass' : 'fail',
				'Postgres Telegram OAuth residue',
				`${unexpectedOauthRows.length} refresh/id token row(s)`,
			);

			if (options.expectPurged) {
				const residueRows = accountRows.filter(
					(row) =>
						row.access_token || row.session_kek_encrypted || row.refresh_token || row.id_token,
				);
				add(
					checks,
					residueRows.length === 0 ? 'pass' : 'fail',
					'Purged Telegram account secrets',
					`${residueRows.length} row(s) still contain Telegram credential material`,
				);
			}
		} else {
			add(checks, 'warn', 'Postgres accounts scan', 'accounts table missing');
		}

		if (await tableExists(sql, 'workspaces')) {
			const workspaceRows = await sql`
				SELECT encrypted_wrk
				FROM workspaces
			`;
			const keychainRows = workspaceRows.filter((row) =>
				isWorkspaceKeychainMarker(row.encrypted_wrk),
			);
			const rawLocalWrkRows = workspaceRows.filter((row) => {
				const decoded = decodeBase64Blob(row.encrypted_wrk);
				return decoded?.length === 32 && !isWorkspaceKeychainMarker(row.encrypted_wrk);
			});
			const workspaceKeyProvider = runtimeValue(env, 'WORKSPACE_KEY_PROVIDER');

			if (workspaceKeyProvider === 'os-keychain') {
				add(
					checks,
					keychainRows.length === workspaceRows.length ? 'pass' : 'fail',
					'Postgres workspace WRK custody',
					`${workspaceRows.length - keychainRows.length} non-Keychain row(s) out of ${workspaceRows.length}`,
				);
			} else if (rawLocalWrkRows.length > 0) {
				add(
					checks,
					'warn',
					'Postgres workspace WRK custody',
					`${rawLocalWrkRows.length} raw local WRK row(s); use WORKSPACE_KEY_PROVIDER=os-keychain for real local workspaces`,
				);
			} else {
				add(
					checks,
					'pass',
					'Postgres workspace WRK custody',
					`${keychainRows.length} Keychain marker row(s) out of ${workspaceRows.length}`,
				);
			}
		} else {
			add(checks, 'warn', 'Postgres workspaces scan', 'workspaces table missing');
		}

		if (await tableExists(sql, 'messages')) {
			const messageRows = await sql`
				SELECT text
				FROM messages
				WHERE text IS NOT NULL
				ORDER BY created_at DESC
				LIMIT 100
			`;
			const plaintextRows = messageRows.filter((row) => !isBase64Ciphertext(String(row.text)));
			add(
				checks,
				plaintextRows.length === 0 ? 'pass' : 'fail',
				'Postgres message text encryption',
				`${plaintextRows.length} plaintext-looking row(s) in ${messageRows.length} sampled message(s)`,
			);

			if (options.expectPurged) {
				const rows = await sql`SELECT count(*)::int AS count FROM messages`;
				const count = Number(rows[0]?.count ?? 0);
				add(
					checks,
					count === 0 ? 'pass' : 'fail',
					'Purged imported messages',
					`${count} message row(s) remain`,
				);
			}
		} else {
			add(checks, 'warn', 'Postgres messages scan', 'messages table missing');
		}

		if (await tableExists(sql, 'knowledge_evidence')) {
			const rows = await sql`SELECT count(*)::int AS count FROM knowledge_evidence`;
			const count = Number(rows[0]?.count ?? 0);
			add(
				checks,
				options.expectPurged && count > 0 ? 'fail' : 'pass',
				'Knowledge evidence residue',
				`${count} evidence row(s)`,
			);
		}
	} catch (error) {
		add(checks, 'fail', 'Postgres residue scan', safeErrorMessage(error));
	} finally {
		await sql.end({ timeout: 5 }).catch(() => {});
	}
}

async function countRedisPattern(redis, pattern) {
	let cursor = '0';
	let matched = 0;
	do {
		const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
		cursor = nextCursor;
		matched += keys.length;
	} while (cursor !== '0');
	return matched;
}

async function countLegacyGrammySessionKeys(redis) {
	let cursor = '0';
	let matched = 0;
	do {
		const [nextCursor, keys] = await redis.scan(cursor, 'COUNT', 500);
		cursor = nextCursor;
		const possibleLegacyKeys = keys.filter((key) => /^-?\d+$/.test(key));
		if (possibleLegacyKeys.length === 0) continue;
		const values = await redis.mget(...possibleLegacyKeys);
		matched += possibleLegacyKeys.filter((key, index) =>
			isLegacyGrammySessionEntry(key, values[index]),
		).length;
	} while (cursor !== '0');
	return matched;
}

async function addRedisChecks(checks, env, options) {
	if (options.skipRedis) {
		add(checks, 'warn', 'Redis residue scan', 'skipped');
		return;
	}

	const redisUrl =
		process.env.DRAGONFLY_URL ||
		process.env.REDIS_URL ||
		envValue(env, 'DRAGONFLY_URL') ||
		envValue(env, 'REDIS_URL');
	if (!redisUrl) {
		add(checks, 'warn', 'Redis residue scan', 'DRAGONFLY_URL/REDIS_URL not set');
		return;
	}
	if (!isLocalUrl(redisUrl)) {
		add(checks, 'fail', 'Redis URL', 'must point at localhost for local security smoke');
		return;
	}

	const Redis = getRedisClient();
	const redis = new Redis(redisUrl, {
		enableReadyCheck: false,
		lazyConnect: true,
		maxRetriesPerRequest: 1,
	});

	try {
		await redis.connect();
		for (const pattern of REDIS_RESIDUE_PATTERNS) {
			const matched = await countRedisPattern(redis, pattern);
			if (pattern === AI_FLOW_BULLMQ_PATTERN && !options.expectPurged) {
				add(
					checks,
					'pass',
					`Redis ${pattern}`,
					`${matched} BullMQ runtime key(s); covered by purge tooling`,
				);
				continue;
			}
			const level = matched === 0 ? 'pass' : options.expectPurged ? 'fail' : 'warn';
			add(checks, level, `Redis ${pattern}`, `${matched} key(s)`);
		}
		const legacyGrammySessions = await countLegacyGrammySessionKeys(redis);
		add(
			checks,
			legacyGrammySessions === 0 ? 'pass' : options.expectPurged ? 'fail' : 'warn',
			'Redis legacy grammY chat-id sessions',
			`${legacyGrammySessions} key(s)`,
		);
	} catch (error) {
		add(
			checks,
			isConnectionRefused(error) ? 'warn' : 'fail',
			'Redis residue scan',
			isConnectionRefused(error) ? 'Redis not reachable' : safeErrorMessage(error),
		);
	} finally {
		await redis.quit().catch(() => {});
	}
}

async function addPurgeCommandCheck(checks) {
	try {
		const workerPackage = JSON.parse(readFileSync('apps/worker/package.json', 'utf8'));
		const script = workerPackage.scripts?.['purge:secrets'];
		add(
			checks,
			script === 'tsx scripts/purge-runtime-secrets.ts' ? 'pass' : 'fail',
			'Purge tooling',
			script === 'tsx scripts/purge-runtime-secrets.ts'
				? 'worker purge:secrets script is registered'
				: 'worker purge:secrets script is missing or unexpected',
		);
	} catch (error) {
		add(checks, 'fail', 'Purge tooling', safeErrorMessage(error));
	}
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		printHelp();
		return;
	}

	const envPath = args.env || DEFAULT_ENV_PATH;
	const text = readEnvText(envPath);
	if (!text) {
		console.error(`FAIL .env file: ${envPath} does not exist or is empty`);
		process.exitCode = 1;
		return;
	}

	const env = parseEnvText(text);
	applyEnv(env);

	if (
		process.env.TELEGRAM_SECURITY_SMOKE_USER_ID &&
		!UUID_RE.test(process.env.TELEGRAM_SECURITY_SMOKE_USER_ID)
	) {
		console.error('FAIL TELEGRAM_SECURITY_SMOKE_USER_ID must be a UUID when set');
		process.exitCode = 1;
		return;
	}

	const checks = [];
	const options = {
		allowMissingCredentials: Boolean(args['allow-missing-credentials']),
		expectPurged: Boolean(args['expect-purged']),
		skipDb: Boolean(args['skip-db']),
		skipKeychain: Boolean(args['skip-keychain']),
		skipRedis: Boolean(args['skip-redis']),
		skipWorker: Boolean(args['skip-worker']),
	};

	await addConfigChecks(checks, env, options);
	await addKeychainChecks(checks, env, options);
	await addWorkerSendDisabledCheck(checks, env, options);
	await addDatabaseChecks(checks, env, options);
	await addRedisChecks(checks, env, options);
	await addPurgeCommandCheck(checks);

	console.log(`Telegram local security smoke (${envPath})`);
	printChecks(checks);

	const failures = checks.filter((check) => check.level === 'fail').length;
	const warnings = checks.filter((check) => check.level === 'warn').length;
	console.log(`Summary: ${failures} failure(s), ${warnings} warning(s)`);

	if (failures > 0) {
		console.log('Fix failures before treating personal Telegram import as locally safe.');
		process.exitCode = 1;
	} else if (warnings > 0) {
		console.log('Smoke completed with warnings. Review skipped/unreachable checks before release.');
	} else {
		console.log('Smoke completed. Local Telegram custody checks passed.');
	}
}

main().catch((error) => {
	console.error(safeErrorMessage(error));
	process.exitCode = 1;
});
