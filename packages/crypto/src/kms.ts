import { AsyncLocalStorage } from 'node:async_hooks';
import { DecryptCommand, GenerateDataKeyCommand, KMSClient } from '@aws-sdk/client-kms';
import { deriveKeys } from './hkdf';
import type { DerivedKeys, SealedEnvelope } from './types';

const kms = new KMSClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

function getCmkArn(): string {
	const arn = process.env.KMS_CMK_ARN;
	if (!arn) throw new Error('KMS_CMK_ARN is not set');
	return arn;
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
const KEY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const KEY_CACHE_MAX_SIZE = 50; // SEC-KMS-003: LRU eviction to bound memory

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

	const cached = keyCache.get(cacheKey);
	if (cached && cached.expiresAt > now) {
		return cached.promise; // Return the PROMISE, not the value — prevents stampede
	}

	const promise = (async () => {
		// Local dev bypass: seed script stores unencrypted WRK directly
		if (isDevKmsBypass()) {
			return Buffer.isBuffer(envelope.encryptedWrk)
				? envelope.encryptedWrk
				: Buffer.from(envelope.encryptedWrk);
		}

		const result = await kms.send(
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
	keyCache.set(cacheKey, { promise, expiresAt: now + KEY_CACHE_TTL });
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
	if (isDevKmsBypass()) {
		const { randomBytes } = await import('node:crypto');
		const key = randomBytes(32);
		return { plaintext: Buffer.from(key), ciphertextBlob: Buffer.from(key) };
	}

	const result = await kms.send(
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
	if (isDevKmsBypass()) {
		return Buffer.from(ciphertextBlob); // Dev mode: blob IS the key
	}

	const result = await kms.send(
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
 * Generate a KMS-wrapped Workspace Root Key for a new workspace.
 * Returns the encrypted WRK blob (store in DB) and the KMS encryption context.
 */
export async function generateWorkspaceWrk(workspaceId: string): Promise<{
	encryptedWrk: Buffer;
	kmsContext: Record<string, string>;
}> {
	const kmsContext = { WorkspaceID: workspaceId, Purpose: 'workspace-root-key' };

	if (isDevKmsBypass()) {
		const { randomBytes } = await import('node:crypto');
		return { encryptedWrk: randomBytes(32), kmsContext };
	}

	const result = await kms.send(
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
