import { describe, expect, it, vi } from 'vitest';

vi.mock('../../client', () => ({
	db: {},
}));

vi.mock('@repo/crypto', () => ({
	computeBlindIndex: vi.fn((value: string) => value),
	decrypt: vi.fn((value: string) => value),
	encrypt: vi.fn((value: string) => value),
	keyStore: {
		getStore: vi.fn(() => ({
			bik: Buffer.alloc(32),
			dek: Buffer.alloc(32),
			tsk: Buffer.alloc(32),
		})),
	},
	withKeys: vi.fn((_envelope: unknown, fn: () => unknown) => fn()),
}));

import { assessKnowledgeRelationshipCandidateForPromotion } from '../knowledge';

const BASE = {
	sourceNodeId: '11111111-1111-4111-8111-111111111111',
	targetNodeId: '22222222-2222-4222-8222-222222222222',
	linkType: 'related_to' as const,
};

describe('knowledge relationship candidate promotion gate', () => {
	it('keeps embedding matches review-only', () => {
		const result = assessKnowledgeRelationshipCandidateForPromotion({
			...BASE,
			evidenceKind: 'embedding_match',
			confidence: 0.92,
		});

		expect(result).toEqual({
			canPromote: false,
			status: 'review_only',
			reason:
				'embedding_match is a heuristic signal and needs direct quoted evidence before graph promotion',
		});
	});

	it('rejects negated LLM relationships', () => {
		const result = assessKnowledgeRelationshipCandidateForPromotion({
			...BASE,
			evidenceKind: 'llm_extracted',
			messageId: '33333333-3333-4333-8333-333333333333',
			metadata: {
				confirmedEligible: true,
				isExplicit: true,
				negated: true,
				quoteVerified: true,
			},
		});

		expect(result.canPromote).toBe(false);
		expect(result.status).toBe('rejected');
		expect(result.reason).toMatch(/negated/i);
	});

	it('keeps stale LLM relationships review-only', () => {
		const result = assessKnowledgeRelationshipCandidateForPromotion({
			...BASE,
			evidenceKind: 'llm_extracted',
			messageId: '33333333-3333-4333-8333-333333333333',
			metadata: {
				confirmedEligible: true,
				isExplicit: true,
				quoteVerified: true,
				temporalStatus: 'past',
			},
		});

		expect(result.canPromote).toBe(false);
		expect(result.status).toBe('review_only');
		expect(result.reason).toMatch(/temporal status past/i);
	});

	it('keeps unknown-temporal LLM relationships review-only', () => {
		const result = assessKnowledgeRelationshipCandidateForPromotion({
			...BASE,
			evidenceKind: 'llm_extracted',
			messageId: '33333333-3333-4333-8333-333333333333',
			metadata: {
				confirmedEligible: true,
				isExplicit: true,
				quoteVerified: true,
				temporalStatus: 'unknown',
			},
		});

		expect(result.canPromote).toBe(false);
		expect(result.status).toBe('review_only');
		expect(result.reason).toMatch(/temporal status unknown/i);
	});

	it('requires current temporal status for LLM relationship promotion', () => {
		const result = assessKnowledgeRelationshipCandidateForPromotion({
			...BASE,
			evidenceKind: 'llm_extracted',
			messageId: '33333333-3333-4333-8333-333333333333',
			metadata: {
				confirmedEligible: true,
				isExplicit: true,
				quoteVerified: true,
			},
		});

		expect(result.canPromote).toBe(false);
		expect(result.status).toBe('review_only');
		expect(result.reason).toMatch(/current temporal status/i);
	});

	it('requires quote verification for LLM relationship promotion', () => {
		const result = assessKnowledgeRelationshipCandidateForPromotion({
			...BASE,
			evidenceKind: 'llm_extracted',
			messageId: '33333333-3333-4333-8333-333333333333',
			metadata: {
				confirmedEligible: true,
				isExplicit: true,
				temporalStatus: 'current',
			},
		});

		expect(result.canPromote).toBe(false);
		expect(result.status).toBe('review_only');
		expect(result.reason).toMatch(/quote/i);
	});

	it('allows direct quote-backed LLM relationships', () => {
		const result = assessKnowledgeRelationshipCandidateForPromotion({
			...BASE,
			evidenceKind: 'llm_extracted',
			messageId: '33333333-3333-4333-8333-333333333333',
			metadata: {
				confirmedEligible: true,
				isExplicit: true,
				quoteVerified: true,
				temporalStatus: 'current',
			},
		});

		expect(result).toEqual({
			canPromote: true,
			status: 'eligible',
			reason: 'direct quote-backed LLM relationship is eligible for graph promotion',
		});
	});
});
