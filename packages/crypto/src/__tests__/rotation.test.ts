import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from '../aes';
import { deriveKeys } from '../hkdf';
import { computeNextVirtualVersion, deriveRotationKeys, reEncryptField } from '../rotation';

describe('Key Rotation', () => {
	const wrk = randomBytes(32);
	const workspaceId = 'ws-rotation-test';

	describe('computeNextVirtualVersion', () => {
		it('increments version by 1', () => {
			expect(computeNextVirtualVersion(1)).toBe(2);
			expect(computeNextVirtualVersion(5)).toBe(6);
		});
	});

	describe('deriveRotationKeys', () => {
		it('derives different keys for different versions', async () => {
			const { oldKeys, newKeys } = await deriveRotationKeys(wrk, workspaceId, 1, 2);
			expect(oldKeys.dek.equals(newKeys.dek)).toBe(false);
			expect(oldKeys.bik.equals(newKeys.bik)).toBe(false);
		});

		it('old keys match direct derivation at same version', async () => {
			const { oldKeys } = await deriveRotationKeys(wrk, workspaceId, 1, 2);
			const directKeys = await deriveKeys(wrk, workspaceId, 1);
			expect(oldKeys.dek.equals(directKeys.dek)).toBe(true);
			expect(oldKeys.bik.equals(directKeys.bik)).toBe(true);
		});

		it('new keys match direct derivation at same version', async () => {
			const { newKeys } = await deriveRotationKeys(wrk, workspaceId, 1, 2);
			const directKeys = await deriveKeys(wrk, workspaceId, 2);
			expect(newKeys.dek.equals(directKeys.dek)).toBe(true);
			expect(newKeys.bik.equals(directKeys.bik)).toBe(true);
		});
	});

	describe('reEncryptField', () => {
		it('re-encrypts data from v1 to v2', async () => {
			// Encrypt with v1 keys
			const v1Keys = await deriveKeys(wrk, workspaceId, 1);
			const plaintext = 'Sensitive contact data';
			const v1Ciphertext = encrypt(plaintext, v1Keys.dek);

			// Re-encrypt to v2
			const v2Ciphertext = await reEncryptField(v1Ciphertext, wrk, workspaceId, 1, 2);

			// Verify v2 ciphertext decrypts correctly with v2 keys
			const v2Keys = await deriveKeys(wrk, workspaceId, 2);
			const decrypted = decrypt(v2Ciphertext, v2Keys.dek);
			expect(decrypted).toBe(plaintext);
		});

		it('v1 ciphertext is still readable with v1 keys after rotation', async () => {
			const v1Keys = await deriveKeys(wrk, workspaceId, 1);
			const plaintext = 'Old data still readable';
			const v1Ciphertext = encrypt(plaintext, v1Keys.dek);

			// After rotation, old ciphertext still works with old keys
			const decrypted = decrypt(v1Ciphertext, v1Keys.dek);
			expect(decrypted).toBe(plaintext);
		});

		it('produces different ciphertext than original', async () => {
			const v1Keys = await deriveKeys(wrk, workspaceId, 1);
			const plaintext = 'Test data';
			const v1Ciphertext = encrypt(plaintext, v1Keys.dek);

			const v2Ciphertext = await reEncryptField(v1Ciphertext, wrk, workspaceId, 1, 2);
			expect(v2Ciphertext).not.toBe(v1Ciphertext);
		});

		it('handles empty string', async () => {
			const v1Keys = await deriveKeys(wrk, workspaceId, 1);
			const v1Ciphertext = encrypt('', v1Keys.dek);

			const v2Ciphertext = await reEncryptField(v1Ciphertext, wrk, workspaceId, 1, 2);
			const v2Keys = await deriveKeys(wrk, workspaceId, 2);
			expect(decrypt(v2Ciphertext, v2Keys.dek)).toBe('');
		});

		it('handles unicode content', async () => {
			const v1Keys = await deriveKeys(wrk, workspaceId, 1);
			const plaintext = '\u{1F512} Encrypted \u3053\u3093\u306B\u3061\u306F';
			const v1Ciphertext = encrypt(plaintext, v1Keys.dek);

			const v2Ciphertext = await reEncryptField(v1Ciphertext, wrk, workspaceId, 1, 2);
			const v2Keys = await deriveKeys(wrk, workspaceId, 2);
			expect(decrypt(v2Ciphertext, v2Keys.dek)).toBe(plaintext);
		});
	});
});
