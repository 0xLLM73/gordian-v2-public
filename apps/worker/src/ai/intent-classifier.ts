/**
 * Intent-aware Message Classification (H10)
 *
 * Regex-based structural classification of message intent:
 * - "question" → tighter response latency target (L50 = 4 hours)
 * - "informational" → relaxed response latency target (L50 = 12 hours)
 *
 * No AI calls. Deterministic, ~0ms per message.
 * Feeds into H4's response latency dimension for health scoring.
 */

// ── Question Detection Patterns ─────────────────────────────────────────

/**
 * Messages ending with a question mark (after trimming whitespace/emoji).
 */
const QUESTION_MARK_RE = /\?\s*$/;

/**
 * Messages starting with question words (case-insensitive).
 * Anchored to start-of-line to catch multi-line messages.
 */
const QUESTION_WORD_RE =
	/(?:^|\n)\s*(?:who|what|when|where|why|how|which|whose|whom|is|are|was|were|do|does|did|can|could|would|should|will|shall|have|has|had)\b/i;

/**
 * Request patterns — polite or direct asks for action.
 */
const REQUEST_PATTERN_RE =
	/\b(?:can you|could you|would you|will you|please|let me know|lmk|send me|share|thoughts\??|wdyt|what do you think|any update|update on|status on|eta on|timeline for)\b/i;

// ── Types ──────────────────────────────────────────────────────────────

export type MessageIntent = 'question' | 'informational';

export interface IntentClassification {
	intent: MessageIntent;
	confidence: number;
	signals: string[];
}

// ── Latency Targets (hours) ────────────────────────────────────────────

export const LATENCY_TARGETS = {
	question: 4,
	informational: 12,
} as const;

// ── Classifier ─────────────────────────────────────────────────────────

/**
 * Classify a message's intent using structural cues only.
 *
 * Returns "question" if any question/request signals are detected,
 * "informational" otherwise. Confidence is based on signal count.
 *
 * @param text - The message text (can be ELM-masked)
 */
export function classifyIntent(text: string): IntentClassification {
	const signals: string[] = [];

	if (QUESTION_MARK_RE.test(text)) {
		signals.push('question_mark');
	}

	if (QUESTION_WORD_RE.test(text)) {
		signals.push('question_word');
	}

	if (REQUEST_PATTERN_RE.test(text)) {
		signals.push('request_pattern');
	}

	if (signals.length === 0) {
		return { intent: 'informational', confidence: 0.8, signals: [] };
	}

	// More signals = higher confidence
	const confidence = Math.min(0.6 + signals.length * 0.15, 1.0);

	return { intent: 'question', confidence, signals };
}

/**
 * Get the L50 latency target (in hours) for a message based on its intent.
 */
export function getLatencyTarget(text: string): number {
	const { intent } = classifyIntent(text);
	return LATENCY_TARGETS[intent];
}

/**
 * Batch-classify messages and return the proportion that are questions.
 * Useful for computing a contact's overall "question density" for scoring.
 */
export function computeQuestionDensity(messages: Array<{ content: string }>): number {
	if (messages.length === 0) return 0;
	const questionCount = messages.filter(
		(m) => classifyIntent(m.content).intent === 'question',
	).length;
	return questionCount / messages.length;
}
