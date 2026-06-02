import { describe, expect, it } from 'vitest';
import { generatePersonPseudonym, maskContactAliases, maskEntities } from '../entity-masking';
import type { DetectedEntity } from '../types';

const salt = Buffer.from('test-workspace-salt-for-entity-masking');

describe('maskEntities', () => {
	it('replaces entities with pseudonyms', () => {
		const text = 'Alice called Bob yesterday';
		const entities: DetectedEntity[] = [
			{ text: 'Alice', type: 'PERSON', start: 0, end: 5 },
			{ text: 'Bob', type: 'PERSON', start: 13, end: 16 },
		];

		const result = maskEntities(text, salt, entities);

		expect(result.maskedText).not.toContain('Alice');
		expect(result.maskedText).not.toContain('Bob');
		expect(result.maskedText).toContain('PERSON_');
		expect(result.maskedText).toContain(' called ');
		expect(result.maskedText).toContain(' yesterday');
		expect(result.entityMap).toHaveLength(2);
	});

	it('produces consistent pseudonyms for same entity', () => {
		const entities: DetectedEntity[] = [{ text: 'Alice', type: 'PERSON', start: 0, end: 5 }];

		const result1 = maskEntities('Alice said hello', salt, entities);
		const result2 = maskEntities('Alice said goodbye', salt, entities);

		const alice1 = result1.entityMap.find((e) => e.original === 'Alice');
		const alice2 = result2.entityMap.find((e) => e.original === 'Alice');
		if (!alice1 || !alice2) throw new Error('Alice entity was not masked');
		expect(alice1.pseudonym).toBe(alice2.pseudonym);
	});

	it('produces different pseudonyms for different entities', () => {
		const text = 'Alice and Bob';
		const entities: DetectedEntity[] = [
			{ text: 'Alice', type: 'PERSON', start: 0, end: 5 },
			{ text: 'Bob', type: 'PERSON', start: 10, end: 13 },
		];

		const result = maskEntities(text, salt, entities);
		const alicePseudonym = result.entityMap.find((e) => e.original === 'Alice')?.pseudonym;
		const bobPseudonym = result.entityMap.find((e) => e.original === 'Bob')?.pseudonym;
		expect(alicePseudonym).not.toBe(bobPseudonym);
	});

	it('produces different pseudonyms for different workspaces', () => {
		const salt2 = Buffer.from('different-workspace-salt');
		const entities: DetectedEntity[] = [{ text: 'Alice', type: 'PERSON', start: 0, end: 5 }];

		const result1 = maskEntities('Alice', salt, entities);
		const result2 = maskEntities('Alice', salt2, entities);

		expect(result1.entityMap[0].pseudonym).not.toBe(result2.entityMap[0].pseudonym);
	});

	it('is case-insensitive for pseudonym generation', () => {
		const entities1: DetectedEntity[] = [{ text: 'Alice', type: 'PERSON', start: 0, end: 5 }];
		const entities2: DetectedEntity[] = [{ text: 'alice', type: 'PERSON', start: 0, end: 5 }];

		const result1 = maskEntities('Alice', salt, entities1);
		const result2 = maskEntities('alice', salt, entities2);

		expect(result1.entityMap[0].pseudonym).toBe(result2.entityMap[0].pseudonym);
	});

	it('handles multiple entity types', () => {
		const text = 'Send $500 to Alice at alice@example.com';
		const entities: DetectedEntity[] = [
			{ text: '$500', type: 'MONEY', start: 5, end: 9 },
			{ text: 'Alice', type: 'PERSON', start: 13, end: 18 },
			{ text: 'alice@example.com', type: 'EMAIL', start: 22, end: 39 },
		];

		const result = maskEntities(text, salt, entities);

		expect(result.maskedText).toContain('MONEY_');
		expect(result.maskedText).toContain('PERSON_');
		expect(result.maskedText).toContain('EMAIL_');
		expect(result.maskedText).not.toContain('$500');
		expect(result.maskedText).not.toContain('Alice');
		expect(result.maskedText).not.toContain('alice@example.com');
		expect(result.entityMap).toHaveLength(3);
	});

	it('preserves entity map for reverse lookup', () => {
		const text = 'Call Alice at +1234567890';
		const entities: DetectedEntity[] = [
			{ text: 'Alice', type: 'PERSON', start: 5, end: 10 },
			{ text: '+1234567890', type: 'PHONE', start: 14, end: 25 },
		];

		const result = maskEntities(text, salt, entities);

		for (const entry of result.entityMap) {
			expect(entry.original).toBeDefined();
			expect(entry.pseudonym).toBeDefined();
			expect(entry.type).toBeDefined();
			expect(result.maskedText).toContain(entry.pseudonym);
		}
	});

	it('returns unchanged text when no entities detected', () => {
		const text = 'The weather is nice today';
		const result = maskEntities(text, salt, []);

		expect(result.maskedText).toBe(text);
		expect(result.entityMap).toHaveLength(0);
	});

	it('handles empty text', () => {
		const result = maskEntities('', salt, []);
		expect(result.maskedText).toBe('');
		expect(result.entityMap).toHaveLength(0);
	});

	it('generates pseudonyms with exactly 8 hex characters (SEC-037)', () => {
		const entities: DetectedEntity[] = [{ text: 'Alice', type: 'PERSON', start: 0, end: 5 }];
		const result = maskEntities('Alice', salt, entities);
		const pseudonym = result.entityMap[0].pseudonym;
		// Format: TYPE_XXXXXXXX where X is exactly 8 hex chars
		expect(pseudonym).toMatch(/^PERSON_[0-9a-f]{8}$/);
	});

	it('handles overlapping positions correctly with descending sort', () => {
		const text = 'Alice and Bob went to Acme Corp HQ';
		const entities: DetectedEntity[] = [
			{ text: 'Alice', type: 'PERSON', start: 0, end: 5 },
			{ text: 'Bob', type: 'PERSON', start: 10, end: 13 },
			{ text: 'Acme Corp', type: 'ORG', start: 22, end: 31 },
		];

		const result = maskEntities(text, salt, entities);

		// All entities should be replaced
		expect(result.maskedText).not.toContain('Alice');
		expect(result.maskedText).not.toContain('Bob');
		expect(result.maskedText).not.toContain('Acme Corp');
		// Structure should be preserved
		expect(result.maskedText).toContain(' and ');
		expect(result.maskedText).toContain(' went to ');
		expect(result.maskedText).toContain(' HQ');
	});
});

describe('contact-aware masking', () => {
	it('masks full names with contact-id pseudonyms', () => {
		const result = maskContactAliases('Alice Johnson introduced Bob.', salt, [
			{ contactId: 'contact-alice', fullName: 'Alice Johnson' },
		]);
		const pseudonym = generatePersonPseudonym('contact-alice', salt);

		expect(result.maskedText).toBe(`${pseudonym} introduced Bob.`);
		expect(result.maskedText).not.toContain('Alice Johnson');
		expect(result.aliasMap).toEqual([
			{
				alias: 'Alice Johnson',
				matchedText: 'Alice Johnson',
				contactId: 'contact-alice',
				pseudonym,
				kind: 'fullName',
			},
		]);
	});

	it('masks @username and username variants', () => {
		const result = maskContactAliases('Ping @alicej and alicej today.', salt, [
			{ contactId: 'contact-alice', username: 'alicej' },
		]);
		const pseudonym = generatePersonPseudonym('contact-alice', salt);

		expect(result.maskedText).toBe(`Ping ${pseudonym} and ${pseudonym} today.`);
		expect(result.aliasMap.map((entry) => entry.matchedText)).toEqual(['@alicej', 'alicej']);
		expect(new Set(result.aliasMap.map((entry) => entry.pseudonym))).toEqual(new Set([pseudonym]));
	});

	it('prefers longest non-overlapping contact spans', () => {
		const result = maskContactAliases(
			'Alice Johnson said hi.',
			salt,
			[{ contactId: 'contact-alice', firstName: 'Alice', lastName: 'Johnson' }],
			{ maskFirstNames: true, maskLastNames: true },
		);
		const pseudonym = generatePersonPseudonym('contact-alice', salt);

		expect(result.maskedText).toBe(`${pseudonym} said hi.`);
		expect(result.aliasMap).toHaveLength(1);
		expect(result.aliasMap[0].kind).toBe('fullName');
	});

	it('does not mask partial words', () => {
		const result = maskContactAliases(
			'Annual planning with Ann and McAnn.',
			salt,
			[{ contactId: 'contact-ann', firstName: 'Ann' }],
			{ maskFirstNames: true },
		);
		const pseudonym = generatePersonPseudonym('contact-ann', salt);

		expect(result.maskedText).toBe(`Annual planning with ${pseudonym} and McAnn.`);
	});

	it('derives stable aliases from contact id, not raw alias text', () => {
		const alice = maskContactAliases(
			'Alice replied.',
			salt,
			[{ contactId: 'stable-contact-id', firstName: 'Alice' }],
			{ maskFirstNames: true },
		);
		const alicia = maskContactAliases(
			'Alicia replied.',
			salt,
			[{ contactId: 'stable-contact-id', firstName: 'Alicia' }],
			{ maskFirstNames: true },
		);
		const otherAlice = maskContactAliases(
			'Alice replied.',
			salt,
			[{ contactId: 'other-contact-id', firstName: 'Alice' }],
			{ maskFirstNames: true },
		);

		expect(alice.aliasMap[0].pseudonym).toBe(alicia.aliasMap[0].pseudonym);
		expect(alice.aliasMap[0].pseudonym).not.toBe(otherAlice.aliasMap[0].pseudonym);
	});

	it('combines contact masking with structured PII masking', () => {
		const result = maskContactAliases('Email Alice Johnson at alice@example.com.', salt, [
			{ contactId: 'contact-alice', fullName: 'Alice Johnson', username: 'alice' },
		]);

		expect(result.maskedText).toContain('PERSON_');
		expect(result.maskedText).toContain('EMAIL_');
		expect(result.maskedText).not.toContain('Alice Johnson');
		expect(result.maskedText).not.toContain('alice@example.com');
		expect(result.entityMap.map((entry) => entry.type)).toEqual(['PERSON', 'EMAIL']);
	});
});
