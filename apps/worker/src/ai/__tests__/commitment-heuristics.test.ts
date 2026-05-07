import { describe, expect, it } from 'vitest';
import { checkCommitmentHeuristic } from '../commitment-heuristics';

describe('checkCommitmentHeuristic', () => {
	describe('high-confidence patterns (0.85)', () => {
		it('matches "I will"', () => {
			const result = checkCommitmentHeuristic('I will send the docs tomorrow');
			expect(result.matched).toBe(true);
			expect(result.pattern).toBe('i_will');
			expect(result.confidence).toBe(0.85);
			expect(result.extractedCommitment).toContain('I will send the docs tomorrow');
		});

		it('matches "I\'ll + verb"', () => {
			const result = checkCommitmentHeuristic("I'll review the term sheet tonight");
			expect(result.matched).toBe(true);
			expect(result.pattern).toBe('i_ll');
			expect(result.confidence).toBe(0.85);
		});

		it('matches "let me + verb"', () => {
			const result = checkCommitmentHeuristic('Let me check with the team');
			expect(result.matched).toBe(true);
			expect(result.pattern).toBe('let_me');
			expect(result.confidence).toBe(0.85);
		});

		it('matches "I\'m going to"', () => {
			const result = checkCommitmentHeuristic("I'm going to follow up on this");
			expect(result.matched).toBe(true);
			expect(result.pattern).toBe('im_going_to');
			expect(result.confidence).toBe(0.85);
		});

		it('matches "will do"', () => {
			const result = checkCommitmentHeuristic('Sure, will do');
			expect(result.matched).toBe(true);
			expect(result.pattern).toBe('will_do');
			expect(result.confidence).toBe(0.85);
		});

		it('matches "I can + verb + that"', () => {
			const result = checkCommitmentHeuristic('I can handle that');
			expect(result.matched).toBe(true);
			expect(result.pattern).toBe('i_can_that');
			expect(result.confidence).toBe(0.85);
		});
	});

	describe('medium-confidence patterns (0.70)', () => {
		it('matches "on it"', () => {
			const result = checkCommitmentHeuristic("I'm on it");
			// "I'm going to" matches first at 0.85, but "on it" also present
			// The first-person "I'm" patterns take priority since they iterate first
			expect(result.matched).toBe(true);
		});

		it('matches standalone "on it"', () => {
			const result = checkCommitmentHeuristic('Yeah on it');
			expect(result.matched).toBe(true);
			expect(result.pattern).toBe('on_it');
			expect(result.confidence).toBe(0.7);
		});

		it('matches "I\'ll get back"', () => {
			const result = checkCommitmentHeuristic("I'll get back to you on pricing");
			expect(result.matched).toBe(true);
			// "I'll" high-confidence matches first
			expect(result.confidence).toBe(0.85);
		});

		it('matches "give me X days"', () => {
			const result = checkCommitmentHeuristic('Give me two days to review');
			expect(result.matched).toBe(true);
			expect(result.pattern).toBe('give_me_time');
			expect(result.confidence).toBe(0.7);
		});

		it('matches "by tomorrow"', () => {
			const result = checkCommitmentHeuristic("I'll have it ready by tomorrow");
			expect(result.matched).toBe(true);
			// "I'll" high-confidence matches first
			expect(result.confidence).toBe(0.85);
		});

		it('matches "by Monday"', () => {
			const result = checkCommitmentHeuristic('Will send by Monday');
			expect(result.matched).toBe(true);
		});

		it('matches "by eod"', () => {
			const result = checkCommitmentHeuristic('Should be done by eod');
			expect(result.matched).toBe(true);
			expect(result.pattern).toBe('by_deadline');
			expect(result.confidence).toBe(0.7);
		});
	});

	describe('negation guard', () => {
		it('suppresses "I will not"', () => {
			const result = checkCommitmentHeuristic('I will not be able to make it');
			expect(result.matched).toBe(false);
		});

		it('suppresses "won\'t" before pattern', () => {
			const result = checkCommitmentHeuristic("I won't will do that");
			expect(result.matched).toBe(false);
		});

		it('suppresses "can\'t" before pattern', () => {
			const result = checkCommitmentHeuristic("I can't let me explain");
			expect(result.matched).toBe(false);
		});

		it('suppresses "never" before pattern', () => {
			const result = checkCommitmentHeuristic('I would never will do something like that');
			expect(result.matched).toBe(false);
		});
	});

	describe('pseudonym guard', () => {
		it('suppresses PERSON_[hex] subject', () => {
			const result = checkCommitmentHeuristic('PERSON_a1b2c3 will send the docs');
			expect(result.matched).toBe(false);
		});

		it('allows first-person even with PERSON_ elsewhere', () => {
			const result = checkCommitmentHeuristic('I will send PERSON_a1b2c3 the docs');
			expect(result.matched).toBe(true);
			expect(result.pattern).toBe('i_will');
		});
	});

	describe('security constraints', () => {
		it('confidence never reaches 0.9', () => {
			const inputs = [
				'I will send it',
				"I'll handle that",
				'Let me check',
				"I'm going to do it",
				'will do',
				'I can fix that',
				'on it',
				"I'll get back",
				'give me two days',
				'by tomorrow',
			];

			for (const input of inputs) {
				const result = checkCommitmentHeuristic(input);
				if (result.matched) {
					expect(result.confidence).toBeLessThan(0.9);
				}
			}
		});
	});

	describe('edge cases', () => {
		it('returns no match for empty string', () => {
			const result = checkCommitmentHeuristic('');
			expect(result.matched).toBe(false);
		});

		it('returns no match for unrelated text', () => {
			const result = checkCommitmentHeuristic('The weather is nice today');
			expect(result.matched).toBe(false);
		});

		it('is case-insensitive', () => {
			const result = checkCommitmentHeuristic('I WILL SEND THE DOCS');
			expect(result.matched).toBe(true);
		});

		it('extracts the commitment sentence', () => {
			const result = checkCommitmentHeuristic(
				'Hey thanks. I will send the docs tomorrow. Talk soon.',
			);
			expect(result.matched).toBe(true);
			expect(result.extractedCommitment).toBe('I will send the docs tomorrow.');
		});
	});
});
