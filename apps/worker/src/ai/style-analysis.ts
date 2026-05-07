/**
 * Deterministic Style Feature Extraction (~1ms per batch)
 *
 * Analyzes outgoing messages to extract 19 statistical features
 * describing the user's writing style. No LLM, no API calls.
 *
 * Privacy: only numeric aggregates and validated emoji characters stored.
 * No raw text, no n-grams, no phrases.
 */

// ── Emoji ──────────────────────────────────────────────────────────────
const EMOJI_REGEX = /\p{Emoji_Presentation}/gu;
const EMOJI_CHAR_REGEX = /^\p{Emoji_Presentation}$/u;

function isValidEmoji(s: string): boolean {
	return EMOJI_CHAR_REGEX.test(s);
}

// ── Static Dictionaries ────────────────────────────────────────────────

const CONTRACTIONS = new Set([
	"don't",
	"can't",
	"won't",
	"wouldn't",
	"couldn't",
	"shouldn't",
	"isn't",
	"aren't",
	"wasn't",
	"weren't",
	"hasn't",
	"haven't",
	"hadn't",
	"doesn't",
	"didn't",
	"i'm",
	"i've",
	"i'd",
	"i'll",
	"you're",
	"you've",
	"you'd",
	"you'll",
	"he's",
	"she's",
	"it's",
	"we're",
	"we've",
	"we'd",
	"we'll",
	"they're",
	"they've",
	"they'd",
	"they'll",
	"that's",
	"there's",
	"here's",
	"what's",
	"who's",
	"let's",
]);

const SLANG_TOKENS = new Set([
	'lol',
	'tbh',
	'ngl',
	'fr',
	'imo',
	'imho',
	'omg',
	'brb',
	'btw',
	'haha',
	'hahaha',
	'lmao',
	'lmfao',
	'rofl',
	'idk',
	'smh',
	'nah',
	'yep',
	'yup',
	'nope',
	'gonna',
	'wanna',
	'gotta',
	'kinda',
	'sorta',
	'dunno',
	'lemme',
	'gimme',
	'cuz',
	'tho',
	'thx',
	'ty',
	'np',
	'pls',
	'plz',
	'rn',
	'af',
	'ikr',
	'fwiw',
	'iirc',
	'tldr',
	'ftw',
	'fomo',
	'yolo',
	'gg',
	'ez',
	'asap',
	'dm',
	'sus',
	'vibe',
]);

const GREETINGS = new Set([
	'hey',
	'hi',
	'hello',
	'yo',
	'sup',
	"what's up",
	'howdy',
	'morning',
	'afternoon',
	'evening',
]);

const SIGNOFFS = new Set([
	'cheers',
	'best',
	'thanks',
	'regards',
	'talk soon',
	'ttyl',
	'later',
	'bye',
	'peace',
	'take care',
]);

const FILLER_WORDS = new Set([
	'just',
	'like',
	'basically',
	'actually',
	'literally',
	'honestly',
	'really',
	'pretty',
	'kind of',
	'sort of',
	'you know',
	'i mean',
	'right',
	'um',
	'uh',
]);

// ── Types ──────────────────────────────────────────────────────────────

export interface StyleFeatures {
	avgMessageLength: number;
	medianMessageLength: number;
	avgWordCount: number;
	avgSentenceCount: number;
	exclamationRate: number;
	questionRate: number;
	ellipsisRate: number;
	allCapsRate: number;
	emojiRate: number;
	emojiTopN: Array<{ emoji: string; count: number }>;
	contractionRate: number;
	slangRate: number;
	greetingRate: number;
	signoffRate: number;
	questionAskRate: number;
	initiationRate: number;
	avgUniqueWordRatio: number;
	fillerWordRate: number;
	sampleSize: number;
}

// ── Helpers ────────────────────────────────────────────────────────────

function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function countSentences(text: string): number {
	const matches = text.match(/[.!?]+/g);
	return matches ? matches.length : text.trim().length > 0 ? 1 : 0;
}

function isAllCaps(word: string): boolean {
	return word.length >= 2 && word === word.toUpperCase() && /[A-Z]/.test(word);
}

// ── Main Extraction ────────────────────────────────────────────────────

export function extractStyleFeatures(messages: Array<{ content: string }>): StyleFeatures {
	const n = messages.length;

	if (n === 0) {
		return {
			avgMessageLength: 0,
			medianMessageLength: 0,
			avgWordCount: 0,
			avgSentenceCount: 0,
			exclamationRate: 0,
			questionRate: 0,
			ellipsisRate: 0,
			allCapsRate: 0,
			emojiRate: 0,
			emojiTopN: [],
			contractionRate: 0,
			slangRate: 0,
			greetingRate: 0,
			signoffRate: 0,
			questionAskRate: 0,
			initiationRate: 0,
			avgUniqueWordRatio: 0,
			fillerWordRate: 0,
			sampleSize: 0,
		};
	}

	const lengths: number[] = [];
	const wordCounts: number[] = [];
	const sentenceCounts: number[] = [];
	let exclamationCount = 0;
	let questionCount = 0;
	let ellipsisCount = 0;
	let emojiMessageCount = 0;
	let greetingCount = 0;
	let signoffCount = 0;
	let questionAskCount = 0;

	let totalWords = 0;
	let totalContractions = 0;
	let totalSlang = 0;
	let totalAllCaps = 0;
	let totalFillers = 0;
	let totalUniqueRatios = 0;

	const emojiCounter = new Map<string, number>();

	for (const msg of messages) {
		const text = msg.content;
		lengths.push(text.length);

		const words = text.split(/\s+/).filter((w) => w.length > 0);
		const wordCount = words.length;
		wordCounts.push(wordCount);
		totalWords += wordCount;

		sentenceCounts.push(countSentences(text));

		// Punctuation rates (per-message)
		if (/!/.test(text)) exclamationCount++;
		if (/\?/.test(text)) questionCount++;
		if (/\.{3}|…/.test(text)) ellipsisCount++;

		// Emoji detection
		const emojis = text.match(EMOJI_REGEX);
		if (emojis && emojis.length > 0) {
			emojiMessageCount++;
			for (const e of emojis) {
				if (isValidEmoji(e)) {
					emojiCounter.set(e, (emojiCounter.get(e) ?? 0) + 1);
				}
			}
		}

		// Per-word analysis
		const lowerWords = words.map((w) => w.toLowerCase());
		const lowerText = text.toLowerCase();

		for (const w of lowerWords) {
			if (CONTRACTIONS.has(w)) totalContractions++;
			if (SLANG_TOKENS.has(w)) totalSlang++;
			if (isAllCaps(words[lowerWords.indexOf(w)])) totalAllCaps++;
		}

		// Filler words (some are multi-word)
		for (const filler of FILLER_WORDS) {
			if (filler.includes(' ')) {
				// Multi-word filler: count occurrences in lowercase text
				let idx = lowerText.indexOf(filler, 0);
				while (idx !== -1) {
					totalFillers++;
					idx = lowerText.indexOf(filler, idx + filler.length);
				}
			} else {
				for (const w of lowerWords) {
					if (w === filler) totalFillers++;
				}
			}
		}

		// Greeting (first line starts with greeting)
		const firstLine = text.split('\n')[0].toLowerCase().trim();
		for (const g of GREETINGS) {
			if (firstLine.startsWith(g)) {
				greetingCount++;
				break;
			}
		}

		// Signoff (last line contains signoff)
		const lines = text.split('\n').filter((l) => l.trim().length > 0);
		const lastLine = lines.length > 0 ? lines[lines.length - 1].toLowerCase().trim() : '';
		for (const s of SIGNOFFS) {
			if (lastLine.includes(s)) {
				signoffCount++;
				break;
			}
		}

		// Question asking (message ends with ?)
		if (text.trimEnd().endsWith('?')) questionAskCount++;

		// Unique word ratio (type-token ratio)
		if (wordCount > 0) {
			const uniqueWords = new Set(lowerWords);
			totalUniqueRatios += uniqueWords.size / wordCount;
		}
	}

	// Build emojiTopN — validated, max 10
	const emojiTopN = [...emojiCounter.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 10)
		.filter(([emoji]) => isValidEmoji(emoji))
		.map(([emoji, count]) => ({ emoji, count }));

	return {
		avgMessageLength: lengths.reduce((a, b) => a + b, 0) / n,
		medianMessageLength: median(lengths),
		avgWordCount: wordCounts.reduce((a, b) => a + b, 0) / n,
		avgSentenceCount: sentenceCounts.reduce((a, b) => a + b, 0) / n,
		exclamationRate: exclamationCount / n,
		questionRate: questionCount / n,
		ellipsisRate: ellipsisCount / n,
		allCapsRate: totalWords > 0 ? totalAllCaps / totalWords : 0,
		emojiRate: emojiMessageCount / n,
		emojiTopN,
		contractionRate: totalWords > 0 ? totalContractions / totalWords : 0,
		slangRate: totalWords > 0 ? totalSlang / totalWords : 0,
		greetingRate: greetingCount / n,
		signoffRate: signoffCount / n,
		questionAskRate: questionAskCount / n,
		initiationRate: 0, // Requires conversation context (caller provides)
		avgUniqueWordRatio: totalUniqueRatios / n,
		fillerWordRate: totalWords > 0 ? totalFillers / totalWords : 0,
		sampleSize: n,
	};
}
