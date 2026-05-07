/**
 * GC4 — Deal Candidate Extraction (Layer 3)
 *
 * Structured extraction via Gemini Flash for messages that passed
 * GC2 (regex sieve) and GC3 (binary classifier). Extracts deal title,
 * type, confidence, and signal phrases, then stores as a deal_candidate.
 *
 * CRITICAL: Input text MUST be ELM-masked before calling extractDealCandidate().
 * No plaintext PII should ever reach the Gemini API. The signals array stored
 * in the DB must also contain ELM-masked text only.
 */

import type { SealedEnvelope } from '@repo/crypto';
import { type DealCandidate, createDealCandidate, isDuplicateCandidate } from '@repo/db';
import { inferWithGemini } from './gemini-inference';

// ─── Types ──────────────────────────────────────────────────────────────────────

interface GeminiExtractionResult {
	dealTitleGuess: string;
	dealTypeGuess: string;
	confidence: number;
	signals: string[];
}

// ─── System Prompt ──────────────────────────────────────────────────────────────

const EXTRACTION_SYSTEM_PROMPT = `You are extracting structured deal information from a Telegram message about an investment deal.

Extract the following fields:
- dealTitleGuess: The name or subject of the deal being discussed (e.g. "Series A for ProjectX", "SAFT round"). Use what's mentioned in the message — do not fabricate.
- dealTypeGuess: One of "saft", "equity", "token_warrant", "convertible_note", "advisory", "unknown"
- confidence: How confident you are this is a real deal discussion (0.0 to 1.0)
- signals: Array of 1-5 key phrases from the message that indicate deal activity. Quote directly from the message text.

Respond with ONLY a JSON object:
{"dealTitleGuess": "...", "dealTypeGuess": "...", "confidence": 0.0, "signals": ["..."]}

Do not include any other text, markdown, or explanation.`;

// ─── Main Extraction Function ───────────────────────────────────────────────────

/**
 * Extract structured deal candidate data from a message that passed
 * GC2 + GC3. Stores the result via createDealCandidate() DAL function.
 *
 * Returns the created DealCandidate, or null on failure/duplicate/low-confidence.
 * All error paths return null (fail-safe).
 */
export async function extractDealCandidate(
	messageText: string,
	chatId: string,
	sourceMessageId: string,
	workspaceId: string,
	envelope: SealedEnvelope,
	contactId?: string,
): Promise<DealCandidate | null> {
	if (!messageText || messageText.trim().length === 0) return null;

	// Step 1: Extract structured deal data via Gemini Flash
	let extraction: GeminiExtractionResult;
	try {
		const responseText = await inferWithGemini({
			systemPrompt: EXTRACTION_SYSTEM_PROMPT,
			userPrompt: messageText.trim(),
		});

		const cleaned = responseText.replace(/```json\n?|\n?```/g, '').trim();
		const parsed = JSON.parse(cleaned);

		if (!isValidExtraction(parsed)) {
			console.log('[deal-extraction] Invalid extraction shape from Gemini');
			return null;
		}

		extraction = {
			dealTitleGuess: String(parsed.dealTitleGuess).slice(0, 200),
			dealTypeGuess: normalizeDealType(parsed.dealTypeGuess),
			confidence: Math.max(0, Math.min(1, parsed.confidence)),
			signals: normalizeSignals(parsed.signals),
		};
	} catch {
		console.log('[deal-extraction] Failed to parse Gemini JSON response');
		return null;
	}

	// Step 2: Skip if confidence is 0
	if (extraction.confidence <= 0) return null;

	// Step 3: Build signals array for DAL
	const signalsForDb = extraction.signals.map((text) => ({ text, tier: 1 }));

	// Step 4: Check for duplicates (requires contactId)
	if (contactId) {
		try {
			const isDupe = await isDuplicateCandidate(workspaceId, contactId, signalsForDb);
			if (isDupe) {
				console.log('[deal-extraction] Duplicate candidate detected, skipping');
				return null;
			}
		} catch (err) {
			console.warn('[deal-extraction] Dedup check failed, proceeding with insert', err);
		}
	}

	// Step 5: Store via DAL
	try {
		const candidate = await createDealCandidate(
			workspaceId,
			{
				sourceMessageId,
				chatId,
				confidence: extraction.confidence,
				contactId,
				dealTitleGuess: extraction.dealTitleGuess,
				dealTypeGuess: extraction.dealTypeGuess,
				signals: signalsForDb,
			},
			envelope,
		);

		console.log(
			`[deal-extraction] Created deal candidate (confidence=${extraction.confidence.toFixed(2)}, type=${extraction.dealTypeGuess})`,
		);
		return candidate;
	} catch (err) {
		console.error('[deal-extraction] Failed to create deal candidate:', (err as Error).message);
		return null;
	}
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

const VALID_DEAL_TYPES = new Set([
	'saft',
	'equity',
	'token_warrant',
	'convertible_note',
	'advisory',
	'unknown',
]);

function isValidExtraction(parsed: unknown): parsed is GeminiExtractionResult {
	if (typeof parsed !== 'object' || parsed === null) return false;
	const obj = parsed as Record<string, unknown>;
	return (
		typeof obj.dealTitleGuess === 'string' &&
		typeof obj.dealTypeGuess === 'string' &&
		typeof obj.confidence === 'number' &&
		Array.isArray(obj.signals)
	);
}

function normalizeDealType(raw: string): string {
	const lower = raw.toLowerCase().replace(/\s+/g, '_');
	return VALID_DEAL_TYPES.has(lower) ? lower : 'unknown';
}

function normalizeSignals(raw: unknown[]): string[] {
	return raw
		.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
		.map((s) => s.trim().slice(0, 500))
		.slice(0, 5);
}
