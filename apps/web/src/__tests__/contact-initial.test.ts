import { describe, expect, it } from 'vitest';
import { getContactInitial } from '@/lib/contact-initial';

describe('getContactInitial', () => {
	it('uses the first valid contact name character with deterministic casing', () => {
		expect(getContactInitial('alice')).toBe('A');
		expect(getContactInitial('éloise')).toBe('É');
		expect(getContactInitial('李')).toBe('李');
	});

	it('falls back across name parts when the first name starts with unsafe characters', () => {
		expect(getContactInitial('\uFFFD', 'smith')).toBe('S');
		expect(getContactInitial('👋 Ada', 'Lovelace')).toBe('A');
	});

	it('returns a stable placeholder when no valid initial exists', () => {
		expect(getContactInitial('', null, undefined)).toBe('?');
		expect(getContactInitial('\uFFFD', '  ')).toBe('?');
	});
});
