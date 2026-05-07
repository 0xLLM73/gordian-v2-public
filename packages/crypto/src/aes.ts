import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV for GCM
const TAG_LENGTH = 16; // 128-bit auth tag

export function encrypt(plaintext: string, key: Buffer): string {
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
	const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	// Format: base64(IV + ciphertext + authTag)
	return Buffer.concat([iv, encrypted, tag]).toString('base64');
}

export function decrypt(ciphertext: string, key: Buffer): string {
	const buf = Buffer.from(ciphertext, 'base64');
	const iv = buf.subarray(0, IV_LENGTH);
	const tag = buf.subarray(buf.length - TAG_LENGTH);
	const encrypted = buf.subarray(IV_LENGTH, buf.length - TAG_LENGTH);
	const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
	decipher.setAuthTag(tag);
	return decipher.update(encrypted) + decipher.final('utf8');
}
