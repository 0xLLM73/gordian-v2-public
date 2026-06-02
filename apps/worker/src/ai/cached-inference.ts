import Anthropic from '@anthropic-ai/sdk';
import { assertAiProcessingEnabled, getHeliconeApiKey, isHeliconeEnabled } from '@repo/shared';

/**
 * Prompt Caching Strategy — Inverted Pyramid Architecture (Phase 6).
 *
 * 4-layer system to maximize Anthropic prompt cache hits:
 *   Layer 1: System Kernel (static instructions) — cache_control breakpoint 1
 *   Layer 2: Golden Library (semi-static examples) — cache_control breakpoint 2
 *   Layer 3: Domain knowledge (semi-static, no cache control)
 *   Layer 4: User context (dynamic, in messages array)
 *
 * Cache TTL is 1 hour (set via cache_control.ttl on Layers 1 and 2).
 */

// Lazy-initialized client — avoids ESM hoisting issue where module-level
// `new Anthropic()` runs before dotenv injects ANTHROPIC_API_KEY in dev.
let _anthropic: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
	if (!_anthropic) {
		const heliconeApiKey = getHeliconeApiKey();
		_anthropic = new Anthropic({
			// Route through Helicone only when explicitly enabled.
			baseURL: heliconeApiKey ? 'https://anthropic.helicone.ai' : undefined,
			defaultHeaders: heliconeApiKey ? { 'Helicone-Auth': `Bearer ${heliconeApiKey}` } : undefined,
		});
	}
	return _anthropic;
}

const MODEL = 'claude-sonnet-4-6';

/** Per-request Helicone metadata for cost attribution (followup9). */
export interface HeliconeMetadata {
	/** Feature name (e.g., "commitment-extraction", "morning-brief") */
	feature: string;
	/** Bandit arm / prompt variant name (if applicable) */
	banditArm?: string;
	/** Explicit request ID (e.g., bandit traceId) so feedback can reference it directly */
	requestId?: string;
	/** Model tier for cost attribution (P4 smart routing: "haiku" | "sonnet") */
	modelTier?: string;
}

/**
 * Build Helicone custom property headers for per-request attribution.
 * Returns empty object if Helicone is not configured.
 */
export function getHeliconeHeaders(meta: HeliconeMetadata): Record<string, string> {
	if (!isHeliconeEnabled()) return {};
	return {
		'Helicone-Property-Feature': meta.feature,
		'Helicone-Property-Prompt-Version': process.env.PROMPT_VERSION ?? 'v1',
		...(meta.banditArm ? { 'Helicone-Property-Bandit-Arm': meta.banditArm } : {}),
		...(meta.requestId ? { 'Helicone-Request-Id': meta.requestId } : {}),
		...(meta.modelTier ? { 'Helicone-Property-Model-Tier': meta.modelTier } : {}),
	};
}

export interface CacheInferenceOptions {
	maxTokens?: number;
	temperature?: number;
	tools?: Anthropic.Messages.Tool[];
	toolChoice?: Anthropic.Messages.MessageCreateParams['tool_choice'];
	/** Override the default model (e.g., use Haiku for cheaper extraction tasks) */
	model?: string;
	/** Helicone metadata for cost attribution (only sent if HELICONE_API_KEY is set) */
	helicone?: HeliconeMetadata;
}

/**
 * Invoke Claude with the 4-layer inverted pyramid prompt structure.
 * Layers 1 and 2 get cache_control breakpoints for maximum reuse.
 *
 * @param systemKernel   - Static system instructions (Layer 1)
 * @param goldenLibrary  - Semi-static few-shot examples (Layer 2, can be empty string)
 * @param domainKnowledge - Semi-static domain context (Layer 3, can be empty string)
 * @param userMessages   - Dynamic user/assistant message turns (Layer 4)
 */
export async function inferWithCache(
	systemKernel: string,
	goldenLibrary: string,
	domainKnowledge: string,
	userMessages: Anthropic.Messages.MessageParam[],
	options?: CacheInferenceOptions,
): Promise<Anthropic.Messages.Message> {
	assertAiProcessingEnabled('Claude inference');

	// Build system array with cache breakpoints at Layers 1 and 2
	const system: Anthropic.Messages.TextBlockParam[] = [
		{
			type: 'text' as const,
			text: systemKernel,
			cache_control: { type: 'ephemeral' as const, ttl: '1h' as const },
		},
	];

	// Only add golden library layer if non-empty
	if (goldenLibrary.length > 0) {
		system.push({
			type: 'text' as const,
			text: goldenLibrary,
			cache_control: { type: 'ephemeral' as const, ttl: '1h' as const },
		});
	}

	// Layer 3: domain knowledge (no cache control — changes semi-frequently)
	if (domainKnowledge.length > 0) {
		system.push({
			type: 'text' as const,
			text: domainKnowledge,
		});
	}

	const heliconeHeaders = options?.helicone ? getHeliconeHeaders(options.helicone) : {};

	return getAnthropicClient().messages.create(
		{
			model: options?.model ?? MODEL,
			max_tokens: options?.maxTokens ?? 2048,
			temperature: options?.temperature ?? 0.3,
			system,
			messages: userMessages,
			tools: options?.tools,
			tool_choice: options?.toolChoice,
		},
		{ headers: heliconeHeaders },
	);
}

// Lazy-initialized direct client — bypasses Helicone proxy for streaming.
// Helicone may buffer SSE responses; streaming calls use this client instead.
let _anthropicDirect: Anthropic | null = null;
function getDirectClient(): Anthropic {
	if (!_anthropicDirect) {
		_anthropicDirect = new Anthropic();
	}
	return _anthropicDirect;
}

export interface StreamInferenceOptions {
	maxTokens?: number;
	temperature?: number;
	/** Override the default model */
	model?: string;
}

/**
 * Streaming variant of inferWithCache(). Same 4-layer inverted pyramid system
 * prompt construction, but calls client.messages.stream() and returns an
 * async iterable MessageStream.
 *
 * Uses a direct Anthropic client (no Helicone proxy) to avoid SSE buffering.
 * Non-streaming tool iterations still route through Helicone for cost tracking.
 */
export function streamInfer(
	systemKernel: string,
	goldenLibrary: string,
	domainKnowledge: string,
	userMessages: Anthropic.Messages.MessageParam[],
	options?: StreamInferenceOptions,
) {
	assertAiProcessingEnabled('Claude streaming inference');

	const system: Anthropic.Messages.TextBlockParam[] = [
		{
			type: 'text' as const,
			text: systemKernel,
			cache_control: { type: 'ephemeral' as const, ttl: '1h' as const },
		},
	];

	if (goldenLibrary.length > 0) {
		system.push({
			type: 'text' as const,
			text: goldenLibrary,
			cache_control: { type: 'ephemeral' as const, ttl: '1h' as const },
		});
	}

	if (domainKnowledge.length > 0) {
		system.push({
			type: 'text' as const,
			text: domainKnowledge,
		});
	}

	return getDirectClient().messages.stream({
		model: options?.model ?? MODEL,
		max_tokens: options?.maxTokens ?? 2048,
		temperature: options?.temperature ?? 0.3,
		system,
		messages: userMessages,
	});
}
