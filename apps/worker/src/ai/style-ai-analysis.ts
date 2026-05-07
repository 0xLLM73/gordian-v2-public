/**
 * AI-powered style analysis — called by the style-analysis worker
 * after deterministic feature extraction, gated behind voice_profile_ai flag.
 *
 * All input messages MUST be ELM-masked before reaching these functions.
 *
 * Coeus owns the implementation — Eris owns the pipeline integration.
 */

import { inferWithGemini } from './gemini-inference';
import type { StyleFeatures } from './style-analysis';

export interface CategoryStyleAnalysis {
	category: string;
	formality: number;
	structure: string;
	vocabulary: string;
	openers: string;
	tone: string;
	summary: string;
}

export interface SynthesizedProfile {
	overallSummary: string;
	codeSwitchingSummary: string | null;
	configRecommendations: Record<string, string>;
}

// ── Allowlists for config recommendation validation ────────────────

const ALLOWED_TONES = new Set(['casual', 'professional', 'warm', 'terse', 'direct']);
const ALLOWED_OUTREACH = new Set(['proactive', 'reactive', 'balanced']);
const ALLOWED_NOTIFICATION = new Set(['minimal', 'standard', 'comprehensive']);

const RECOMMENDATION_ALLOWLISTS: Record<string, Set<string>> = {
	communicationTone: ALLOWED_TONES,
	outreachStyle: ALLOWED_OUTREACH,
	notificationStyle: ALLOWED_NOTIFICATION,
};

// ── Helpers ────────────────────────────────────────────────────────

const MAX_SAMPLES = 15;

/** Strip angle brackets, curly braces, and cap length */
function sanitizeString(s: string, max = 300): string {
	return s
		.replace(/[<>{}/]/g, '')
		.slice(0, max)
		.trim();
}

/** Parse JSON from raw LLM output — handles markdown code blocks */
function parseJsonResponse(raw: string): unknown {
	// Try direct parse first
	try {
		return JSON.parse(raw);
	} catch {
		// Try extracting from markdown code block
		const match = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
		if (match?.[1]) {
			return JSON.parse(match[1]);
		}
		throw new Error('Could not parse JSON from response');
	}
}

// ── analyzeStylePerCategory ────────────────────────────────────────

/**
 * Analyze ELM-masked message samples for a specific contact category.
 * Uses Gemini Flash with structured JSON output.
 */
export async function analyzeStylePerCategory(
	stats: StyleFeatures,
	maskedSamples: string[],
	category: string,
): Promise<CategoryStyleAnalysis> {
	const samples = maskedSamples.slice(0, MAX_SAMPLES);
	const numbered = samples.map((m, i) => `${i + 1}. ${m}`).join('\n');

	const systemPrompt = `You are a communication style analyst for a VC/crypto relationship platform. Analyze the user's outgoing message samples and numeric style features to describe their writing style for this contact category.

Return a JSON object with these fields:
- formality (1-10, where 1=very informal, 10=very formal)
- structure (string: how they organize messages — short bursts, paragraphs, etc.)
- vocabulary (string: jargon level, abbreviation usage, technical terms)
- openers (string: how they typically start messages)
- tone (string: overall emotional quality)
- summary (string: 1-2 sentence overall style description)

Return ONLY valid JSON, no markdown.`;

	const userPrompt = `Category: ${category}

Numeric features:
- Avg word count: ${stats.avgWordCount}
- Contraction rate: ${stats.contractionRate}
- Emoji rate: ${stats.emojiRate}
- Exclamation rate: ${stats.exclamationRate}
- Greeting rate: ${stats.greetingRate}
- Slang rate: ${stats.slangRate}
- Filler word rate: ${stats.fillerWordRate}

Sample messages:
${numbered}`;

	try {
		const raw = await inferWithGemini({ systemPrompt, userPrompt });
		const parsed = parseJsonResponse(raw) as Record<string, unknown>;

		const formality = Math.min(10, Math.max(1, Number(parsed.formality) || 5));

		return {
			category,
			formality,
			structure: sanitizeString(String(parsed.structure ?? '')),
			vocabulary: sanitizeString(String(parsed.vocabulary ?? '')),
			openers: sanitizeString(String(parsed.openers ?? '')),
			tone: sanitizeString(String(parsed.tone ?? '')),
			summary: sanitizeString(String(parsed.summary ?? ''), 500),
		};
	} catch {
		return {
			category,
			formality: 5,
			structure: 'Analysis failed',
			vocabulary: 'Analysis failed',
			openers: 'Analysis failed',
			tone: 'Analysis failed',
			summary: 'Style analysis failed — using defaults',
		};
	}
}

// ── synthesizeStyleProfile ─────────────────────────────────────────

/**
 * Synthesize per-category analyses into a unified voice profile summary.
 */
export async function synthesizeStyleProfile(
	categoryAnalyses: CategoryStyleAnalysis[],
	stats: StyleFeatures,
): Promise<SynthesizedProfile> {
	const categorySummaries = categoryAnalyses
		.map((a) => `[${a.category}] formality=${a.formality}, tone=${a.tone}, summary=${a.summary}`)
		.join('\n');

	const systemPrompt = `You are a communication profile synthesizer for a VC/crypto relationship platform. Given per-category style analyses and numeric features, produce a unified voice profile.

Return a JSON object with:
- overallSummary (string): 1-3 sentence description of overall communication style
- codeSwitchingSummary (string or null): how style varies across categories, null if only one category
- configRecommendations (object): suggested platform settings:
  - communicationTone: one of "casual", "professional", "warm", "terse", "direct"
  - outreachStyle: one of "proactive", "reactive", "balanced"
  - notificationStyle: one of "minimal", "standard", "comprehensive"

Return ONLY valid JSON, no markdown.`;

	const userPrompt = `Per-category analyses:
${categorySummaries || '(no category analyses available)'}

Numeric features:
- Avg word count: ${stats.avgWordCount}
- Contraction rate: ${stats.contractionRate}
- Emoji rate: ${stats.emojiRate}
- Greeting rate: ${stats.greetingRate}
- Slang rate: ${stats.slangRate}`;

	try {
		const raw = await inferWithGemini({ systemPrompt, userPrompt });
		const parsed = parseJsonResponse(raw) as Record<string, unknown>;

		const overallSummary = sanitizeString(String(parsed.overallSummary ?? ''), 500);
		const codeSwitchingSummary = parsed.codeSwitchingSummary
			? sanitizeString(String(parsed.codeSwitchingSummary), 500)
			: null;

		// Validate config recommendations against allowlists
		const rawRecs = (parsed.configRecommendations ?? {}) as Record<string, string>;
		const configRecommendations: Record<string, string> = {};
		for (const [key, allowlist] of Object.entries(RECOMMENDATION_ALLOWLISTS)) {
			const value = rawRecs[key];
			if (value && allowlist.has(value)) {
				configRecommendations[key] = value;
			}
		}

		return { overallSummary, codeSwitchingSummary, configRecommendations };
	} catch {
		return {
			overallSummary: 'Style synthesis failed — using defaults',
			codeSwitchingSummary: null,
			configRecommendations: {},
		};
	}
}
