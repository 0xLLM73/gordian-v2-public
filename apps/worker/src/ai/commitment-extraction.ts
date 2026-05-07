import Anthropic from '@anthropic-ai/sdk';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { getGoldenLibrary, getTopPatterns } from '@repo/db';
import { seedBanditPriors, selectPromptVariant } from './bandit';
import { getHeliconeHeaders, inferWithCache } from './cached-inference';
import { checkCommitmentHeuristic } from './commitment-heuristics';

/**
 * Commitment Extraction Pipeline (followup9 + P7 cost optimization):
 *
 * Single-pass Haiku extraction with confidence routing.
 * Sonnet verification pass removed (P7) — Haiku's confidence scores
 * are routed directly:
 * > 0.9: Auto-confirm (status: 'active')
 * 0.4-0.9: Draft mode (status: 'draft', shown in review queue)
 * < 0.4: Discard (logged for analytics only)
 */

// ─── Lazy-initialized Haiku client ───────────────────────────────────────────

let _haiku: Anthropic | null = null;
function getHaikuClient(): Anthropic {
	if (!_haiku) {
		_haiku = new Anthropic({
			baseURL: process.env.HELICONE_API_KEY ? 'https://anthropic.helicone.ai' : undefined,
			defaultHeaders: process.env.HELICONE_API_KEY
				? { 'Helicone-Auth': `Bearer ${process.env.HELICONE_API_KEY}` }
				: undefined,
		});
	}
	return _haiku;
}

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// ─── Tool schemas ────────────────────────────────────────────────────────────

/** Tool schema for Pass 1 — wide net extraction */
const EXTRACT_COMMITMENT_TOOL: Tool = {
	name: 'extract_commitment',
	description:
		'Extracts actionable commitments from the message. Call ONLY if a clear commitment exists.',
	input_schema: {
		type: 'object' as const,
		properties: {
			title: {
				type: 'string',
				description: 'Concise, imperative summary (e.g., "Send Q3 report to Alice")',
			},
			commitment_type: {
				type: 'string',
				enum: ['promise', 'task', 'meeting', 'financial'],
			},
			assignee: {
				type: 'string',
				description: '"user" (CRM owner) or "contact" (chat partner)',
			},
			due_date: {
				type: 'string',
				description: 'ISO8601 date-time or null if vague',
			},
			confidence: {
				type: 'number',
				description: 'Score 0.0-1.0. <0.7 flagged for review.',
			},
			quote: {
				type: 'string',
				description: 'Exact substring that triggered extraction',
			},
			reasoning: {
				type: 'string',
				description: 'Why this is a commitment (for debugging)',
			},
		},
		required: ['title', 'commitment_type', 'assignee', 'confidence', 'quote'],
	},
};

// ─── System kernels ──────────────────────────────────────────────────────────

const EXTRACTION_SYSTEM_KERNEL = `You are a commitment extraction engine for a Telegram CRM.
Extract actionable commitments, promises, tasks, or meeting intents.

Rules:
- Ignore social pleasantries ("We should catch up sometime" = NOT a commitment)
- Map "try" or "maybe" to confidence 0.5-0.6
- Web3 slang: "ape in" = financial commitment, "LFG/WAGMI" = NOT commitments
- Only call extract_commitment if a CLEAR commitment exists`;

/** Pass 1 (Net) — aggressive recall prompt for Haiku */
const PASS1_NET_KERNEL = `You are a commitment detection net for a Telegram CRM.
Your job is to cast a WIDE NET: flag ANYTHING that might be a commitment, promise, task, or meeting intent.

Rules:
- When in doubt, flag it — false positives are OK, false negatives are NOT
- Include soft commitments ("I should probably...", "let me try to...")
- Include implied commitments ("I'll look into it", "will get back to you")
- Map hedged language to confidence 0.4-0.6
- Web3 slang: "ape in" = financial commitment, "LFG/WAGMI" = NOT commitments
- Call extract_commitment for EACH potential commitment you find`;

export interface ExtractedCommitment {
	title: string;
	commitment_type: 'promise' | 'task' | 'meeting' | 'financial';
	assignee: string;
	due_date?: string;
	confidence: number;
	quote: string;
	reasoning?: string;
}

// ─── Non-bandit fallback (unchanged) ─────────────────────────────────────────

export async function extractCommitments(
	messages: Array<{ role: string; content: string; timestamp: string }>,
	referenceTime: string,
): Promise<ExtractedCommitment[]> {
	const domainKnowledge = `Reference time for relative dates: ${referenceTime}`;

	const response = await inferWithCache(
		EXTRACTION_SYSTEM_KERNEL,
		'',
		domainKnowledge,
		[
			{
				role: 'user' as const,
				content: `Conversation transcript:\n${messages
					.map(
						(m) => `[${m.timestamp}] ${m.role === 'user' ? 'CRM Owner' : 'Contact'}: ${m.content}`,
					)
					.join('\n')}\n\nAnalyze this conversation for actionable commitments.`,
			},
		],
		{
			tools: [EXTRACT_COMMITMENT_TOOL],
			helicone: { feature: 'commitment-extraction' },
		},
	);

	return response.content
		.filter((block) => block.type === 'tool_use')
		.map((block) => (block.type === 'tool_use' ? (block.input as ExtractedCommitment) : null))
		.filter((item): item is ExtractedCommitment => item !== null);
}

// ─── Dual-Loop + Bandit extraction ───────────────────────────────────────────

/** Local cache for golden library text (5-min TTL) */
let goldenLibraryCache: { text: string; expiresAt: number } | null = null;
const GOLDEN_CACHE_TTL = 5 * 60 * 1000;

/** Local cache for semantic pattern rules text (5-min TTL) */
let patternRulesCache: { text: string; expiresAt: number } | null = null;
const PATTERN_CACHE_TTL = 5 * 60 * 1000;

async function buildPatternRulesText(): Promise<string> {
	const now = Date.now();
	if (patternRulesCache && patternRulesCache.expiresAt > now) {
		return patternRulesCache.text;
	}

	const patterns = await getTopPatterns('commitment_extraction', 10);
	if (patterns.length === 0) {
		patternRulesCache = { text: '', expiresAt: now + PATTERN_CACHE_TTL };
		return '';
	}

	const rules = patterns
		.map(
			(p, i) => `${i + 1}. ${p.patternText} (confidence: ${(p.confidenceScore ?? 0.5).toFixed(2)})`,
		)
		.join('\n');
	const text = `\n\nLearned correction rules (from past mistakes):\n${rules}`;

	patternRulesCache = { text, expiresAt: now + PATTERN_CACHE_TTL };
	return text;
}

async function buildGoldenLibraryText(workspaceId?: string): Promise<string> {
	const now = Date.now();
	if (goldenLibraryCache && goldenLibraryCache.expiresAt > now) {
		return goldenLibraryCache.text;
	}

	const examples = await getGoldenLibrary('commitment_extraction', 50, workspaceId);
	if (examples.length === 0) {
		goldenLibraryCache = { text: '', expiresAt: now + GOLDEN_CACHE_TTL };
		return '';
	}

	const text = examples
		.map((ex, i) => {
			const corrected = JSON.stringify(ex.correctedOutput, null, 2);
			return `Example ${i + 1}:\nInput: ${ex.inputContext}\nExpected output: ${corrected}\nReasoning: ${ex.correctionReasoning ?? 'N/A'}`;
		})
		.join('\n\n');

	goldenLibraryCache = { text, expiresAt: now + GOLDEN_CACHE_TTL };
	return text;
}

/** Variant modifiers appended to the system kernel */
const EXTRACTION_VARIANT_MODIFIERS: Record<string, string> = {
	extraction_default: '',
	extraction_strict:
		'\n\nBe STRICT: only extract commitments with very clear future obligations. Ignore anything ambiguous, hedged, or past-tense.',
	extraction_lenient:
		'\n\nBe LENIENT: also extract soft commitments like "I should probably..." or "let me try to..." with lower confidence scores (0.5-0.7).',
};

const EXTRACTION_VARIANTS = Object.keys(EXTRACTION_VARIANT_MODIFIERS);

/**
 * Pass 1 (Net) — Haiku casts a wide net for candidate commitments.
 * Higher temperature (0.4) for better recall.
 */
async function runPass1Net(
	transcript: string,
	referenceTime: string,
	variant: string,
): Promise<ExtractedCommitment[]> {
	const modifier = EXTRACTION_VARIANT_MODIFIERS[variant] ?? '';
	const systemPrompt = PASS1_NET_KERNEL + modifier;

	const heliconeHeaders = getHeliconeHeaders({
		feature: 'commitment-extraction-pass1',
		banditArm: variant,
	});

	const response = await getHaikuClient().messages.create(
		{
			model: HAIKU_MODEL,
			max_tokens: 2048,
			temperature: 0.4,
			system: systemPrompt,
			messages: [
				{
					role: 'user',
					content: `Reference time: ${referenceTime}\n\nConversation transcript:\n${transcript}\n\nFlag ALL potential commitments — cast a wide net.`,
				},
			],
			tools: [EXTRACT_COMMITMENT_TOOL],
		},
		{ headers: heliconeHeaders },
	);

	return response.content
		.filter((block) => block.type === 'tool_use')
		.map((block) => (block.type === 'tool_use' ? (block.input as ExtractedCommitment) : null))
		.filter((item): item is ExtractedCommitment => item !== null);
}

export interface BanditExtractionResult {
	commitments: ExtractedCommitment[];
	/** All candidates from Haiku extraction (for feedback signals) */
	candidates: ExtractedCommitment[];
	traceId: string;
	variant: string;
}

export async function extractCommitmentsWithBandit(
	messages: Array<{ role: string; content: string; timestamp: string }>,
	referenceTime: string,
	userId?: string,
	workspaceId?: string,
	options?: { extractionThreshold?: number; commitmentSensitivity?: string },
): Promise<BanditExtractionResult> {
	// 0. Seed bandit priors on first extraction if user has a Coffee Test answer (Feature 4)
	if (options?.commitmentSensitivity) {
		await seedBanditPriors(options.commitmentSensitivity, userId);
	}

	// 1. Select variant via Thompson Sampling
	const { variant, traceId } = await selectPromptVariant(
		'commitment_extraction',
		EXTRACTION_VARIANTS,
		userId,
	);

	// 2. Build golden library + semantic patterns from DB (still used for feedback loop)
	await Promise.all([buildGoldenLibraryText(workspaceId), buildPatternRulesText()]);

	// 3. Build transcript
	const transcript = messages
		.map((m) => `[${m.timestamp}] ${m.role === 'user' ? 'CRM Owner' : 'Contact'}: ${m.content}`)
		.join('\n');

	// P8: Check heuristic patterns before Haiku call (instant, free)
	const lastMessage = messages[messages.length - 1];
	if (lastMessage) {
		const heuristic = checkCommitmentHeuristic(lastMessage.content);
		if (heuristic.matched && heuristic.extractedCommitment) {
			const heuristicCommitment: ExtractedCommitment = {
				title: heuristic.extractedCommitment,
				commitment_type: 'task',
				assignee: 'user',
				confidence: heuristic.confidence,
				quote: heuristic.extractedCommitment,
				reasoning: `Heuristic match: ${heuristic.pattern}`,
			};
			console.log(
				`[extraction-bandit] source=heuristic pattern=${heuristic.pattern} confidence=${heuristic.confidence}`,
			);
			return {
				commitments: [heuristicCommitment],
				candidates: [heuristicCommitment],
				traceId,
				variant,
			};
		}
	}

	// 4. Haiku extraction — confidence routing applied directly (no Sonnet verify)
	console.log(`[extraction-bandit] source=haiku variant=${variant}`);
	const candidates = await runPass1Net(transcript, referenceTime, variant);

	// 5. Confidence routing: discard below extraction threshold (dynamic from Coffee Test)
	const threshold = options?.extractionThreshold ?? 0.4;
	const commitments = candidates.filter((c) => c.confidence >= threshold);

	console.log(
		`[extraction-bandit] variant=${variant} traceId=${traceId} candidates=${candidates.length} accepted=${commitments.length}`,
	);

	return { commitments, candidates, traceId, variant };
}
