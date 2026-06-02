import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { writeKeychainSecret } from './keychain-secret-writer.mjs';

const execFileAsync = promisify(execFile);

export const DEFAULT_TELEGRAM_KEYCHAIN_SERVICE = 'gordian-v2-telegram';
export const DEFAULT_WORKSPACE_KEYCHAIN_SERVICE = 'gordian-v2-workspace';
export const DEFAULT_KEYCHAIN_SERVICE = 'gordian-v2';
export const DEFAULT_TELEGRAM_API_KEYCHAIN_ACCOUNT = 'telegram-api-credentials';
export const DEFAULT_ENV_PATH = path.resolve(process.cwd(), '.env.local');
export const TELEGRAM_LOCAL_MODE_VALUES = {
	TELEGRAM_MTPROTO_ENABLED: 'true',
	NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED: 'true',
	TELEGRAM_SESSION_KEY_PROVIDER: 'os-keychain',
	TELEGRAM_KEYCHAIN_SERVICE: DEFAULT_TELEGRAM_KEYCHAIN_SERVICE,
	TELEGRAM_KEYCHAIN_REQUIRE_USER_PRESENCE: 'false',
	TELEGRAM_KEYCHAIN_USER_PRESENCE_MODE: 'compat',
	TELEGRAM_MTPROTO_PER_INTERACTION_UNLOCK: 'false',
	TELEGRAM_MTPROTO_SESSION_IDLE_MINUTES: '5',
	TELEGRAM_API_CREDENTIAL_PROVIDER: 'os-keychain',
	TELEGRAM_API_KEYCHAIN_ACCOUNT: DEFAULT_TELEGRAM_API_KEYCHAIN_ACCOUNT,
	TELEGRAM_SEND_ENABLED: 'false',
	TELEGRAM_FULL_BACKFILL_ENABLED: 'false',
	TELEGRAM_PERIODIC_SYNC_ENABLED: 'false',
	WORKSPACE_KEY_PROVIDER: 'os-keychain',
	WORKSPACE_KEYCHAIN_SERVICE: DEFAULT_WORKSPACE_KEYCHAIN_SERVICE,
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

const STRICT_TOUCHID_PROBE_SWIFT = `import Foundation
import LocalAuthentication
import Security

func fail(_ message: String, code: Int32 = 1) -> Never {
\tFileHandle.standardError.write(Data((message + "\\n").utf8))
\texit(code)
}

guard CommandLine.arguments.count == 3 else {
\tfail("usage: strict-touchid-probe <service> <account>")
}

let service = CommandLine.arguments[1]
let account = CommandLine.arguments[2]
let secret = FileHandle.standardInput.readDataToEndOfFile()

guard !secret.isEmpty else {
\tfail("refusing to store empty secret")
}

var error: Unmanaged<CFError>?
guard let accessControl = SecAccessControlCreateWithFlags(
\tnil,
\tkSecAttrAccessibleWhenUnlockedThisDeviceOnly,
\t.userPresence,
\t&error
) else {
\tlet detail = error?.takeRetainedValue().localizedDescription ?? "unknown error"
\tfail("SecAccessControlCreateWithFlags failed: \\(detail)")
}

let baseQuery: [String: Any] = [
\tkSecClass as String: kSecClassGenericPassword,
\tkSecAttrService as String: service,
\tkSecAttrAccount as String: account,
]

SecItemDelete(baseQuery as CFDictionary)

var addQuery = baseQuery
addQuery[kSecValueData as String] = secret
addQuery[kSecAttrAccessControl as String] = accessControl

let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
guard addStatus == errSecSuccess else {
\tfail("SecItemAdd failed with status \\(addStatus)")
}

var readQuery = baseQuery
readQuery[kSecReturnData as String] = true
readQuery[kSecMatchLimit as String] = kSecMatchLimitOne
let context = LAContext()
context.localizedReason = "Allow Gordian to verify strict Telegram Touch ID unlock."
context.touchIDAuthenticationAllowableReuseDuration = 0
readQuery[kSecUseAuthenticationContext as String] = context

var item: CFTypeRef?
let readStatus = SecItemCopyMatching(readQuery as CFDictionary, &item)
guard readStatus == errSecSuccess else {
\tfail("SecItemCopyMatching failed with status \\(readStatus)")
}

guard let data = item as? Data, data == secret else {
\tfail("strict Touch ID read returned unexpected data")
}
`;

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
	return envValue(env, 'TELEGRAM_KEYCHAIN_SERVICE') || DEFAULT_TELEGRAM_KEYCHAIN_SERVICE;
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

export function getTelegramKeychainUserPresenceMode(env) {
	const configured = envValue(env, 'TELEGRAM_KEYCHAIN_USER_PRESENCE_MODE');
	if (!configured || configured === 'compat' || configured === 'acl') return 'compat';
	if (configured === 'strict' || configured === 'access-control') return 'strict';
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

async function execFileWithStdin(command, args, input) {
	return await new Promise((resolve, reject) => {
		const child = execFile(command, args, (error, stdout, stderr) => {
			if (error) {
				reject(new Error(String(stderr || stdout || error.message).trim()));
				return;
			}
			resolve({ stdout: String(stdout), stderr: String(stderr) });
		});
		child.stdin?.end(input);
	});
}

export async function probeMacOsStrictTouchIdKeychain(
	service = DEFAULT_TELEGRAM_KEYCHAIN_SERVICE,
	options = {},
) {
	if (process.platform !== 'darwin') {
		throw new Error('macOS Keychain is required for strict Touch ID keychain probes');
	}

	const account = `telegram-touchid-probe:${randomUUID()}`;
	const secret = randomBytes(32).toString('base64');
	const configuredHelperPath = options.helperPath?.trim();
	if (configuredHelperPath) {
		try {
			await execFileAsync('security', [
				'delete-generic-password',
				'-a',
				account,
				'-s',
				service,
			]).catch(() => {});
			await execFileWithStdin(
				configuredHelperPath,
				['set', service, account, 'strict-user-presence'],
				secret,
			);
			const { stdout } = await execFileWithStdin(
				configuredHelperPath,
				[
					'get',
					service,
					account,
					'strict-user-presence',
					'Allow Gordian to verify strict Telegram Touch ID unlock.',
				],
				'',
			);
			if (stdout.trim() !== secret) {
				throw new Error('strict Touch ID helper returned unexpected data');
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
		return;
	}

	const helperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gordian-touchid-probe-'));
	const probeSourcePath = path.join(helperDir, 'strict-touchid-probe.swift');
	const binaryPath = path.join(helperDir, 'strict-touchid-probe');
	try {
		fs.writeFileSync(probeSourcePath, STRICT_TOUCHID_PROBE_SWIFT, { mode: 0o600 });
		await execFileAsync('swiftc', [probeSourcePath, '-o', binaryPath]);
		await new Promise((resolve, reject) => {
			const child = execFile(binaryPath, [service, account], (error, stdout, stderr) => {
				if (error) {
					reject(
						new Error(
							String(stderr || stdout || error.message)
								.trim()
								.replace(new RegExp(secret, 'g'), '[redacted]') || 'strict Touch ID probe failed',
						),
					);
					return;
				}
				resolve();
			});
			child.stdin?.end(secret);
		});
	} finally {
		await execFileAsync('security', [
			'delete-generic-password',
			'-a',
			account,
			'-s',
			service,
		]).catch(() => {});
		fs.rmSync(helperDir, { recursive: true, force: true });
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
	const telegramKeychainService =
		envValue(env, 'TELEGRAM_KEYCHAIN_SERVICE') || DEFAULT_TELEGRAM_KEYCHAIN_SERVICE;
	const workspaceKeychainService =
		envValue(env, 'WORKSPACE_KEYCHAIN_SERVICE') || DEFAULT_WORKSPACE_KEYCHAIN_SERVICE;
	if (telegramKeychainService === workspaceKeychainService) {
		add(
			'warn',
			'Keychain service split',
			`Telegram and workspace keys share ${telegramKeychainService}; use separate services for clearer unlock boundaries`,
		);
	} else {
		add(
			'pass',
			'Keychain service split',
			`Telegram uses ${telegramKeychainService}; workspace uses ${workspaceKeychainService}`,
		);
	}
	if (envValue(env, 'TELEGRAM_KEYCHAIN_REQUIRE_USER_PRESENCE') === 'true') {
		const mode = getTelegramKeychainUserPresenceMode(env);
		if (mode === 'strict') {
			const helperPath =
				envValue(env, 'GORDIAN_KEYCHAIN_HELPER_PATH') ||
				process.env.GORDIAN_KEYCHAIN_HELPER_PATH ||
				'';
			add(
				'pass',
				'TELEGRAM_KEYCHAIN_REQUIRE_USER_PRESENCE',
				'is true with strict SecAccessControl Touch ID requested',
			);
			if (helperPath) {
				add(
					'pass',
					'GORDIAN_KEYCHAIN_HELPER_PATH',
					'configured for branded strict Touch ID keychain reads through the broker',
				);
			} else {
				add(
					'warn',
					'GORDIAN_KEYCHAIN_HELPER_PATH',
					'not configured; strict mode will compile a temporary local helper and macOS may show that helper name in prompts',
				);
			}
		} else if (mode === 'compat') {
			add(
				'warn',
				'TELEGRAM_KEYCHAIN_REQUIRE_USER_PRESENCE',
				'is true in compat mode; this uses macOS Keychain prompts but is not strict SecAccessControl userPresence',
			);
		} else {
			add('fail', 'TELEGRAM_KEYCHAIN_USER_PRESENCE_MODE', 'expected compat or strict');
		}
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
	const perInteractionUnlock = envValue(env, 'TELEGRAM_MTPROTO_PER_INTERACTION_UNLOCK') || 'false';
	if (perInteractionUnlock === 'true') {
		add(
			'pass',
			'TELEGRAM_MTPROTO_PER_INTERACTION_UNLOCK',
			'each history import MTProto RPC unlocks, connects, uses, and disconnects the session',
		);
	} else if (perInteractionUnlock === 'false') {
		add(
			'pass',
			'TELEGRAM_MTPROTO_PER_INTERACTION_UNLOCK',
			'one user-presence unlock opens the MTProto session for the import run; terminal states terminate the local worker',
		);
	} else {
		add('fail', 'TELEGRAM_MTPROTO_PER_INTERACTION_UNLOCK', 'expected true or false');
	}
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
