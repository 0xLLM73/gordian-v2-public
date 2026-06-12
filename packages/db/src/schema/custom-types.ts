import { computeBlindIndex, decrypt, encrypt, keyStore } from '@repo/crypto';
import { customType } from 'drizzle-orm/pg-core';

/**
 * halfvec(512) column for pgvector. Uses half-precision (16-bit) floats
 * with 512 dimensions (Matryoshka truncation from text-embedding-3-small).
 * P3: Reduced from 1536→512 for 67% storage savings + faster HNSW scans.
 *
 * NOTE: Drizzle schema is for types only. The actual partitioned memories
 * table is created via raw SQL migration (0004_memories.sql).
 */
export const halfvec = customType<{ data: number[]; driverData: string }>({
	dataType: () => 'halfvec(512)',
	fromDriver: (value: string): number[] => {
		// pgvector returns '[0.1,0.2,...]' format
		return value.replace(/^\[/, '').replace(/\]$/, '').split(',').map(Number);
	},
	toDriver: (value: number[]): string => {
		return `[${value.join(',')}]`;
	},
});

/**
 * vector(1536) column for pgvector. Full precision (32-bit) floats
 * for graph operations where accuracy matters more than storage.
 */
export const pgVector = customType<{ data: number[]; driverData: string }>({
	dataType: () => 'vector(1536)',
	fromDriver: (value: string): number[] => {
		return value.replace(/^\[/, '').replace(/\]$/, '').split(',').map(Number);
	},
	toDriver: (value: number[]): string => {
		return `[${value.join(',')}]`;
	},
});

/**
 * Encrypted text column. Transparently encrypts on write, decrypts on read.
 * Uses AsyncLocalStorage to access current request's DEK.
 *
 * Read behavior: If no encryption context is active, returns the raw ciphertext.
 * This allows third-party libraries (Better Auth's Drizzle adapter) to SELECT *
 * from tables with encrypted columns without crashing. The ciphertext is opaque
 * and unusable without keys — no information leaks.
 *
 * Write behavior: Always requires encryption context. Throws if missing to
 * prevent accidental plaintext writes.
 */
export const encryptedText = customType<{ data: string; driverData: string }>({
	dataType: () => 'text',
	fromDriver: (value: string): string => {
		const keys = keyStore.getStore();
		if (!keys) return value; // Return ciphertext — caller has no keys to use it anyway
		return decrypt(value, keys.dek);
	},
	toDriver: (value: string): string => {
		const keys = keyStore.getStore();
		if (!keys) throw new Error('No encryption context — wrap call in withKeys()');
		return encrypt(value, keys.dek);
	},
});

/**
 * Encrypted JSON column. Stores JSON as encrypted text and parses it after
 * decrypting with the workspace DEK.
 */
export const encryptedJson = customType<{ data: unknown; driverData: string }>({
	dataType: () => 'text',
	fromDriver: (value: string): unknown => {
		const keys = keyStore.getStore();
		if (!keys) return value; // Return ciphertext when no keys are active.
		return JSON.parse(decrypt(value, keys.dek));
	},
	toDriver: (value: unknown): string => {
		const keys = keyStore.getStore();
		if (!keys) throw new Error('No encryption context — wrap call in withKeys()');
		return encrypt(JSON.stringify(value), keys.dek);
	},
});

/**
 * Encrypted session text column. Like encryptedText but uses TSK (Telegram Session Key)
 * instead of DEK. Isolates Telegram auth_key from general field encryption so a DEK
 * compromise does not expose Telegram sessions.
 *
 * Same read/write asymmetry as encryptedText: reads without context return ciphertext,
 * writes without context throw.
 */
export const encryptedSessionText = customType<{ data: string; driverData: string }>({
	dataType: () => 'text',
	fromDriver: (value: string): string => {
		const keys = keyStore.getStore();
		if (!keys) return value; // Return ciphertext — caller has no keys to use it anyway
		return decrypt(value, keys.tsk);
	},
	toDriver: (value: string): string => {
		const keys = keyStore.getStore();
		if (!keys) throw new Error('No encryption context — wrap call in withKeys()');
		return encrypt(value, keys.tsk);
	},
});

/**
 * Blind index column. Computed HMAC-SHA256 (64-bit truncated) on write.
 */
export const blindIndex = customType<{ data: string; driverData: string }>({
	dataType: () => 'text',
	fromDriver: (value: string): string => value, // Raw hash, no transformation
	toDriver: (value: string): string => {
		const keys = keyStore.getStore();
		if (!keys) throw new Error('No encryption context — wrap call in withKeys()');
		return computeBlindIndex(value, keys.bik);
	},
});
