import { describe, expect, it } from 'vitest';
import { MODEL_IDS, routeQuery } from '../query-router';

describe('routeQuery', () => {
	// ─── Sonnet signals ─────────────────────────────────────────────────────
	it.each([
		['why did this deal fail?', 'sonnet'],
		['trace the provenance of this commitment', 'sonnet'],
		['draft a message to Alice', 'sonnet'],
		['analyze the relationship between Bob and Carol', 'sonnet'],
		['compare these two deals', 'sonnet'],
		['explain the commitment history', 'sonnet'],
		['write a follow-up message', 'sonnet'],
		['compose an introduction email', 'sonnet'],
		['what strategy should I use?', 'sonnet'],
		['show me the relationship graph', 'sonnet'],
		['check provenance for this node', 'sonnet'],
	] as const)('routes "%s" to %s', (query, expected) => {
		expect(routeQuery(query)).toBe(expected);
	});

	// ─── Haiku signals ──────────────────────────────────────────────────────
	it.each([
		['search for Alice', 'haiku'],
		['find contacts named Bob', 'haiku'],
		['show me all deals', 'haiku'],
		['list my commitments', 'haiku'],
		['who is Alice?', 'haiku'],
		['what is deal status?', 'haiku'],
		['get the latest brief', 'haiku'],
		['how many contacts do I have?', 'haiku'],
		['status of my pipeline', 'haiku'],
		['health check', 'haiku'],
	] as const)('routes "%s" to %s', (query, expected) => {
		expect(routeQuery(query)).toBe(expected);
	});

	// ─── Sonnet wins over Haiku ─────────────────────────────────────────────
	it('routes Sonnet when both signals present', () => {
		expect(routeQuery('find and analyze the deal')).toBe('sonnet');
		expect(routeQuery('search for why this failed')).toBe('sonnet');
		expect(routeQuery('show me and explain the relationship')).toBe('sonnet');
	});

	// ─── Default to Sonnet ──────────────────────────────────────────────────
	it('defaults to Sonnet for ambiguous queries', () => {
		expect(routeQuery('hello')).toBe('sonnet');
		expect(routeQuery('hmm')).toBe('sonnet');
		expect(routeQuery('ok')).toBe('sonnet');
	});

	it('defaults to Sonnet for long queries (>20 words)', () => {
		const longQuery = `I need to know ${'more '.repeat(20)}about this`;
		expect(routeQuery(longQuery)).toBe('sonnet');
	});

	// ─── Case insensitivity ─────────────────────────────────────────────────
	it('is case-insensitive', () => {
		expect(routeQuery('SEARCH for Alice')).toBe('haiku');
		expect(routeQuery('EXPLAIN the deal')).toBe('sonnet');
	});
});

describe('MODEL_IDS', () => {
	it('maps sonnet to claude-sonnet-4-6', () => {
		expect(MODEL_IDS.sonnet).toBe('claude-sonnet-4-6');
	});

	it('maps haiku to claude-haiku-4-5-20251001', () => {
		expect(MODEL_IDS.haiku).toBe('claude-haiku-4-5-20251001');
	});
});
