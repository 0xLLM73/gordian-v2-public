/**
 * P8 — Regex Heuristic Layer for Commitment Detection
 *
 * Fast, zero-cost pre-filter that catches obvious commitment language
 * before calling the LLM. Confidence is ALWAYS < 0.9 — regex matches
 * NEVER auto-confirm. All matches go through draft mode for human review.
 *
 * Security: No new data leaves the system. No PII in patterns.
 */

export interface HeuristicResult {
	matched: boolean;
	pattern: string;
	confidence: number; // 0.7-0.85 (NEVER >= 0.9)
	extractedCommitment?: string;
}

interface PatternEntry {
	regex: RegExp;
	name: string;
	confidence: number;
}

const HIGH_CONFIDENCE: PatternEntry[] = [
	{ regex: /\bi will\b/i, name: 'i_will', confidence: 0.85 },
	{ regex: /\bi'll\s+\w+/i, name: 'i_ll', confidence: 0.85 },
	{ regex: /\blet me\s+\w+/i, name: 'let_me', confidence: 0.85 },
	{ regex: /\bi'm going to\b/i, name: 'im_going_to', confidence: 0.85 },
	{
		regex:
			/^\s*(?:(?:sure|yes|yeah|yep|ok|okay|sounds good|got it|roger|copy)[,:\-\s]*)?will do[.!?]?\s*$/i,
		name: 'will_do',
		confidence: 0.85,
	},
	{ regex: /\bi can\s+\w+\s+that/i, name: 'i_can_that', confidence: 0.85 },
];

const MEDIUM_CONFIDENCE: PatternEntry[] = [
	{ regex: /\bon it\b/i, name: 'on_it', confidence: 0.7 },
	{ regex: /\bi'll get back/i, name: 'get_back', confidence: 0.7 },
	{ regex: /\bgive me\s+\w+\s+(day|hour|minute|sec)/i, name: 'give_me_time', confidence: 0.7 },
	{
		regex: /\bby\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|eod|eow)/i,
		name: 'by_deadline',
		confidence: 0.7,
	},
];

const ALL_PATTERNS: PatternEntry[] = [...HIGH_CONFIDENCE, ...MEDIUM_CONFIDENCE];

const NEGATION_WORDS = ['not', "won't", "can't", 'never', 'wont', 'cant', "wouldn't", 'wouldnt'];
const PSEUDONYM_PATTERN = /PERSON_[0-9a-fA-F]+/;

/**
 * Check if a negation word appears within 3 words of the pattern match.
 * Checks both before and after the match position.
 * Returns true if negation is detected (should suppress match).
 */
function hasNegation(text: string, matchIndex: number, matchLength: number): boolean {
	// Check up to 3 words before the match
	const before = text.slice(0, matchIndex);
	const wordsBefore = before.trim().split(/\s+/).slice(-3);

	for (const word of wordsBefore) {
		const lower = word.toLowerCase().replace(/[.,!?;:'"]/g, '');
		if (NEGATION_WORDS.includes(lower)) return true;
	}

	// Check up to 3 words after the match
	const after = text.slice(matchIndex + matchLength);
	const wordsAfter = after.trim().split(/\s+/).slice(0, 3);

	for (const word of wordsAfter) {
		const lower = word.toLowerCase().replace(/[.,!?;:'"]/g, '');
		if (NEGATION_WORDS.includes(lower)) return true;
	}

	return false;
}

/**
 * Check if the subject of the sentence is a pseudonym (PERSON_[hex])
 * rather than first-person (I/me). Only first-person commitments count.
 */
function hasPseudonymSubject(text: string, matchIndex: number): boolean {
	const before = text.slice(0, matchIndex);
	const wordsBefore = before.trim().split(/\s+/).slice(-5);

	for (const word of wordsBefore) {
		if (PSEUDONYM_PATTERN.test(word)) return true;
	}

	return false;
}

/**
 * Extract the commitment sentence from the text around the match.
 */
function extractCommitment(text: string, matchIndex: number): string {
	// Find sentence boundaries
	const sentenceStart = text.lastIndexOf('.', matchIndex);
	const sentenceEnd = text.indexOf('.', matchIndex);

	const start = sentenceStart === -1 ? 0 : sentenceStart + 1;
	const end = sentenceEnd === -1 ? text.length : sentenceEnd + 1;

	return text.slice(start, end).trim();
}

export function checkCommitmentHeuristic(messageText: string): HeuristicResult {
	const noMatch: HeuristicResult = { matched: false, pattern: '', confidence: 0 };

	if (!messageText || messageText.trim().length === 0) return noMatch;

	for (const entry of ALL_PATTERNS) {
		const match = entry.regex.exec(messageText);
		if (!match) continue;

		// Negation guard: "not", "won't", "can't", "never" within 3 words → no match
		if (hasNegation(messageText, match.index, match[0].length)) continue;

		// Pseudonym guard: PERSON_[hex] as subject → no match. Only first-person.
		if (hasPseudonymSubject(messageText, match.index)) continue;

		return {
			matched: true,
			pattern: entry.name,
			confidence: entry.confidence,
			extractedCommitment: extractCommitment(messageText, match.index),
		};
	}

	return noMatch;
}
