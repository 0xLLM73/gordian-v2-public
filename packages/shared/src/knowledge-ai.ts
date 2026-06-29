export type EnvLike = Record<string, string | undefined>;

export type KnowledgeEmbeddingProvider = 'openai' | 'local';
export type KnowledgeEmbeddingPreset = 'custom' | 'gemma' | 'nomic' | 'qwen';
export type KnowledgeEmbeddingMode = 'cloud' | 'local';
export type KnowledgeEmbeddingPurpose = 'document' | 'query' | 'dedup';
export type KnowledgeLlmProvider = 'auto' | 'gemini' | 'local' | 'disabled';
export type KnowledgeLlmMode = 'cloud' | 'local' | 'disabled';

export const KNOWLEDGE_EMBEDDING_DIMENSIONS = 512;
export const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_LOCAL_AI_BASE_URL = 'http://localhost:11434/v1';
export const DEFAULT_LOCAL_EMBEDDING_MODEL = 'nomic-embed-text';
export const DEFAULT_LOCAL_LLM_MODEL = 'gemma4:12b-it-q4_K_M';
export const KNOWLEDGE_EMBEDDING_FORMAT_VERSION = 'kg-embedding-format-v1';
export const QWEN_KNOWLEDGE_QUERY_INSTRUCTION =
	'Retrieve relevant knowledge graph entities and contacts.';
export const ALLOW_NONLOCAL_AI_ENDPOINTS_ENV = 'ALLOW_NONLOCAL_AI_ENDPOINTS';

export interface KnowledgeEmbeddingRuntime {
	provider: KnowledgeEmbeddingProvider;
	mode: KnowledgeEmbeddingMode;
	preset: KnowledgeEmbeddingPreset;
	baseUrl: string;
	embeddingsUrl: string;
	model: string;
	dimensions: number;
	apiKey?: string;
	isLocal: boolean;
	label: string;
}

export interface KnowledgeEmbeddingFingerprint {
	provider: KnowledgeEmbeddingProvider;
	mode: KnowledgeEmbeddingMode;
	preset: KnowledgeEmbeddingPreset;
	model: string;
	dimensions: number;
	formatVersion: string;
}

export interface KnowledgeLlmRuntime {
	provider: KnowledgeLlmProvider;
	mode: KnowledgeLlmMode;
	baseUrl?: string;
	chatCompletionsUrl?: string;
	model?: string;
	apiKey?: string;
	label: string;
}

function envValue(env: EnvLike, key: string): string | undefined {
	const value = env[key]?.trim();
	return value && value.length > 0 ? value : undefined;
}

function normalizeBaseUrl(value: string): string {
	return value.replace(/\/+$/, '');
}

function isTrustedLocalAiHostname(hostname: string): boolean {
	const normalized = hostname.toLowerCase();
	if (
		normalized === 'localhost' ||
		normalized === 'host.docker.internal' ||
		normalized === 'gateway.docker.internal' ||
		normalized === '::1' ||
		normalized === '[::1]'
	) {
		return true;
	}

	if (normalized === '0:0:0:0:0:0:0:1') return true;
	if (
		normalized.includes(':') &&
		(normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:'))
	) {
		return true;
	}

	const parts = normalized.split('.').map((part) => Number(part));
	if (
		parts.length !== 4 ||
		parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
	) {
		return false;
	}

	const [first, second] = parts as [number, number, number, number];
	if (first === 127) return true;
	if (first === 10) return true;
	if (first === 172 && second >= 16 && second <= 31) return true;
	if (first === 192 && second === 168) return true;
	if (first === 169 && second === 254) return true;
	return false;
}

export function assertTrustedLocalAiBaseUrl(baseUrl: string, env: EnvLike, envName: string): void {
	if (env[ALLOW_NONLOCAL_AI_ENDPOINTS_ENV] === 'true') return;

	let parsed: URL;
	try {
		parsed = new URL(baseUrl);
	} catch {
		throw new Error(`${envName}="${baseUrl}" is not a valid URL.`);
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new Error(`${envName}="${baseUrl}" must use http or https.`);
	}

	if (isTrustedLocalAiHostname(parsed.hostname)) return;

	throw new Error(
		`${envName}="${baseUrl}" is configured as a local AI endpoint but is not loopback or private. Use localhost/private infrastructure, or set ${ALLOW_NONLOCAL_AI_ENDPOINTS_ENV}=true only if you accept network egress to that endpoint.`,
	);
}

export function openAICompatibleUrl(baseUrl: string, path: string): string {
	const normalizedPath = path.startsWith('/') ? path : `/${path}`;
	return `${normalizeBaseUrl(baseUrl)}${normalizedPath}`;
}

function parseEmbeddingProvider(value?: string): KnowledgeEmbeddingProvider {
	if (!value) return 'openai';
	if (value === 'openai' || value === 'local') return value;
	throw new Error(`Invalid KNOWLEDGE_EMBEDDING_PROVIDER="${value}". Expected openai or local.`);
}

function parseEmbeddingPreset(value?: string): KnowledgeEmbeddingPreset {
	if (!value) return 'custom';
	if (value === 'custom' || value === 'gemma' || value === 'nomic' || value === 'qwen') {
		return value;
	}
	throw new Error(
		`Invalid KNOWLEDGE_EMBEDDING_PRESET="${value}". Expected custom, gemma, nomic, or qwen.`,
	);
}

function inferEmbeddingPreset(
	provider: KnowledgeEmbeddingProvider,
	model: string,
	configuredPreset?: string,
): KnowledgeEmbeddingPreset {
	const parsed = parseEmbeddingPreset(configuredPreset);
	if (parsed !== 'custom') return parsed;
	if (provider !== 'local') return 'custom';

	const normalizedModel = model.toLowerCase();
	if (normalizedModel.includes('nomic')) return 'nomic';
	if (normalizedModel.includes('qwen')) return 'qwen';
	return 'custom';
}

function embeddingLabel(params: {
	provider: KnowledgeEmbeddingProvider;
	preset: KnowledgeEmbeddingPreset;
	model: string;
}): string {
	if (params.provider !== 'local') return 'OpenAI cloud embeddings';
	if (params.preset === 'gemma') return 'Qwen local embeddings for Gemma LLMs';
	if (params.preset === 'nomic') return 'Nomic local embeddings';
	if (params.preset === 'qwen') return 'Qwen local embeddings';
	return `${params.model} local embeddings`;
}

function parseLlmProvider(value?: string): KnowledgeLlmProvider {
	if (!value) return 'auto';
	if (value === 'auto' || value === 'gemini' || value === 'local' || value === 'disabled') {
		return value;
	}
	throw new Error(
		`Invalid KNOWLEDGE_LLM_PROVIDER="${value}". Expected auto, gemini, local, or disabled.`,
	);
}

function parseDimensions(value?: string): number {
	if (!value) return KNOWLEDGE_EMBEDDING_DIMENSIONS;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(
			`Invalid KNOWLEDGE_EMBEDDING_DIMENSIONS="${value}". Expected a positive integer.`,
		);
	}
	return parsed;
}

function assertKnowledgeEmbeddingDimensions(dimensions: number): void {
	if (dimensions !== KNOWLEDGE_EMBEDDING_DIMENSIONS) {
		throw new Error(
			`Knowledge graph embeddings must be ${KNOWLEDGE_EMBEDDING_DIMENSIONS} dimensions to match the database schema; got ${dimensions}.`,
		);
	}
}

export function getKnowledgeEmbeddingRuntime(env: EnvLike): KnowledgeEmbeddingRuntime {
	const provider = parseEmbeddingProvider(envValue(env, 'KNOWLEDGE_EMBEDDING_PROVIDER'));
	const isLocal = provider === 'local';
	const baseUrl =
		envValue(env, 'KNOWLEDGE_EMBEDDING_BASE_URL') ||
		(isLocal ? DEFAULT_LOCAL_AI_BASE_URL : DEFAULT_OPENAI_BASE_URL);
	if (isLocal) {
		assertTrustedLocalAiBaseUrl(baseUrl, env, 'KNOWLEDGE_EMBEDDING_BASE_URL');
	}
	const model =
		envValue(env, 'KNOWLEDGE_EMBEDDING_MODEL') ||
		(isLocal ? DEFAULT_LOCAL_EMBEDDING_MODEL : DEFAULT_OPENAI_EMBEDDING_MODEL);
	const preset = inferEmbeddingPreset(provider, model, envValue(env, 'KNOWLEDGE_EMBEDDING_PRESET'));
	const dimensions = parseDimensions(envValue(env, 'KNOWLEDGE_EMBEDDING_DIMENSIONS'));
	assertKnowledgeEmbeddingDimensions(dimensions);

	return {
		provider,
		mode: isLocal ? 'local' : 'cloud',
		preset,
		baseUrl: normalizeBaseUrl(baseUrl),
		embeddingsUrl: openAICompatibleUrl(baseUrl, '/embeddings'),
		model,
		dimensions,
		apiKey: envValue(env, 'KNOWLEDGE_EMBEDDING_API_KEY'),
		isLocal,
		label: embeddingLabel({ provider, preset, model }),
	};
}

export function formatKnowledgeEmbeddingInput(
	text: string,
	options: {
		purpose: KnowledgeEmbeddingPurpose;
		runtime?: KnowledgeEmbeddingRuntime;
		preset?: KnowledgeEmbeddingPreset;
		provider?: KnowledgeEmbeddingProvider;
	},
): string {
	const provider = options.runtime?.provider ?? options.provider ?? 'local';
	const preset = options.runtime?.preset ?? options.preset ?? 'custom';
	if (provider !== 'local') return text;

	if (preset === 'nomic') {
		const prefix = options.purpose === 'query' ? 'search_query' : 'search_document';
		return `${prefix}: ${text}`;
	}

	if (preset === 'qwen' && options.purpose === 'query') {
		return `Instruct: ${QWEN_KNOWLEDGE_QUERY_INSTRUCTION}\nQuery: ${text}`;
	}

	if (preset === 'gemma' && options.purpose === 'query') {
		return `Instruct: ${QWEN_KNOWLEDGE_QUERY_INSTRUCTION}\nQuery: ${text}`;
	}

	return text;
}

export function getKnowledgeEmbeddingFingerprint(env: EnvLike): KnowledgeEmbeddingFingerprint {
	const runtime = getKnowledgeEmbeddingRuntime(env);
	return knowledgeEmbeddingRuntimeFingerprint(runtime);
}

export function knowledgeEmbeddingRuntimeFingerprint(
	runtime: KnowledgeEmbeddingRuntime,
): KnowledgeEmbeddingFingerprint {
	return {
		provider: runtime.provider,
		mode: runtime.mode,
		preset: runtime.preset,
		model: runtime.model,
		dimensions: runtime.dimensions,
		formatVersion: KNOWLEDGE_EMBEDDING_FORMAT_VERSION,
	};
}

export function knowledgeEmbeddingFingerprintKey(
	fingerprint: KnowledgeEmbeddingFingerprint,
): string {
	return [
		fingerprint.provider,
		fingerprint.mode,
		fingerprint.preset,
		fingerprint.model,
		fingerprint.dimensions,
		fingerprint.formatVersion,
	].join(':');
}

export function getKnowledgeEmbeddingConfiguredFingerprint(env: EnvLike): string | undefined {
	return envValue(env, 'KNOWLEDGE_EMBEDDING_FINGERPRINT');
}

export function getKnowledgeEmbeddingFingerprintWarning(env: EnvLike): string | undefined {
	const configured = getKnowledgeEmbeddingConfiguredFingerprint(env);
	if (!configured) return undefined;

	const expected = knowledgeEmbeddingFingerprintKey(getKnowledgeEmbeddingFingerprint(env));
	if (configured === expected) return undefined;

	return `KNOWLEDGE_EMBEDDING_FINGERPRINT="${configured}" does not match the active embedding runtime "${expected}". Re-embed the knowledge graph before trusting semantic search quality.`;
}

export function getKnowledgeLlmRuntime(env: EnvLike): KnowledgeLlmRuntime {
	const provider = parseLlmProvider(envValue(env, 'KNOWLEDGE_LLM_PROVIDER'));
	if (provider === 'disabled') {
		return { provider, mode: 'disabled', label: 'LLM disabled' };
	}

	if (provider === 'local') {
		const baseUrl = envValue(env, 'KNOWLEDGE_LLM_BASE_URL') || DEFAULT_LOCAL_AI_BASE_URL;
		assertTrustedLocalAiBaseUrl(baseUrl, env, 'KNOWLEDGE_LLM_BASE_URL');
		const model = envValue(env, 'KNOWLEDGE_LLM_MODEL') || DEFAULT_LOCAL_LLM_MODEL;
		return {
			provider,
			mode: 'local',
			baseUrl: normalizeBaseUrl(baseUrl),
			chatCompletionsUrl: openAICompatibleUrl(baseUrl, '/chat/completions'),
			model,
			apiKey: envValue(env, 'KNOWLEDGE_LLM_API_KEY'),
			label: 'local LLM',
		};
	}

	return {
		provider,
		mode: 'cloud',
		label: provider === 'gemini' ? 'Gemini cloud LLM' : 'cloud LLM',
	};
}

export function isKnowledgeLlmEnabled(env: EnvLike): boolean {
	return getKnowledgeLlmRuntime(env).mode !== 'disabled';
}
