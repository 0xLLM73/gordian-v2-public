import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { computeBlindIndex } from '../blind-index';

describe('Blind Index (HMAC-SHA256, 64-bit truncated)', () => {
	const bik = randomBytes(32);

	it('produces deterministic output for same input', () => {
		const hash1 = computeBlindIndex('Alice', bik);
		const hash2 = computeBlindIndex('Alice', bik);
		expect(hash1).toBe(hash2);
	});

	it('is case-insensitive', () => {
		const hash1 = computeBlindIndex('Alice', bik);
		const hash2 = computeBlindIndex('alice', bik);
		expect(hash1).toBe(hash2);
	});

	it('trims whitespace', () => {
		const hash1 = computeBlindIndex('Alice', bik);
		const hash2 = computeBlindIndex('  Alice  ', bik);
		expect(hash1).toBe(hash2);
	});

	it('produces different output for different inputs', () => {
		const hash1 = computeBlindIndex('Alice', bik);
		const hash2 = computeBlindIndex('Bob', bik);
		expect(hash1).not.toBe(hash2);
	});

	it('produces different output for different keys', () => {
		const bik2 = randomBytes(32);
		const hash1 = computeBlindIndex('Alice', bik);
		const hash2 = computeBlindIndex('Alice', bik2);
		expect(hash1).not.toBe(hash2);
	});

	it('returns a Base64 string of 64-bit (8 bytes) truncation', () => {
		const hash = computeBlindIndex('Alice', bik);
		const decoded = Buffer.from(hash, 'base64');
		expect(decoded.length).toBe(8);
	});
});
