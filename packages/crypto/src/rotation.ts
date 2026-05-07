import { decrypt, encrypt } from './aes';
import { deriveKeys } from './hkdf';
import { keyStore, unwrapWrk } from './kms';
import type { DerivedKeys, SealedEnvelope } from './types';

/**
 * Key Rotation Module (Phase 7, followup5).
 *
 * Two rotation strategies:
 *
 * 1. Virtual Rotation (fast, no re-encryption):
 *    - Increment HKDF version number
 *    - New writes derive keys from WRK + new version
 *    - Old reads still work because old version is kept in the envelope
 *    - Use when: periodic key refresh, compliance rotation schedules
 *
 * 2. Root Rotation (slow, requires re-encryption):
 *    - Generate new WRK via KMS
 *    - Dual-key state: current WRK + previous WRK
 *    - Background BullMQ job re-encrypts all records with new WRK
 *    - Use when: key compromise suspected, employee departure, compliance
 */

/**
 * Virtual rotation: increment the HKDF version for a workspace.
 * Returns the new version number to be stored in the workspace record.
 *
 * This is a fast operation — no re-encryption needed.
 * New writes will derive keys with the new version.
 * Old data is still readable because the envelope carries the version it was encrypted with.
 */
export function computeNextVirtualVersion(currentVersion: number): number {
	return currentVersion + 1;
}

/**
 * Run a callback with decryption keys for a specific version,
 * allowing reads of data encrypted with any historical version.
 *
 * The version is embedded in the SealedEnvelope, so this
 * transparently handles multi-version reads.
 */
export async function withKeysForVersion<T>(
	envelope: SealedEnvelope,
	version: number,
	fn: () => Promise<T>,
): Promise<T> {
	const wrk = await unwrapWrk(envelope);
	const keys = await deriveKeys(wrk, envelope.kmsContext.WorkspaceID, version);
	return keyStore.run(keys, fn);
}

/**
 * Re-encrypt a single field value from one key version to another
 * under the same WRK. Used during virtual rotation background migration.
 */
export async function reEncryptField(
	ciphertext: string,
	wrk: Buffer,
	workspaceId: string,
	fromVersion: number,
	toVersion: number,
): Promise<string> {
	const oldKeys = await deriveKeys(wrk, workspaceId, fromVersion);
	const newKeys = await deriveKeys(wrk, workspaceId, toVersion);

	const plaintext = decrypt(ciphertext, oldKeys.dek);
	return encrypt(plaintext, newKeys.dek);
}

/**
 * Re-encrypt a field from one WRK to a new WRK (root rotation).
 * Both WRKs must be unwrapped before calling this.
 */
export async function reEncryptFieldWithNewWrk(
	ciphertext: string,
	workspaceId: string,
	oldWrk: Buffer,
	oldVersion: number,
	newWrk: Buffer,
	newVersion: number,
): Promise<string> {
	const oldKeys = await deriveKeys(oldWrk, workspaceId, oldVersion);
	const newKeys = await deriveKeys(newWrk, workspaceId, newVersion);

	const plaintext = decrypt(ciphertext, oldKeys.dek);
	return encrypt(plaintext, newKeys.dek);
}

/**
 * Derive both old and new key sets for a rotation operation.
 * Useful for batch re-encryption where you want to derive once.
 */
export async function deriveRotationKeys(
	wrk: Buffer,
	workspaceId: string,
	fromVersion: number,
	toVersion: number,
): Promise<{ oldKeys: DerivedKeys; newKeys: DerivedKeys }> {
	const [oldKeys, newKeys] = await Promise.all([
		deriveKeys(wrk, workspaceId, fromVersion),
		deriveKeys(wrk, workspaceId, toVersion),
	]);
	return { oldKeys, newKeys };
}
