import { AsyncLocalStorage } from 'node:async_hooks';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DecryptCommand, GenerateDataKeyCommand, KMSClient } from '@aws-sdk/client-kms';
import { deriveKeys } from './hkdf';
import type { DerivedKeys, SealedEnvelope } from './types';

const execFileAsync = promisify(execFile);
let kms: KMSClient | null = null;

export type TelegramSessionKeyProvider = 'aws-kms' | 'os-keychain' | 'dev-insecure';
export type WorkspaceKeyProvider = 'aws-kms' | 'os-keychain' | 'dev-insecure';

type KeychainMarker = {
	account: string;
	provider: 'os-keychain';
	service: string;
	version: 1;
};

const KEYCHAIN_MARKER_PREFIX = 'gordian:keychain:telegram-session-kek:v1:';
const WORKSPACE_KEYCHAIN_MARKER_PREFIX = 'gordian:keychain:workspace-wrk:v1:';
const KEYCHAIN_READ_TIMEOUT_MS = 30_000;
const KEYCHAIN_SET_SECRET_SWIFT = `import Foundation
import Security

func fail(_ message: String, code: Int32 = 1) -> Never {
\tFileHandle.standardError.write(Data((message + "\\n").utf8))
\texit(code)
}

guard CommandLine.arguments.count == 4 else {
\tfail("usage: keychain-set-secret <service> <account> <mode>")
}

let service = CommandLine.arguments[1]
let account = CommandLine.arguments[2]
let mode = CommandLine.arguments[3]
let input = FileHandle.standardInput.readDataToEndOfFile()

guard !input.isEmpty else {
\tfail("refusing to store empty keychain secret")
}

guard mode == "standard" || mode == "require-user-presence" else {
\tfail("invalid keychain mode")
}

let baseQuery: [String: Any] = [
\tkSecClass as String: kSecClassGenericPassword,
\tkSecAttrService as String: service,
\tkSecAttrAccount as String: account,
]

var attributes: [String: Any] = [
\tkSecValueData as String: input,
]

if mode == "require-user-presence" {
\tvar accessError: Unmanaged<CFError>?
\tguard let accessControl = SecAccessControlCreateWithFlags(
\t\tnil,
\t\tkSecAttrAccessibleWhenUnlockedThisDeviceOnly,
\t\t.userPresence,
\t\t&accessError
\t) else {
\t\tfail("SecAccessControlCreateWithFlags failed: \\(String(describing: accessError?.takeRetainedValue()))")
\t}
\tattributes[kSecAttrAccessControl as String] = accessControl
} else {
\tattributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
}

var addQuery = baseQuery
for (key, value) in attributes {
\taddQuery[key] = value
}

let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
if addStatus == errSecSuccess {
\texit(0)
}

if addStatus == errSecDuplicateItem {
\tlet updateStatus = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
\tif updateStatus == errSecSuccess {
\t\texit(0)
\t}
\tfail("SecItemUpdate failed with status \\(updateStatus)")
}

fail("SecItemAdd failed with status \\(addStatus)")
`;
const KEYCHAIN_GET_SECRET_SWIFT = `import Foundation
import Security

func fail(_ message: String, code: Int32 = 1) -> Never {
\tFileHandle.standardError.write(Data((message + "\\n").utf8))
\texit(code)
}

guard CommandLine.arguments.count == 4 else {
\tfail("usage: keychain-get-secret <service> <account> <mode>")
}

let service = CommandLine.arguments[1]
let account = CommandLine.arguments[2]
let mode = CommandLine.arguments[3]

guard mode == "standard" || mode == "require-user-presence" else {
\tfail("invalid keychain mode")
}

var query: [String: Any] = [
\tkSecClass as String: kSecClassGenericPassword,
\tkSecAttrService as String: service,
\tkSecAttrAccount as String: account,
\tkSecReturnData as String: true,
\tkSecMatchLimit as String: kSecMatchLimitOne,
]

if mode == "require-user-presence" {
\tquery[kSecUseOperationPrompt as String] = "Allow Gordian to unlock the local Telegram import session."
}

var item: CFTypeRef?
let status = SecItemCopyMatching(query as CFDictionary, &item)
if status == errSecItemNotFound {
\tfail("Keychain item could not be found")
}
if status != errSecSuccess {
\tfail("SecItemCopyMatching failed with status \\(status)")
}

guard let data = item as? Data else {
\tfail("Keychain item did not contain data")
}

FileHandle.standardOutput.write(data)
`;

function getCmkArn(): string {
	const arn = process.env.KMS_CMK_ARN;
	if (!arn) throw new Error('KMS_CMK_ARN is not set');
	return arn;
}

function getKmsClient(): KMSClient {
	kms ??= new KMSClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
	return kms;
}

function getKeychainService(): string {
	return (
		process.env.GORDIAN_KEYCHAIN_SERVICE?.trim() ||
		process.env.TELEGRAM_KEYCHAIN_SERVICE?.trim() ||
		'gordian-v2'
	);
}

function getWorkspaceKeychainService(): string {
	return process.env.WORKSPACE_KEYCHAIN_SERVICE?.trim() || getKeychainService();
}

function getKeychainAccount(userId: string): string {
	return `telegram-session:${userId}`;
}

function getUniqueKeychainAccount(userId: string): string {
	return `${getKeychainAccount(userId)}:${randomUUID()}`;
}

function getWorkspaceKeychainAccount(workspaceId: string): string {
	return `workspace-wrk:${workspaceId}`;
}

function getUniqueWorkspaceKeychainAccount(workspaceId: string): string {
	return `${getWorkspaceKeychainAccount(workspaceId)}:${randomUUID()}`;
}

function isKeychainAccountForUser(account: unknown, userId: string): account is string {
	if (typeof account !== 'string') return false;
	const legacyAccount = getKeychainAccount(userId);
	return account === legacyAccount || account.startsWith(`${legacyAccount}:`);
}

function isKeychainAccountForWorkspace(account: unknown, workspaceId: string): account is string {
	if (typeof account !== 'string') return false;
	const legacyAccount = getWorkspaceKeychainAccount(workspaceId);
	return account === legacyAccount || account.startsWith(`${legacyAccount}:`);
}

function encodeKeychainMarker(prefix: string, marker: KeychainMarker): Buffer {
	return Buffer.from(`${prefix}${JSON.stringify(marker)}`, 'utf8');
}

function encodeTelegramKeychainMarker(marker: KeychainMarker): Buffer {
	return encodeKeychainMarker(KEYCHAIN_MARKER_PREFIX, marker);
}

function encodeWorkspaceKeychainMarker(marker: KeychainMarker): Buffer {
	return encodeKeychainMarker(WORKSPACE_KEYCHAIN_MARKER_PREFIX, marker);
}

function decodeKeychainMarker(ciphertextBlob: Buffer, userId: string): KeychainMarker {
	const encoded = ciphertextBlob.toString('utf8');
	if (!encoded.startsWith(KEYCHAIN_MARKER_PREFIX)) {
		throw new Error(
			'Telegram session KEK blob is not an OS keychain marker. Re-authenticate after changing TELEGRAM_SESSION_KEY_PROVIDER.',
		);
	}

	const parsed = JSON.parse(
		encoded.slice(KEYCHAIN_MARKER_PREFIX.length),
	) as Partial<KeychainMarker>;
	if (
		parsed.provider !== 'os-keychain' ||
		parsed.version !== 1 ||
		!isKeychainAccountForUser(parsed.account, userId) ||
		typeof parsed.service !== 'string' ||
		parsed.service.length === 0
	) {
		throw new Error('Invalid Telegram session OS keychain marker');
	}

	return {
		account: parsed.account,
		provider: 'os-keychain',
		service: parsed.service,
		version: 1,
	};
}

function decodeWorkspaceKeychainMarker(encryptedWrk: Buffer, workspaceId: string): KeychainMarker {
	const encoded = encryptedWrk.toString('utf8');
	if (!encoded.startsWith(WORKSPACE_KEYCHAIN_MARKER_PREFIX)) {
		throw new Error(
			'Workspace WRK blob is not an OS keychain marker. Run the local workspace keychain migration after changing WORKSPACE_KEY_PROVIDER.',
		);
	}

	const parsed = JSON.parse(
		encoded.slice(WORKSPACE_KEYCHAIN_MARKER_PREFIX.length),
	) as Partial<KeychainMarker>;
	if (
		parsed.provider !== 'os-keychain' ||
		parsed.version !== 1 ||
		!isKeychainAccountForWorkspace(parsed.account, workspaceId) ||
		typeof parsed.service !== 'string' ||
		parsed.service.length === 0
	) {
		throw new Error('Invalid workspace OS keychain marker');
	}

	return {
		account: parsed.account,
		provider: 'os-keychain',
		service: parsed.service,
		version: 1,
	};
}

function tryDecodeKeychainMarker(
	ciphertextBlob: Buffer | null | undefined,
	userId: string,
): KeychainMarker | null {
	if (!ciphertextBlob) return null;
	const encoded = ciphertextBlob.toString('utf8');
	if (!encoded.startsWith(KEYCHAIN_MARKER_PREFIX)) return null;
	return decodeKeychainMarker(ciphertextBlob, userId);
}

function tryDecodeWorkspaceKeychainMarker(
	encryptedWrk: Buffer | null | undefined,
	workspaceId: string,
): KeychainMarker | null {
	if (!encryptedWrk) return null;
	const encoded = encryptedWrk.toString('utf8');
	if (!encoded.startsWith(WORKSPACE_KEYCHAIN_MARKER_PREFIX)) return null;
	return decodeWorkspaceKeychainMarker(encryptedWrk, workspaceId);
}

export function isWorkspaceKeychainMarker(encryptedWrk: Buffer): boolean {
	return encryptedWrk.toString('utf8').startsWith(WORKSPACE_KEYCHAIN_MARKER_PREFIX);
}

function ensureMacOsKeychainAvailable(): void {
	if (process.platform !== 'darwin') {
		throw new Error(
			'OS Keychain providers currently require macOS Keychain. Use aws-kms on this platform.',
		);
	}
}

function isSecurityCliNotFound(error: unknown): boolean {
	if (typeof error !== 'object' || error === null) return false;
	const code = 'code' in error ? (error as { code?: unknown }).code : undefined;
	const stderr = 'stderr' in error ? String((error as { stderr?: unknown }).stderr ?? '') : '';
	return code === 44 || stderr.includes('could not be found') || stderr.includes('not be found');
}

async function keychainSetSecret(marker: KeychainMarker, secretBase64: string): Promise<void> {
	ensureMacOsKeychainAvailable();
	await runKeychainSetHelper(marker, secretBase64);
}

function keychainMode(marker: KeychainMarker): 'standard' | 'require-user-presence' {
	if (
		marker.account.startsWith('telegram-session:') &&
		process.env.TELEGRAM_KEYCHAIN_REQUIRE_USER_PRESENCE?.trim() === 'true'
	) {
		return 'require-user-presence';
	}
	return 'standard';
}

async function runKeychainSetHelper(marker: KeychainMarker, secretBase64: string): Promise<void> {
	const helperDir = mkdtempSync(join(tmpdir(), 'gordian-keychain-helper-'));
	const helperPath = join(helperDir, 'keychain-set-secret.swift');
	const moduleCachePath = join(tmpdir(), 'gordian-swift-module-cache');
	mkdirSync(moduleCachePath, { recursive: true });
	writeFileSync(helperPath, KEYCHAIN_SET_SECRET_SWIFT, { mode: 0o600 });

	const child = spawn(
		'swift',
		[
			'-module-cache-path',
			moduleCachePath,
			helperPath,
			marker.service,
			marker.account,
			keychainMode(marker),
		],
		{
			stdio: ['pipe', 'pipe', 'pipe'],
		},
	);

	let stdout = '';
	let stderr = '';
	child.stdout.setEncoding('utf8');
	child.stderr.setEncoding('utf8');
	child.stdout.on('data', (chunk) => {
		stdout += chunk;
	});
	child.stderr.on('data', (chunk) => {
		stderr += chunk;
	});

	const exitPromise = new Promise<void>((resolve, reject) => {
		child.once('error', (error) => {
			reject(
				new Error(
					`macOS Keychain helper failed to start. Install Xcode Command Line Tools or use aws-kms for Keychain-backed secrets. Cause: ${error.message}`,
				),
			);
		});
		child.once('close', (code, signal) => {
			if (code === 0) {
				resolve();
				return;
			}
			const detail = stderr.trim() || stdout.trim() || `exit code ${code ?? `signal ${signal}`}`;
			reject(new Error(`macOS Keychain helper failed: ${detail}`));
		});
	});

	child.stdin.end(secretBase64);
	try {
		await exitPromise;
	} finally {
		rmSync(helperDir, { recursive: true, force: true });
	}
}

async function keychainGetSecret(marker: KeychainMarker): Promise<Buffer> {
	ensureMacOsKeychainAvailable();
	return Buffer.from((await runKeychainGetHelper(marker)).trim(), 'base64');
}

async function runKeychainGetHelper(marker: KeychainMarker): Promise<string> {
	const helperDir = mkdtempSync(join(tmpdir(), 'gordian-keychain-helper-'));
	const helperPath = join(helperDir, 'keychain-get-secret.swift');
	const moduleCachePath = join(tmpdir(), 'gordian-swift-module-cache');
	mkdirSync(moduleCachePath, { recursive: true });
	writeFileSync(helperPath, KEYCHAIN_GET_SECRET_SWIFT, { mode: 0o600 });

	const child = spawn(
		'swift',
		[
			'-module-cache-path',
			moduleCachePath,
			helperPath,
			marker.service,
			marker.account,
			keychainMode(marker),
		],
		{
			stdio: ['ignore', 'pipe', 'pipe'],
		},
	);

	let stdout = '';
	let stderr = '';
	let timedOut = false;
	child.stdout.setEncoding('utf8');
	child.stderr.setEncoding('utf8');
	child.stdout.on('data', (chunk) => {
		stdout += chunk;
	});
	child.stderr.on('data', (chunk) => {
		stderr += chunk;
	});

	const timeout = setTimeout(() => {
		timedOut = true;
		child.kill('SIGTERM');
	}, KEYCHAIN_READ_TIMEOUT_MS);

	try {
		await new Promise<void>((resolve, reject) => {
			child.once('error', (error) => {
				reject(
					new Error(
						`macOS Keychain helper failed to start. Install Xcode Command Line Tools or use aws-kms for Keychain-backed secrets. Cause: ${error.message}`,
					),
				);
			});
			child.once('close', (code, signal) => {
				if (code === 0) {
					resolve();
					return;
				}
				const detail = timedOut
					? `timed out after ${KEYCHAIN_READ_TIMEOUT_MS}ms`
					: stderr.trim() || `exit code ${code ?? `signal ${signal}`}`;
				reject(new Error(`macOS Keychain helper failed: ${detail}`));
			});
		});
		return stdout;
	} finally {
		clearTimeout(timeout);
		rmSync(helperDir, { recursive: true, force: true });
	}
}

async function keychainDeleteSecret(marker: KeychainMarker): Promise<void> {
	ensureMacOsKeychainAvailable();
	try {
		await execFileAsync('security', [
			'delete-generic-password',
			'-a',
			marker.account,
			'-s',
			marker.service,
		]);
	} catch (error) {
		if (isSecurityCliNotFound(error)) return;
		throw error;
	}
}

export function getTelegramSessionKeyProvider(): TelegramSessionKeyProvider {
	const configured = process.env.TELEGRAM_SESSION_KEY_PROVIDER?.trim();
	if (configured) {
		if (configured === 'aws-kms' || configured === 'os-keychain' || configured === 'dev-insecure') {
			return configured;
		}
		throw new Error(
			`Invalid TELEGRAM_SESSION_KEY_PROVIDER="${configured}". Expected aws-kms, os-keychain, or dev-insecure.`,
		);
	}

	if (process.env.DEV_KMS_BYPASS === 'true') return 'dev-insecure';
	return 'aws-kms';
}

export function getWorkspaceKeyProvider(): WorkspaceKeyProvider {
	const configured = process.env.WORKSPACE_KEY_PROVIDER?.trim();
	if (configured) {
		if (configured === 'aws-kms' || configured === 'os-keychain' || configured === 'dev-insecure') {
			return configured;
		}
		throw new Error(
			`Invalid WORKSPACE_KEY_PROVIDER="${configured}". Expected aws-kms, os-keychain, or dev-insecure.`,
		);
	}

	if (process.env.DEV_KMS_BYPASS === 'true') return 'dev-insecure';
	return 'aws-kms';
}

export function assertSafeTelegramSessionKeyProviderForMtProto(): void {
	const provider = getTelegramSessionKeyProvider();
	if (provider === 'dev-insecure') {
		throw new Error(
			'TELEGRAM_MTPROTO_ENABLED=true requires TELEGRAM_SESSION_KEY_PROVIDER=os-keychain or aws-kms. dev-insecure stores the Telegram session KEK beside the encrypted session and is only for synthetic local demos/tests.',
		);
	}
	if (provider === 'os-keychain') {
		ensureMacOsKeychainAvailable();
	}
}

/**
 * Returns true only when running in an explicitly local environment.
 * Allowlist: bypass is permitted ONLY when NODE_ENV is 'development' or 'test'.
 * Any other value (including undefined) is treated as production.
 */
function isDevKmsBypass(): boolean {
	if (process.env.DEV_KMS_BYPASS !== 'true') return false;
	const env = process.env.NODE_ENV;
	if (env === 'development' || env === 'test') return true;
	throw new Error(
		`DEV_KMS_BYPASS is set but NODE_ENV="${env}" is not "development" or "test" — refusing to bypass KMS`,
	);
}

/** Key cache: stores Promises (not values) to prevent stampede */
const keyCache = new Map<string, { promise: Promise<Buffer>; expiresAt: number }>();
const KEY_CACHE_MAX_SIZE = 50; // SEC-KMS-003: LRU eviction to bound memory

function workspaceKeyCacheTtlMs(): number {
	const raw = process.env.WORKSPACE_KEY_CACHE_TTL_MINUTES?.trim();
	if (!raw) return 5 * 60 * 1000;
	const minutes = Number.parseInt(raw, 10);
	if (!Number.isFinite(minutes) || minutes < 0 || minutes > 24 * 60) {
		throw new Error(
			`Invalid WORKSPACE_KEY_CACHE_TTL_MINUTES="${raw}". Expected an integer from 0 to 1440.`,
		);
	}
	return minutes * 60 * 1000;
}

/** AsyncLocalStorage for per-request key context */
export const keyStore = new AsyncLocalStorage<DerivedKeys>();

/** Return the key context loaded by withKeys(), or fail closed if none is active. */
export function getCurrentKeys(): DerivedKeys {
	const keys = keyStore.getStore();
	if (!keys) throw new Error('Crypto keys are not loaded');
	return keys;
}

/**
 * Unwrap a Workspace Root Key from its sealed envelope.
 * Uses Promise-based L2 cache to prevent stampede during 9AM login bursts.
 * In local dev with DEV_KMS_BYPASS=true, derives a deterministic key from the envelope.
 */
export async function unwrapWrk(envelope: SealedEnvelope): Promise<Buffer> {
	const cacheKey = `wrk:${envelope.kmsContext.WorkspaceID}:v${envelope.wrkVersion}`;
	const now = Date.now();
	const cacheTtl = workspaceKeyCacheTtlMs();

	const cached = keyCache.get(cacheKey);
	if (cached && cached.expiresAt > now) {
		return cached.promise; // Return the PROMISE, not the value — prevents stampede
	}

	const promise = (async () => {
		const workspaceId = envelope.kmsContext.WorkspaceID;
		if (!workspaceId) throw new Error('WorkspaceID missing from KMS context');

		const marker = tryDecodeWorkspaceKeychainMarker(envelope.encryptedWrk, workspaceId);
		if (marker) {
			return keychainGetSecret(marker);
		}

		const provider = getWorkspaceKeyProvider();
		if (provider === 'os-keychain') {
			throw new Error(
				'WORKSPACE_KEY_PROVIDER=os-keychain requires workspaces.encrypted_wrk to contain a Keychain marker. Run pnpm workspace-key:migrate-local-keychain.',
			);
		}

		// Local dev bypass: seed script stores unencrypted WRK directly
		if (provider === 'dev-insecure') {
			if (!isDevKmsBypass()) {
				throw new Error(
					'WORKSPACE_KEY_PROVIDER=dev-insecure requires DEV_KMS_BYPASS=true in NODE_ENV=development or NODE_ENV=test',
				);
			}
			return Buffer.isBuffer(envelope.encryptedWrk)
				? envelope.encryptedWrk
				: Buffer.from(envelope.encryptedWrk);
		}

		const result = await getKmsClient().send(
			new DecryptCommand({
				CiphertextBlob: envelope.encryptedWrk,
				KeyId: getCmkArn(),
				EncryptionContext: envelope.kmsContext,
			}),
		);
		if (!result.Plaintext) throw new Error('KMS decrypt returned empty plaintext');
		return Buffer.from(result.Plaintext);
	})();

	// SEC-KMS-003: Evict oldest entry if cache exceeds max size
	if (keyCache.size >= KEY_CACHE_MAX_SIZE) {
		const oldestKey = keyCache.keys().next().value;
		if (oldestKey) keyCache.delete(oldestKey);
	}
	if (cacheTtl > 0) {
		keyCache.set(cacheKey, { promise, expiresAt: now + cacheTtl });
	}
	return promise;
}

/**
 * Run a callback with decryption keys loaded into AsyncLocalStorage.
 * This is the entry point for all DAL operations.
 */
export async function withKeys<T>(envelope: SealedEnvelope, fn: () => Promise<T>): Promise<T> {
	const wrk = await unwrapWrk(envelope);
	const keys = await deriveKeys(wrk, envelope.kmsContext.WorkspaceID, envelope.wrkVersion);
	return keyStore.run(keys, fn);
}

/** Clear the key cache (for testing) */
export function clearKeyCache(): void {
	keyCache.clear();
}

/**
 * Generate a per-user KEK for encrypting Telegram sessions.
 * Returns both the plaintext key (use then zero!) and the KMS-encrypted blob (store in DB).
 */
export async function generateSessionKek(userId: string): Promise<{
	plaintext: Buffer;
	ciphertextBlob: Buffer;
}> {
	const provider = getTelegramSessionKeyProvider();

	if (provider === 'dev-insecure') {
		if (!isDevKmsBypass()) {
			throw new Error(
				'TELEGRAM_SESSION_KEY_PROVIDER=dev-insecure requires DEV_KMS_BYPASS=true in NODE_ENV=development or NODE_ENV=test',
			);
		}
		const { randomBytes } = await import('node:crypto');
		const key = randomBytes(32);
		return { plaintext: Buffer.from(key), ciphertextBlob: Buffer.from(key) };
	}

	if (provider === 'os-keychain') {
		const { randomBytes } = await import('node:crypto');
		const key = randomBytes(32);
		const marker: KeychainMarker = {
			account: getUniqueKeychainAccount(userId),
			provider: 'os-keychain',
			service: getKeychainService(),
			version: 1,
		};
		await keychainSetSecret(marker, key.toString('base64'));
		return { plaintext: Buffer.from(key), ciphertextBlob: encodeTelegramKeychainMarker(marker) };
	}

	const result = await getKmsClient().send(
		new GenerateDataKeyCommand({
			KeyId: getCmkArn(),
			KeySpec: 'AES_256',
			EncryptionContext: { UserId: userId, Purpose: 'telegram-session' },
		}),
	);

	if (!result.Plaintext || !result.CiphertextBlob) {
		throw new Error('KMS GenerateDataKey returned empty result');
	}

	return {
		plaintext: Buffer.from(result.Plaintext),
		ciphertextBlob: Buffer.from(result.CiphertextBlob),
	};
}

/**
 * Decrypt a per-user session KEK from its KMS-encrypted blob.
 * Caller MUST zero the returned Buffer after use.
 */
export async function decryptSessionKek(ciphertextBlob: Buffer, userId: string): Promise<Buffer> {
	const provider = getTelegramSessionKeyProvider();

	if (provider === 'dev-insecure') {
		if (!isDevKmsBypass()) {
			throw new Error(
				'TELEGRAM_SESSION_KEY_PROVIDER=dev-insecure requires DEV_KMS_BYPASS=true in NODE_ENV=development or NODE_ENV=test',
			);
		}
		return Buffer.from(ciphertextBlob); // Dev mode: blob IS the key
	}

	if (provider === 'os-keychain') {
		return keychainGetSecret(decodeKeychainMarker(ciphertextBlob, userId));
	}

	const result = await getKmsClient().send(
		new DecryptCommand({
			CiphertextBlob: ciphertextBlob,
			KeyId: getCmkArn(),
			EncryptionContext: { UserId: userId, Purpose: 'telegram-session' },
		}),
	);

	if (!result.Plaintext) throw new Error('KMS decrypt returned empty plaintext');
	return Buffer.from(result.Plaintext);
}

/**
 * Delete locally stored Telegram session KEK material.
 * AWS KMS and dev-insecure blobs have no separate local secret to remove.
 */
export async function deleteSessionKek(
	userId: string,
	ciphertextBlob?: Buffer | null,
): Promise<void> {
	const marker =
		tryDecodeKeychainMarker(ciphertextBlob, userId) ??
		(getTelegramSessionKeyProvider() === 'os-keychain'
			? {
					account: getKeychainAccount(userId),
					provider: 'os-keychain' as const,
					service: getKeychainService(),
					version: 1 as const,
				}
			: null);

	if (!marker) return;
	await keychainDeleteSecret(marker);
}

/**
 * Re-store an existing Telegram session KEK using the currently configured
 * Keychain access policy. Useful after enabling user-presence or tightening
 * accessibility on an already linked local Telegram account.
 */
export async function rehardenSessionKek(userId: string, ciphertextBlob: Buffer): Promise<void> {
	const marker = decodeKeychainMarker(ciphertextBlob, userId);
	const secretBase64 = (await runKeychainGetHelper(marker)).trim();
	await keychainSetSecret(marker, secretBase64);
}

/**
 * Generate a KMS-wrapped Workspace Root Key for a new workspace.
 * Returns the encrypted WRK blob (store in DB) and the KMS encryption context.
 */
export async function generateWorkspaceWrk(workspaceId: string): Promise<{
	encryptedWrk: Buffer;
	kmsContext: Record<string, string>;
}> {
	const kmsContext = { WorkspaceID: workspaceId, Purpose: 'workspace-root-key' };
	const provider = getWorkspaceKeyProvider();

	if (provider === 'dev-insecure') {
		if (!isDevKmsBypass()) {
			throw new Error(
				'WORKSPACE_KEY_PROVIDER=dev-insecure requires DEV_KMS_BYPASS=true in NODE_ENV=development or NODE_ENV=test',
			);
		}
		const { randomBytes } = await import('node:crypto');
		return { encryptedWrk: randomBytes(32), kmsContext };
	}

	if (provider === 'os-keychain') {
		const { randomBytes } = await import('node:crypto');
		const wrk = randomBytes(32);
		const encryptedWrk = await storeWorkspaceWrkInKeychain(workspaceId, wrk);
		wrk.fill(0);
		return { encryptedWrk, kmsContext };
	}

	const result = await getKmsClient().send(
		new GenerateDataKeyCommand({
			KeyId: getCmkArn(),
			KeySpec: 'AES_256',
			EncryptionContext: kmsContext,
		}),
	);

	if (!result.CiphertextBlob) {
		throw new Error('KMS GenerateDataKey returned empty CiphertextBlob');
	}

	// We only store the encrypted blob — the plaintext is never persisted.
	// It will be unwrapped on-demand via unwrapWrk().
	return {
		encryptedWrk: Buffer.from(result.CiphertextBlob),
		kmsContext,
	};
}

export async function storeWorkspaceWrkInKeychain(
	workspaceId: string,
	wrk: Buffer,
): Promise<Buffer> {
	if (wrk.length !== 32) {
		throw new Error(`Workspace WRK must be 32 bytes; got ${wrk.length}`);
	}
	const marker: KeychainMarker = {
		account: getUniqueWorkspaceKeychainAccount(workspaceId),
		provider: 'os-keychain',
		service: getWorkspaceKeychainService(),
		version: 1,
	};
	await keychainSetSecret(marker, wrk.toString('base64'));
	return encodeWorkspaceKeychainMarker(marker);
}

export async function deleteWorkspaceWrk(
	workspaceId: string,
	encryptedWrk?: Buffer | null,
): Promise<void> {
	const marker =
		tryDecodeWorkspaceKeychainMarker(encryptedWrk, workspaceId) ??
		(getWorkspaceKeyProvider() === 'os-keychain'
			? {
					account: getWorkspaceKeychainAccount(workspaceId),
					provider: 'os-keychain' as const,
					service: getWorkspaceKeychainService(),
					version: 1 as const,
				}
			: null);

	if (!marker) return;
	await keychainDeleteSecret(marker);
}
