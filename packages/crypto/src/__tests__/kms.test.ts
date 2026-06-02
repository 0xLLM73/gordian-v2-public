import { beforeEach, describe, expect, it } from 'vitest';
import {
	assertSafeTelegramSessionKeyProviderForMtProto,
	decryptSessionKek,
	generateSessionKek,
	getTelegramSessionKeyProvider,
} from '../kms';

// All tests run with DEV_KMS_BYPASS=true.
// In bypass mode: generateSessionKek returns a random key; ciphertextBlob IS the key.
beforeEach(() => {
	process.env.DEV_KMS_BYPASS = 'true';
	Reflect.deleteProperty(process.env, 'TELEGRAM_SESSION_KEY_PROVIDER');
	// Ensure production guard doesn't fire
	Reflect.deleteProperty(process.env, 'FLY_APP_NAME');
	Reflect.deleteProperty(process.env, 'COOLIFY_URL');
	process.env.NODE_ENV = 'test';
});

describe('Telegram session key provider config', () => {
	it('uses dev-insecure only when the local KMS bypass is enabled', () => {
		expect(getTelegramSessionKeyProvider()).toBe('dev-insecure');
	});

	it('uses an explicit OS keychain provider when configured', () => {
		process.env.TELEGRAM_SESSION_KEY_PROVIDER = 'os-keychain';
		expect(getTelegramSessionKeyProvider()).toBe('os-keychain');
	});

	it('rejects dev-insecure for MTProto startup', () => {
		expect(() => assertSafeTelegramSessionKeyProviderForMtProto()).toThrow(/dev-insecure/);
	});

	it('rejects unknown provider names', () => {
		process.env.TELEGRAM_SESSION_KEY_PROVIDER = 'plaintext';
		expect(() => getTelegramSessionKeyProvider()).toThrow(/Invalid TELEGRAM_SESSION_KEY_PROVIDER/);
	});

	it('requires DEV_KMS_BYPASS for explicit dev-insecure session KEKs', async () => {
		process.env.TELEGRAM_SESSION_KEY_PROVIDER = 'dev-insecure';
		process.env.DEV_KMS_BYPASS = 'false';
		await expect(generateSessionKek('user-no-bypass')).rejects.toThrow(/DEV_KMS_BYPASS=true/);
	});
});

describe('generateSessionKek', () => {
	it('returns a 32-byte plaintext key and ciphertextBlob', async () => {
		const { plaintext, ciphertextBlob } = await generateSessionKek('user-123');
		expect(plaintext.length).toBe(32);
		expect(ciphertextBlob.length).toBe(32);
	});

	it('two calls produce different keys (randomness)', async () => {
		const a = await generateSessionKek('user-123');
		const b = await generateSessionKek('user-123');
		// In dev bypass mode both should still be random
		expect(a.plaintext.equals(b.plaintext)).toBe(false);
	});

	it('returns Buffer instances', async () => {
		const { plaintext, ciphertextBlob } = await generateSessionKek('user-xyz');
		expect(Buffer.isBuffer(plaintext)).toBe(true);
		expect(Buffer.isBuffer(ciphertextBlob)).toBe(true);
	});
});

describe('decryptSessionKek', () => {
	it('round-trips: generate → decrypt → same plaintext', async () => {
		const { plaintext, ciphertextBlob } = await generateSessionKek('user-roundtrip');
		const recovered = await decryptSessionKek(ciphertextBlob, 'user-roundtrip');
		expect(recovered.equals(plaintext)).toBe(true);
	});

	it('returns a Buffer', async () => {
		const { ciphertextBlob } = await generateSessionKek('user-buf');
		const kek = await decryptSessionKek(ciphertextBlob, 'user-buf');
		expect(Buffer.isBuffer(kek)).toBe(true);
	});

	it('two users get different KEKs from the same generate call shape', async () => {
		const a = await generateSessionKek('user-a');
		const b = await generateSessionKek('user-b');
		expect(a.plaintext.equals(b.plaintext)).toBe(false);
	});
});

describe('generateSessionKek + encrypt/decrypt integration', () => {
	it('encrypts and decrypts a session string end-to-end', async () => {
		const { encrypt, decrypt } = await import('../aes');
		const { plaintext: kek, ciphertextBlob } = await generateSessionKek('user-e2e');

		const sessionString = '1BQANOTREALsessionStringForTesting==';
		const ciphertext = encrypt(sessionString, kek);

		// Simulate decrypt path: get kek from blob, decrypt session
		const recoveredKek = await decryptSessionKek(ciphertextBlob, 'user-e2e');
		const recovered = decrypt(ciphertext, recoveredKek);

		expect(recovered).toBe(sessionString);

		// Zero keys
		kek.fill(0);
		recoveredKek.fill(0);
	});
});
