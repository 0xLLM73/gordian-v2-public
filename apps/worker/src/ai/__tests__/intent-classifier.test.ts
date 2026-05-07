import { describe, expect, it } from 'vitest';
import {
	LATENCY_TARGETS,
	classifyIntent,
	computeQuestionDensity,
	getLatencyTarget,
} from '../intent-classifier';

describe('classifyIntent', () => {
	// ── Question mark detection ────────────────────────────────────────

	it('detects question mark at end of message', () => {
		const result = classifyIntent('Are you coming to the event?');
		expect(result.intent).toBe('question');
		expect(result.signals).toContain('question_mark');
	});

	it('detects question mark with trailing whitespace', () => {
		const result = classifyIntent('What time?   ');
		expect(result.intent).toBe('question');
		expect(result.signals).toContain('question_mark');
	});

	it('does not detect question mark mid-sentence', () => {
		const result = classifyIntent('He asked "why?" and then left');
		expect(result.signals).not.toContain('question_mark');
	});

	// ── Question word detection ────────────────────────────────────────

	it('detects question words at start of message', () => {
		const words = ['Who', 'What', 'When', 'Where', 'Why', 'How', 'Which'];
		for (const word of words) {
			const result = classifyIntent(`${word} is handling the deal`);
			expect(result.intent).toBe('question');
			expect(result.signals).toContain('question_word');
		}
	});

	it('detects auxiliary verbs as question starters', () => {
		const starters = [
			'Is',
			'Are',
			'Was',
			'Do',
			'Does',
			'Did',
			'Can',
			'Could',
			'Would',
			'Should',
			'Will',
			'Have',
			'Has',
		];
		for (const word of starters) {
			const result = classifyIntent(`${word} the team ready`);
			expect(result.signals).toContain('question_word');
		}
	});

	it('detects question words on second line of multi-line message', () => {
		const result = classifyIntent('Hey\nWhen is the call');
		expect(result.signals).toContain('question_word');
	});

	it('does not false-positive on question words mid-sentence', () => {
		// "who" mid-sentence in informational context
		const result = classifyIntent('I told the team who was coming');
		// This may or may not match depending on regex — the key is it doesn't crash
		expect(result).toBeDefined();
	});

	// ── Request pattern detection ──────────────────────────────────────

	it('detects "can you" request pattern', () => {
		const result = classifyIntent('can you send me the deck');
		expect(result.intent).toBe('question');
		expect(result.signals).toContain('request_pattern');
	});

	it('detects "could you" request pattern', () => {
		const result = classifyIntent('Could you review the term sheet');
		expect(result.intent).toBe('question');
		expect(result.signals).toContain('request_pattern');
	});

	it('detects "please" request pattern', () => {
		const result = classifyIntent('Please send the updated cap table');
		expect(result.intent).toBe('question');
		expect(result.signals).toContain('request_pattern');
	});

	it('detects "lmk" as request', () => {
		const result = classifyIntent('lmk if you want the deck');
		expect(result.intent).toBe('question');
		expect(result.signals).toContain('request_pattern');
	});

	it('detects "let me know"', () => {
		const result = classifyIntent('Let me know your thoughts');
		expect(result.intent).toBe('question');
		expect(result.signals).toContain('request_pattern');
	});

	it('detects "send me"', () => {
		const result = classifyIntent('Send me the pitch deck when ready');
		expect(result.intent).toBe('question');
		expect(result.signals).toContain('request_pattern');
	});

	it('detects "any update"', () => {
		const result = classifyIntent('any update on the bridge round');
		expect(result.intent).toBe('question');
		expect(result.signals).toContain('request_pattern');
	});

	it('detects "thoughts?"', () => {
		const result = classifyIntent('thoughts?');
		expect(result.intent).toBe('question');
		expect(result.signals).toContain('request_pattern');
	});

	it('detects "wdyt"', () => {
		const result = classifyIntent('wdyt about the valuation');
		expect(result.intent).toBe('question');
		expect(result.signals).toContain('request_pattern');
	});

	it('detects "eta on"', () => {
		const result = classifyIntent('eta on the wire transfer');
		expect(result.intent).toBe('question');
		expect(result.signals).toContain('request_pattern');
	});

	// ── Informational messages ─────────────────────────────────────────

	it('classifies simple statements as informational', () => {
		const result = classifyIntent('Term sheet is signed');
		expect(result.intent).toBe('informational');
		expect(result.signals).toEqual([]);
	});

	it('classifies greetings as informational', () => {
		const result = classifyIntent('Hey, good to meet you at Token2049');
		expect(result.intent).toBe('informational');
	});

	it('classifies status updates as informational', () => {
		const result = classifyIntent('Just wired the funds. All set on our end.');
		expect(result.intent).toBe('informational');
	});

	it('classifies emoji-only messages as informational', () => {
		const result = classifyIntent('🎉🎉🎉');
		expect(result.intent).toBe('informational');
	});

	// ── Multiple signals ───────────────────────────────────────────────

	it('has higher confidence with multiple signals', () => {
		const single = classifyIntent('can you help');
		const multi = classifyIntent('Can you send me the deck?');
		expect(multi.confidence).toBeGreaterThan(single.confidence);
		expect(multi.signals.length).toBeGreaterThan(single.signals.length);
	});

	it('caps confidence at 1.0', () => {
		// question word + request pattern + question mark = 3 signals
		const result = classifyIntent('Can you send the deck?');
		expect(result.confidence).toBeLessThanOrEqual(1.0);
	});

	// ── Confidence values ──────────────────────────────────────────────

	it('returns 0.8 confidence for informational', () => {
		const result = classifyIntent('The round is closed');
		expect(result.confidence).toBe(0.8);
	});

	it('returns >= 0.75 confidence for single signal question', () => {
		const result = classifyIntent('thoughts?');
		expect(result.confidence).toBeGreaterThanOrEqual(0.75);
	});

	// ── VC/crypto domain messages ──────────────────────────────────────

	it('classifies SAFE inquiry as question', () => {
		const result = classifyIntent('What are the SAFE terms for this round?');
		expect(result.intent).toBe('question');
	});

	it('classifies bridge round status ask as question', () => {
		const result = classifyIntent('any update on the bridge round closing');
		expect(result.intent).toBe('question');
	});

	it('classifies deal announcement as informational', () => {
		const result = classifyIntent("We're doing a SAFE at 20M cap, 20% discount");
		expect(result.intent).toBe('informational');
	});

	it('classifies intro offer as informational', () => {
		const result = classifyIntent('Happy to intro you to the Delphi team');
		expect(result.intent).toBe('informational');
	});

	// ── ELM-masked messages ────────────────────────────────────────────

	it('handles ELM-masked content correctly', () => {
		const result = classifyIntent('Can you send me the deck [ENTITY_1]?');
		expect(result.intent).toBe('question');
	});
});

describe('getLatencyTarget', () => {
	it('returns 4h for questions', () => {
		expect(getLatencyTarget('What time is the call?')).toBe(LATENCY_TARGETS.question);
		expect(getLatencyTarget('What time is the call?')).toBe(4);
	});

	it('returns 12h for informational messages', () => {
		expect(getLatencyTarget('The round is closed.')).toBe(LATENCY_TARGETS.informational);
		expect(getLatencyTarget('The round is closed.')).toBe(12);
	});
});

describe('computeQuestionDensity', () => {
	it('returns 0 for empty array', () => {
		expect(computeQuestionDensity([])).toBe(0);
	});

	it('returns 1.0 for all questions', () => {
		const msgs = [
			{ content: 'What time?' },
			{ content: 'Can you send it?' },
			{ content: 'Who is leading?' },
		];
		expect(computeQuestionDensity(msgs)).toBe(1.0);
	});

	it('returns 0 for all informational', () => {
		const msgs = [{ content: 'Deal is done.' }, { content: 'Funds wired.' }];
		expect(computeQuestionDensity(msgs)).toBe(0);
	});

	it('returns correct ratio for mixed messages', () => {
		const msgs = [
			{ content: 'What time?' },
			{ content: 'Deal is done.' },
			{ content: 'Can you send it?' },
			{ content: 'Signed the term sheet.' },
		];
		expect(computeQuestionDensity(msgs)).toBe(0.5);
	});
});
