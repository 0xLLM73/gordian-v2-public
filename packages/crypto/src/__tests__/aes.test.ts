import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from '../aes';

describe('AES-256-GCM', () => {
	const key = randomBytes(32); // 256-bit key

	it('encrypts and decrypts round-trip', () => {
		const plaintext = 'Hello, Alice!';
		const ciphertext = encrypt(plaintext, key);
		const decrypted = decrypt(ciphertext, key);
		expect(decrypted).toBe(plaintext);
	});

	it('produces different ciphertext for same plaintext (random IV)', () => {
		const plaintext = 'Same input';
		const ct1 = encrypt(plaintext, key);
		const ct2 = encrypt(plaintext, key);
		expect(ct1).not.toBe(ct2);
	});

	it('fails to decrypt with wrong key', () => {
		const plaintext = 'Secret data';
		const ciphertext = encrypt(plaintext, key);
		const wrongKey = randomBytes(32);
		expect(() => decrypt(ciphertext, wrongKey)).toThrow();
	});

	it('fails to decrypt tampered ciphertext', () => {
		const plaintext = 'Tamper test';
		const ciphertext = encrypt(plaintext, key);
		const buf = Buffer.from(ciphertext, 'base64');
		buf[15] ^= 0xff; // Flip a byte in the ciphertext
		const tampered = buf.toString('base64');
		expect(() => decrypt(tampered, key)).toThrow();
	});

	it('handles empty string', () => {
		const plaintext = '';
		const ciphertext = encrypt(plaintext, key);
		const decrypted = decrypt(ciphertext, key);
		expect(decrypted).toBe('');
	});

	it('handles unicode text', () => {
		const plaintext = 'Hello, \u{1F30D}! Greetings in Japanese: \u3053\u3093\u306B\u3061\u306F';
		const ciphertext = encrypt(plaintext, key);
		const decrypted = decrypt(ciphertext, key);
		expect(decrypted).toBe(plaintext);
	});
});
