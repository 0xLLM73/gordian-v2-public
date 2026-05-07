import { maskEntities } from '@repo/crypto';
import { inferWithCache } from './cached-inference';
import { prefilterEntities } from './prefilter';

export interface TokenMention {
	symbol: string;
	name: string;
	context: string;
	confidence: number;
}

const SYSTEM_PROMPT = `You are a crypto/web3 token mention detector. Given a conversation excerpt, identify any cryptocurrency or token mentions.

Return a JSON array of objects with:
- symbol: The ticker symbol (e.g., "BTC", "ETH", "SOL")
- name: Full token name (e.g., "Bitcoin", "Ethereum", "Solana")
- context: Brief context of how the token was mentioned (1 sentence)
- confidence: 0.0 to 1.0 confidence that this is a genuine token reference (not coincidental)

Only include tokens with confidence >= 0.5. If no tokens are mentioned, return an empty array [].
Common false positives to avoid: "sol" as "solution", "eth" as abbreviation for "ethics", etc.`;

/**
 * Detect cryptocurrency/token mentions in conversation text.
 * Uses inferWithCache for efficient repeated calls.
 * Entity masking applied before sending to LLM (SEC: no raw PII).
 */
export async function detectTokenMentions(
	text: string,
	workspaceSalt?: Buffer,
): Promise<TokenMention[]> {
	if (!text || text.trim().length < 10) return [];

	// Quick keyword pre-filter to avoid unnecessary LLM calls
	if (!hasTokenKeywords(text)) return [];

	// Mask entities before sending to LLM — token symbols survive masking (SEC-102)
	const truncated = text.slice(0, 4000);
	const safeText = workspaceSalt
		? maskEntities(truncated, workspaceSalt, prefilterEntities(truncated)).maskedText
		: truncated;

	const response = await inferWithCache(
		SYSTEM_PROMPT,
		'',
		'',
		[{ role: 'user', content: safeText }],
		{ temperature: 0.1, maxTokens: 256, helicone: { feature: 'token-detection' } },
	);

	try {
		const textContent = response.content[0]?.type === 'text' ? response.content[0].text : '';
		const parsed = JSON.parse(textContent);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(t: TokenMention) => t.symbol && typeof t.symbol === 'string' && t.confidence >= 0.5,
		);
	} catch {
		return [];
	}
}

/** Quick keyword check to avoid calling LLM on irrelevant text */
export function hasTokenKeywords(text: string): boolean {
	const lower = text.toLowerCase();
	const keywords = [
		'btc',
		'eth',
		'sol',
		'bitcoin',
		'ethereum',
		'solana',
		'token',
		'coin',
		'crypto',
		'defi',
		'nft',
		'airdrop',
		'usdc',
		'usdt',
		'dai',
		'matic',
		'polygon',
		'arbitrum',
		'avax',
		'avalanche',
		'dot',
		'polkadot',
		'ada',
		'cardano',
		'doge',
		'shib',
		'link',
		'chainlink',
		'uni',
		'uniswap',
		'ape',
		'pepe',
		'bonk',
		'jup',
		'jupiter',
		'wif',
		'$',
		'market cap',
		'trading',
		'whale',
		'pump',
		'dump',
		'bullish',
		'bearish',
		'hodl',
		'staking',
		'yield',
	];
	return keywords.some((kw) => lower.includes(kw));
}
