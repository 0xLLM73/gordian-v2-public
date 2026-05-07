/**
 * GC3 — Deal Intent Binary Classifier (Layer 2)
 *
 * Lightweight Gemini Flash classification for messages that passed the
 * GC2 regex sieve. Determines whether the message discusses an investment
 * the user is personally involved in vs news/gossip/historical/pleasantries.
 *
 * CRITICAL: Input text MUST be ELM-masked before calling classifyDealIntent().
 * No plaintext PII should ever reach the Gemini API.
 */

import { inferWithGemini } from './gemini-inference';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface DealIntentResult {
	isInvestmentDiscussion: boolean;
	confidence: number;
}

// ─── System Prompt ──────────────────────────────────────────────────────────────

const CLASSIFIER_SYSTEM_PROMPT = `You are a binary classifier. Your ONLY job is to determine whether a Telegram message is discussing a potential investment deal that the sender is personally involved in.

Answer YES when the message:
- Discusses terms, amounts, or timelines for a deal the sender is negotiating or participating in
- References the sender's own allocation, cap table position, or vesting terms
- Contains first-person language about an active deal ("we're looking at", "our term sheet", "I'm committing")

Answer NO when the message:
- Reports news or gossip about someone else's deal ("I heard X raised", "did you see Y's round")
- References a historical deal ("last year we looked at", "back when")
- Is casual conversation that happens to mention deal terms
- Is retail crypto chatter (airdrops, whitelist spots, degen plays)
- Is pleasantries or small talk

Respond with ONLY a JSON object: {"isInvestmentDiscussion": true/false, "confidence": 0.0-1.0}

Do not include any other text, markdown, or explanation.`;

// ─── Main Classification Function ───────────────────────────────────────────────

/**
 * Classify whether a message (already passed GC2 regex sieve) discusses
 * an investment deal the user is personally involved in.
 *
 * Returns { isInvestmentDiscussion, confidence }.
 * On parse failure, returns { isInvestmentDiscussion: false, confidence: 0 }.
 */
export async function classifyDealIntent(messageText: string): Promise<DealIntentResult> {
	const noMatch: DealIntentResult = {
		isInvestmentDiscussion: false,
		confidence: 0,
	};

	if (!messageText || messageText.trim().length === 0) return noMatch;

	const responseText = await inferWithGemini({
		systemPrompt: CLASSIFIER_SYSTEM_PROMPT,
		userPrompt: messageText.trim(),
	});

	try {
		const cleaned = responseText.replace(/```json\n?|\n?```/g, '').trim();
		const parsed = JSON.parse(cleaned);

		if (
			typeof parsed.isInvestmentDiscussion !== 'boolean' ||
			typeof parsed.confidence !== 'number'
		) {
			console.log('[deal-classifier] Invalid response shape from Gemini');
			return noMatch;
		}

		return {
			isInvestmentDiscussion: parsed.isInvestmentDiscussion,
			confidence: Math.max(0, Math.min(1, parsed.confidence)),
		};
	} catch {
		console.log('[deal-classifier] Failed to parse Gemini JSON response');
		return noMatch;
	}
}
