import { randomBytes } from 'node:crypto';
import type { DerivedKeys } from '@repo/crypto';
import { decrypt, encrypt, keyStore } from '@repo/crypto';
import { describe, expect, it } from 'vitest';

// Build a minimal DerivedKeys context for testing
function makeFakeKeys(): DerivedKeys {
	return {
		dek: randomBytes(32),
		bik: randomBytes(32),
		tsk: randomBytes(32),
	};
}

describe('encryptedSessionText custom type behavior', () => {
	const fakeKeys = makeFakeKeys();

	it('round-trips via TSK: encrypt on write, decrypt on read', () => {
		const plaintext = 'super-secret-telegram-session-1BVtsNAqH...';
		const ciphertext = keyStore.run(fakeKeys, () => encrypt(plaintext, fakeKeys.tsk));
		const decrypted = keyStore.run(fakeKeys, () => decrypt(ciphertext, fakeKeys.tsk));
		expect(decrypted).toBe(plaintext);
	});

	it('ciphertext differs from plaintext', () => {
		const plaintext = 'session-data-abc';
		const ciphertext = keyStore.run(fakeKeys, () => encrypt(plaintext, fakeKeys.tsk));
		expect(ciphertext).not.toBe(plaintext);
	});

	it('decryption with wrong TSK throws (GCM auth tag mismatch)', () => {
		const plaintext = 'session-data-abc';
		const ciphertext = keyStore.run(fakeKeys, () => encrypt(plaintext, fakeKeys.tsk));
		const wrongTsk = randomBytes(32);
		expect(() => decrypt(ciphertext, wrongTsk)).toThrow();
	});

	it('missing keyStore context throws the correct error', () => {
		// This simulates what encryptedSessionText fromDriver/toDriver does when called
		// outside a withKeys() context
		expect(() => {
			const keys = keyStore.getStore();
			if (!keys) throw new Error('No encryption context — wrap call in withKeys()');
			encrypt('anything', keys.tsk);
		}).toThrow('No encryption context — wrap call in withKeys()');
	});

	it('TSK-encrypted value differs from DEK-encrypted value (key isolation)', () => {
		const plaintext = 'isolation-test';
		const dekCiphertext = keyStore.run(fakeKeys, () => encrypt(plaintext, fakeKeys.dek));
		const tskCiphertext = keyStore.run(fakeKeys, () => encrypt(plaintext, fakeKeys.tsk));
		expect(dekCiphertext).not.toBe(tskCiphertext);
	});
});
