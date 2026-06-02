import { describe, expect, it } from 'vitest';
import { containsLikelyPII, prefilterEntities } from '../prefilter';

describe('prefilterEntities', () => {
	it('detects email addresses', () => {
		const entities = prefilterEntities('Contact alice@example.com for details');
		expect(entities).toHaveLength(1);
		expect(entities[0].type).toBe('EMAIL');
		expect(entities[0].text).toBe('alice@example.com');
	});

	it('detects phone numbers', () => {
		const entities = prefilterEntities('Call me at +1-555-123-4567');
		expect(entities).toHaveLength(1);
		expect(entities[0].type).toBe('PHONE');
		expect(entities[0].text).toContain('555');
	});

	it('detects money amounts with currency symbols', () => {
		const entities = prefilterEntities('The price is $1,500.00');
		expect(entities).toHaveLength(1);
		expect(entities[0].type).toBe('MONEY');
		expect(entities[0].text).toBe('$1,500.00');
	});

	it('detects crypto currency amounts', () => {
		const entities = prefilterEntities('Send 2.5 ETH to the address');
		expect(entities).toHaveLength(1);
		expect(entities[0].type).toBe('MONEY');
		expect(entities[0].text).toBe('2.5 ETH');
	});

	it('detects Telegram handles as person identifiers', () => {
		const entities = prefilterEntities('Ask @alice_dev about the intro');
		expect(entities).toHaveLength(1);
		expect(entities[0].type).toBe('PERSON');
		expect(entities[0].text).toBe('@alice_dev');
	});

	it('detects wallet addresses as address identifiers', () => {
		const entities = prefilterEntities('Send to 0x1111111111111111111111111111111111111111');
		expect(entities).toHaveLength(1);
		expect(entities[0].type).toBe('ADDRESS');
		expect(entities[0].text).toBe('0x1111111111111111111111111111111111111111');
	});

	it('detects multiple entities in one text', () => {
		const entities = prefilterEntities(
			'Email alice@example.com or call +1-555-987-6543 about the $500 payment',
		);
		expect(entities.length).toBeGreaterThanOrEqual(3);

		const types = entities.map((e) => e.type);
		expect(types).toContain('EMAIL');
		expect(types).toContain('PHONE');
		expect(types).toContain('MONEY');
	});

	it('returns empty array for text without PII', () => {
		const entities = prefilterEntities('The weather is nice today');
		expect(entities).toHaveLength(0);
	});

	it('ignores short numbers that look like phone numbers', () => {
		const entities = prefilterEntities('I have 42 items');
		const phoneEntities = entities.filter((e) => e.type === 'PHONE');
		expect(phoneEntities).toHaveLength(0);
	});

	it('preserves correct start/end positions', () => {
		const text = 'Pay $100 now';
		const entities = prefilterEntities(text);

		expect(entities).toHaveLength(1);
		expect(text.substring(entities[0].start, entities[0].end)).toBe('$100');
	});

	it('handles euro and pound symbols', () => {
		const entities1 = prefilterEntities('Cost is €250');
		expect(entities1).toHaveLength(1);
		expect(entities1[0].type).toBe('MONEY');

		const entities2 = prefilterEntities('Price is £99.99');
		expect(entities2).toHaveLength(1);
		expect(entities2[0].type).toBe('MONEY');
	});
});

describe('containsLikelyPII', () => {
	it('returns true for text with email', () => {
		expect(containsLikelyPII('Send to user@test.com')).toBe(true);
	});

	it('returns true for text with phone number', () => {
		expect(containsLikelyPII('Call +44 20 7946 0958')).toBe(true);
	});

	it('returns false for clean text', () => {
		expect(containsLikelyPII('Just a normal message')).toBe(false);
	});
});
