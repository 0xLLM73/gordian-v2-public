import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { writeKeychainSecret } from './keychain-secret-writer.mjs';

const execFileAsync = promisify(execFile);

export const DEFAULT_KEYCHAIN_SERVICE = 'gordian-v2';
export const DEFAULT_TELEGRAM_API_KEYCHAIN_ACCOUNT = 'telegram-api-credentials';
export const DEFAULT_ENV_PATH = path.resolve(process.cwd(), '.env.local');
export const TELEGRAM_LOCAL_MODE_VALUES = {
	TELEGRAM_MTPROTO_ENABLED: 'true',
	NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED: 'true',
	TELEGRAM_SESSION_KEY_PROVIDER: 'os-keychain',
	TELEGRAM_KEYCHAIN_SERVICE: DEFAULT_KEYCHAIN_SERVICE,
	TELEGRAM_KEYCHAIN_REQUIRE_USER_PRESENCE: 'false',
	TELEGRAM_MTPROTO_SESSION_IDLE_MINUTES: '30',
	TELEGRAM_API_CREDENTIAL_PROVIDER: 'os-keychain',
	TELEGRAM_API_KEYCHAIN_ACCOUNT: DEFAULT_TELEGRAM_API_KEYCHAIN_ACCOUNT,
	TELEGRAM_SEND_ENABLED: 'false',
	TELEGRAM_FULL_BACKFILL_ENABLED: 'false',
	TELEGRAM_PERIODIC_SYNC_ENABLED: 'false',
	WORKSPACE_KEY_PROVIDER: 'os-keychain',
	WORKSPACE_KEYCHAIN_SERVICE: DEFAULT_KEYCHAIN_SERVICE,
	WORKSPACE_KEY_CACHE_TTL_MINUTES: '60',
	KMS_CMK_ARN: '',
	AWS_ACCESS_KEY_ID: '',
	AWS_SECRET_ACCESS_KEY: '',
	AWS_PROFILE: '',
	AWS_DEFAULT_PROFILE: '',
	AWS_SESSION_TOKEN: '',
};

const AWS_ACTIVE_KEYS = [
	'KMS_CMK_ARN',
	'AWS_ACCESS_KEY_ID',
	'AWS_SECRET_ACCESS_KEY',
	'AWS_PROFILE',
	'AWS_DEFAULT_PROFILE',
	'AWS_SESSION_TOKEN',
];

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const KNOWN_PUBLIC_SECRET_LIKE_KEYS = new Set([
	'NEXT_PUBLIC_DEMO_PASSWORD',
	'NEXT_PUBLIC_POSTHOG_KEY',
	'NEXT_PUBLIC_SUPABASE_ANON_KEY',
]);

export function parseArgs(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (!arg.startsWith('--')) continue;
		const key = arg.slice(2);
		const next = argv[i + 1];
		if (!next || next.startsWith('--')) {
			args[key] = true;
			continue;
		}
		args[key] = next;
		i += 1;
	}
	return args;
}

export function readEnvText(envPath = DEFAULT_ENV_PATH) {
	return fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
}

export function parseEnvText(text) {
	const env = new Map();
	for (const line of text.split(/\r?\n/)) {
		const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
		if (!match) continue;
		env.set(match[1], unquoteEnvValue(match[2].trim()));
	}
	return env;
}

export function unquoteEnvValue(value) {
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}
	return value;
}

export function quoteEnvValue(value) {
	return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function setEnvValue(text, key, value) {
	const line = `${key}=${quoteEnvValue(value)}`;
	const pattern = new RegExp(`^${key}=.*$`, 'm');
	if (pattern.test(text)) return text.replace(pattern, line);
	const separator = text.endsWith('\n') || text.length === 0 ? '' : '\n';
	return `${text}${separator}${line}\n`;
}

export function updateEnvText(text, updates) {
	let next = text;
	for (const [key, value] of Object.entries(updates)) {
		next = setEnvValue(next, key, value);
	}
	return next;
}

export function isSecretLikeKey(key) {
	return /(SECRET|TOKEN|HASH|KEY|KMS|AWS|PASSWORD)/i.test(key);
}

export function validateTelegramApiId(value) {
	return /^[1-9][0-9]*$/.test(value.trim());
}

export function validateTelegramApiHash(value) {
	return /^[0-9a-f]{32}$/i.test(value.trim());
}

function getKeychainService(env) {
	return envValue(env, 'TELEGRAM_KEYCHAIN_SERVICE') || DEFAULT_KEYCHAIN_SERVICE;
}

export function getTelegramApiKeychainAccount(env) {
	return envValue(env, 'TELEGRAM_API_KEYCHAIN_ACCOUNT') || DEFAULT_TELEGRAM_API_KEYCHAIN_ACCOUNT;
}

export function getTelegramApiCredentialProvider(env) {
	const configured = envValue(env, 'TELEGRAM_API_CREDENTIAL_PROVIDER');
	if (!configured) return 'env';
	if (configured === 'env' || configured === 'os-keychain') return configured;
	return 'invalid';
}

export async function writeTelegramApiCredentialsToKeychain(env, { apiId, apiHash }) {
	if (process.platform !== 'darwin') {
		throw new Error('macOS Keychain is required for TELEGRAM_API_CREDENTIAL_PROVIDER=os-keychain');
	}

	await writeKeychainSecret({
		account: getTelegramApiKeychainAccount(env),
		service: getKeychainService(env),
		secret: JSON.stringify({ apiId: apiId.trim(), apiHash: apiHash.trim(), version: 1 }),
	});
}

export async function readTelegramApiCredentialsFromKeychain(env) {
	if (process.platform !== 'darwin') {
		throw new Error('macOS Keychain is required for TELEGRAM_API_CREDENTIAL_PROVIDER=os-keychain');
	}

	const { stdout } = await execFileAsync('security', [
		'find-generic-password',
		'-a',
		getTelegramApiKeychainAccount(env),
		'-s',
		getKeychainService(env),
		'-w',
	]);
	const parsed = JSON.parse(String(stdout).trim());
	return {
		apiHash: String(parsed.apiHash ?? ''),
		apiId: String(parsed.apiId ?? ''),
	};
}

export function envValue(env, key) {
	return env.get(key)?.trim() ?? '';
}

export function envHasValue(env, key) {
	return envValue(env, key).length > 0;
}

export function configuredAwsKeys(env) {
	return AWS_ACTIVE_KEYS.filter((key) => envHasValue(env, key) || Boolean(process.env[key]));
}

export function awsConfigFileSummary() {
	const files = [
		path.join(os.homedir(), '.aws', 'credentials'),
		path.join(os.homedir(), '.aws', 'config'),
	];
	return files.filter((file) => fs.existsSync(file));
}

export function isLocalUrl(value) {
	if (!value) return false;
	try {
		const parsed = new URL(value);
		return LOCAL_HOSTS.has(parsed.hostname);
	} catch {
		return false;
	}
}

export function isLocalUrlList(value) {
	if (!value) return false;
	return value
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean)
		.every((entry) => isLocalUrl(entry));
}

export function endpointFromUrl(value, fallbackPort) {
	const parsed = new URL(value);
	return {
		host: parsed.hostname,
		port: Number(parsed.port || fallbackPort),
	};
}

export async function canConnectTcp(host, port, timeoutMs = 1500) {
	return new Promise((resolve) => {
		const socket = net.createConnection({ host, port });
		const done = (result) => {
			socket.destroy();
			resolve(result);
		};
		socket.setTimeout(timeoutMs);
		socket.once('connect', () => done(true));
		socket.once('error', () => done(false));
		socket.once('timeout', () => done(false));
	});
}

export async function probeMacOsKeychain(service = DEFAULT_KEYCHAIN_SERVICE) {
	if (process.platform !== 'darwin') {
		throw new Error('macOS Keychain is required for TELEGRAM_SESSION_KEY_PROVIDER=os-keychain');
	}

	const account = `telegram-doctor:${randomUUID()}`;
	const secret = randomBytes(32).toString('base64');
	try {
		await writeKeychainSecret({
			account,
			secret,
			service,
		});
		const { stdout } = await execFileAsync('security', [
			'find-generic-password',
			'-a',
			account,
			'-s',
			service,
			'-w',
		]);
		if (String(stdout).trim() !== secret) {
			throw new Error('macOS Keychain read-back check returned a different value');
		}
	} finally {
		await execFileAsync('security', [
			'delete-generic-password',
			'-a',
			account,
			'-s',
			service,
		]).catch(() => {});
	}
}

export function classifyDoctor(env, options = {}) {
	const checks = [];
	const add = (level, name, detail) => checks.push({ detail, level, name });
	const expectValue = (key, expected) => {
		const actual = envValue(env, key);
		if (actual === expected) {
			add('pass', key, `is ${expected}`);
		} else {
			add('fail', key, `expected ${expected}, found ${actual || 'blank/unset'}`);
		}
	};

	expectValue('TELEGRAM_SESSION_KEY_PROVIDER', 'os-keychain');
	if (envValue(env, 'TELEGRAM_KEYCHAIN_REQUIRE_USER_PRESENCE') === 'true') {
		add(
			'warn',
			'TELEGRAM_KEYCHAIN_REQUIRE_USER_PRESENCE',
			'is experimental for CLI use and can cause repeated macOS prompts; use stable os-keychain mode unless running a signed native helper',
		);
	} else {
		add(
			'pass',
			'TELEGRAM_KEYCHAIN_REQUIRE_USER_PRESENCE',
			'is false; using stable macOS Keychain mode',
		);
	}
	expectValue('TELEGRAM_MTPROTO_ENABLED', 'true');
	expectValue('NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED', 'true');
	expectValue('TELEGRAM_SEND_ENABLED', 'false');
	expectValue('TELEGRAM_FULL_BACKFILL_ENABLED', 'false');
	expectValue('TELEGRAM_PERIODIC_SYNC_ENABLED', 'false');
	const mtprotoIdleMinutes = envValue(env, 'TELEGRAM_MTPROTO_SESSION_IDLE_MINUTES') || '30';
	if (
		/^\d+$/.test(mtprotoIdleMinutes) &&
		Number.parseInt(mtprotoIdleMinutes, 10) >= 1 &&
		Number.parseInt(mtprotoIdleMinutes, 10) <= 24 * 60
	) {
		add(
			'pass',
			'TELEGRAM_MTPROTO_SESSION_IDLE_MINUTES',
			`local GramJS worker idle timeout is ${mtprotoIdleMinutes} minute(s)`,
		);
	} else {
		add('fail', 'TELEGRAM_MTPROTO_SESSION_IDLE_MINUTES', 'expected an integer from 1 to 1440');
	}

	const awsKeys = configuredAwsKeys(env);
	if (awsKeys.length === 0) {
		add('pass', 'AWS credentials', 'not configured in .env.local or active shell');
	} else {
		add('fail', 'AWS credentials', `active keys detected: ${awsKeys.join(', ')}`);
	}

	const awsFiles = awsConfigFileSummary();
	if (awsFiles.length > 0) {
		add(
			'warn',
			'AWS profile files',
			'local AWS config files exist, but os-keychain mode will not use them unless AWS env vars are set',
		);
	}

	if (options.skipCredentialChecks) {
		// Credential provider checks are handled by telegram-doctor.mjs.
	} else if (options.allowMissingCredentials) {
		add('warn', 'Telegram API credentials', 'credential presence check skipped');
	} else {
		if (validateTelegramApiId(envValue(env, 'TELEGRAM_API_ID'))) {
			add('pass', 'TELEGRAM_API_ID', 'present and numeric');
		} else {
			add('fail', 'TELEGRAM_API_ID', 'missing or invalid');
		}
		if (validateTelegramApiHash(envValue(env, 'TELEGRAM_API_HASH'))) {
			add('pass', 'TELEGRAM_API_HASH', 'present and shaped like a Telegram API hash');
		} else {
			add('fail', 'TELEGRAM_API_HASH', 'missing or invalid');
		}
	}

	const workspaceKeyProvider = envValue(env, 'WORKSPACE_KEY_PROVIDER');
	const devKmsBypass = envValue(env, 'DEV_KMS_BYPASS');
	if (workspaceKeyProvider === 'os-keychain') {
		add(
			'pass',
			'WORKSPACE_KEY_PROVIDER',
			'is os-keychain; workspace root keys should be stored as Keychain markers after migration',
		);
	} else if (devKmsBypass === 'true') {
		add(
			'warn',
			'DEV_KMS_BYPASS',
			'local demo mode avoids AWS, but a DB/filesystem compromise may expose workspace data; use WORKSPACE_KEY_PROVIDER=os-keychain for real local workspaces',
		);
	} else {
		add(
			'warn',
			'DEV_KMS_BYPASS',
			'is not true; workspace encryption may require AWS KMS even though Telegram sessions use Keychain',
		);
	}

	for (const [key, value] of env.entries()) {
		if (
			key.startsWith('NEXT_PUBLIC_') &&
			isSecretLikeKey(key) &&
			value.length > 0 &&
			!KNOWN_PUBLIC_SECRET_LIKE_KEYS.has(key)
		) {
			add('fail', key, 'secret-like value is browser-exposed via NEXT_PUBLIC_');
		}
	}

	if (envHasValue(env, 'NEXT_PUBLIC_DEMO_PASSWORD')) {
		add(
			'warn',
			'NEXT_PUBLIC_DEMO_PASSWORD',
			'intentionally public demo helper is enabled; disable it before any shared or hosted environment',
		);
	}

	for (const key of ['NEXT_PUBLIC_APP_URL', 'BETTER_AUTH_URL', 'WEB_URL', 'WORKER_URL']) {
		const value = envValue(env, key);
		if (!value) {
			add('pass', key, 'unset; local default or in-process fallback applies');
		} else if (isLocalUrl(value)) {
			add('pass', key, 'points at a local host');
		} else {
			add('fail', key, 'must point at localhost/127.0.0.1/::1 for local Telegram mode');
		}
	}

	const corsOrigin = envValue(env, 'CORS_ORIGIN');
	if (!corsOrigin) {
		add('pass', 'CORS_ORIGIN', 'unset; worker default is localhost-only');
	} else if (isLocalUrlList(corsOrigin)) {
		add('pass', 'CORS_ORIGIN', 'allows only local hosts');
	} else {
		add('fail', 'CORS_ORIGIN', 'must allow only localhost/127.0.0.1/::1 for local Telegram mode');
	}

	const databaseUrl = envValue(env, 'DATABASE_URL');
	if (isLocalUrl(databaseUrl)) {
		add('pass', 'DATABASE_URL', 'points at a local host');
	} else {
		add('fail', 'DATABASE_URL', 'must point at localhost/127.0.0.1/::1 for normal local mode');
	}

	const redisUrl = envValue(env, 'DRAGONFLY_URL') || envValue(env, 'REDIS_URL');
	if (isLocalUrl(redisUrl)) {
		add('pass', 'Redis URL', 'points at a local host');
	} else {
		add('fail', 'Redis URL', 'must point at localhost/127.0.0.1/::1 for normal local mode');
	}

	return checks;
}
