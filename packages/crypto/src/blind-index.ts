import { createHmac } from 'node:crypto';

/**
 * Compute blind index: HMAC-SHA256 truncated to 64 bits (8 bytes), Base64 encoded.
 * 64-bit truncation prevents length-leakage attacks while maintaining
 * sufficient collision resistance for B-tree lookups.
 */
export function computeBlindIndex(value: string, bik: Buffer): string {
	const hmac = createHmac('sha256', bik).update(value.toLowerCase().trim()).digest();
	return hmac.subarray(0, 8).toString('base64'); // 64-bit truncation
}
