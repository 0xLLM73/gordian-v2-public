/**
 * GC2 — Deal Detection Regex Sieve (Layer 1)
 *
 * Scans message text for investment deal signals using keyword matching.
 * Tier 1 keywords must appear adjacent to currency/number indicators.
 * Filters out third-person gossip, historical references, and retail crypto noise.
 */

export interface DealSignalResult {
	passed: boolean;
	tier: 1;
	matchedKeywords: string[];
}

// ─── Tier 1 Keywords ─────────────────────────────────────────────────────────

const TIER_1_KEYWORDS = [
	'term sheet',
	'saft',
	'token warrant',
	'valuation',
	'cap table',
	'allocation',
	'vesting',
	'pre-money',
	'post-money',
	'convertible note',
] as const;

// Build a single regex that matches any Tier 1 keyword (case-insensitive)
const TIER_1_PATTERN = new RegExp(
	`\\b(${TIER_1_KEYWORDS.map((kw) => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
	'gi',
);

// ─── Currency / Number Indicators ────────────────────────────────────────────

const CURRENCY_PATTERN =
	/\$[\d,.]+[kmb]?|\d+[\d,.]*\s*(?:usd[ct]?|usdc|usdt|eth|btc|sol)\b|\d+[\d,.]*[kmb]\b|\d+(?:\.\d+)?%/gi;

// ─── False Positive Filters ─────────────────────────────────────────────────

// Third-person gossip / news
const GOSSIP_PATTERNS = [
	/\b(?:i heard|they said|someone told me|apparently|rumor|rumour)\b.*\b(?:raised|funding|round)\b/i,
	/\b(?:according to|sources say|reported|announced)\b/i,
	/\b(?:did you see|did you hear|have you heard)\b/i,
];

// Historical references
const HISTORICAL_PATTERNS = [
	/\b(?:last year|years? ago|back (?:in|when)|used to|we looked at .* (?:last|before))\b/i,
	/\b(?:remember when|that was|it was|they were)\b.*\b(?:ago|back then|previously)\b/i,
];

// Retail crypto noise
const RETAIL_PATTERNS = [
	/\b(?:airdrop|whitelist|degen|aping|moon|lambo|wagmi|ngmi|fomo|fud|shill|pump|dump)\b/i,
	/\b(?:nfa|dyor|diamond hands?|paper hands?|hodl|rekt)\b/i,
];

// ─── Main Detection Function ────────────────────────────────────────────────

/**
 * Detect investment deal signals in a message.
 *
 * A message passes when:
 * 1. At least one Tier 1 keyword is found
 * 2. A currency/number indicator is present in the message
 * 3. No false positive filter triggers
 */
export function detectDealSignals(messageText: string): DealSignalResult {
	const noMatch: DealSignalResult = { passed: false, tier: 1, matchedKeywords: [] };

	if (!messageText || messageText.trim().length === 0) return noMatch;

	const text = messageText.trim();

	// Step 1: Check false positive filters first (cheap, short-circuit)
	for (const pattern of GOSSIP_PATTERNS) {
		if (pattern.test(text)) return noMatch;
	}
	for (const pattern of HISTORICAL_PATTERNS) {
		if (pattern.test(text)) return noMatch;
	}
	for (const pattern of RETAIL_PATTERNS) {
		if (pattern.test(text)) return noMatch;
	}

	// Step 2: Find Tier 1 keyword matches
	const keywordMatches = text.match(TIER_1_PATTERN);
	if (!keywordMatches || keywordMatches.length === 0) return noMatch;

	// Step 3: Check for currency/number indicator
	const hasCurrency = CURRENCY_PATTERN.test(text);
	// Reset lastIndex since we use the 'g' flag
	CURRENCY_PATTERN.lastIndex = 0;

	if (!hasCurrency) return noMatch;

	// Deduplicate matched keywords (case-insensitive)
	const seen = new Set<string>();
	const matchedKeywords: string[] = [];
	for (const kw of keywordMatches) {
		const lower = kw.toLowerCase();
		if (!seen.has(lower)) {
			seen.add(lower);
			matchedKeywords.push(lower);
		}
	}

	return { passed: true, tier: 1, matchedKeywords };
}
