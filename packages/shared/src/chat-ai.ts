import { type EnvLike, assertTrustedLocalAiBaseUrl, openAICompatibleUrl } from './knowledge-ai';

export type ChatLlmProvider = 'cloud' | 'local';
export type ChatLlmMode = 'cloud' | 'local';
export type ChatLlmApi = 'ollama' | 'openai-compatible';
export type ChatLlmConfigSource = 'chat' | 'commitment-fallback' | 'default';
export type DigestLlmProvider = 'cloud' | 'local';
export type DigestLlmMode = 'cloud' | 'local';
export type DigestLlmApi = ChatLlmApi;
export type DigestLlmConfigSource = 'digest' | 'chat-fallback' | 'commitment-fallback' | 'default';

export const DEFAULT_LOCAL_CHAT_LLM_MODEL = 'qwen3.5:4b';
export const DEFAULT_LOCAL_CHAT_LLM_BASE_URL = 'http://localhost:11434';

export interface ChatLlmRuntime {
	provider: ChatLlmProvider;
	mode: ChatLlmMode;
	api?: ChatLlmApi;
	baseUrl?: string;
	chatCompletionsUrl?: string;
	ollamaChatUrl?: string;
	model?: string;
	apiKey?: string;
	label: string;
	source: ChatLlmConfigSource;
}

export interface DigestLlmRuntime {
	provider: DigestLlmProvider;
	mode: DigestLlmMode;
	api?: DigestLlmApi;
	baseUrl?: string;
	chatCompletionsUrl?: string;
	ollamaChatUrl?: string;
	model?: string;
	apiKey?: string;
	label: string;
	source: DigestLlmConfigSource;
}

function envValue(env: EnvLike, key: string): string | undefined {
	const value = env[key]?.trim();
	return value && value.length > 0 ? value : undefined;
}

function normalizeBaseUrl(value: string): string {
	return value.replace(/\/+$/, '');
}

function parseProvider(value: string | undefined, envName = 'CHAT_LLM_PROVIDER'): ChatLlmProvider {
	if (!value) return 'cloud';
	if (value === 'cloud' || value === 'local') return value;
	throw new Error(`Invalid ${envName}="${value}". Expected cloud or local.`);
}

function parseApi(value: string | undefined, baseUrl: string, envName: string): ChatLlmApi {
	if (value === 'ollama' || value === 'openai-compatible') return value;
	if (value)
		throw new Error(`Invalid ${envName}="${value}". Expected ollama or openai-compatible.`);

	try {
		const parsed = new URL(baseUrl);
		if (parsed.port === '11434') return 'ollama';
	} catch {
		// The trusted URL validator below will return the clearer error.
	}

	return 'openai-compatible';
}

function ollamaChatUrl(baseUrl: string): string {
	const parsed = new URL(baseUrl);
	return `${parsed.origin}/api/chat`;
}

function localChatLabel(model: string): string {
	return model.toLowerCase().includes('qwen') ? 'Qwen local chat' : `${model} local chat`;
}

function localDigestLabel(model: string): string {
	return model.toLowerCase().includes('qwen') ? 'Qwen local digest' : `${model} local digest`;
}

function fromLocalConfig<TSource extends string>(params: {
	env: EnvLike;
	source: TSource;
	providerEnv: string;
	apiEnv: string;
	baseUrlEnv: string;
	modelEnv: string;
	apiKeyEnv: string;
	label?: (model: string) => string;
}): Omit<ChatLlmRuntime, 'source'> & { source: TSource } {
	const baseUrl = envValue(params.env, params.baseUrlEnv) || DEFAULT_LOCAL_CHAT_LLM_BASE_URL;
	assertTrustedLocalAiBaseUrl(baseUrl, params.env, params.baseUrlEnv);
	const model = envValue(params.env, params.modelEnv) || DEFAULT_LOCAL_CHAT_LLM_MODEL;
	const api = parseApi(envValue(params.env, params.apiEnv), baseUrl, params.apiEnv);
	return {
		provider: 'local',
		mode: 'local',
		api,
		baseUrl: normalizeBaseUrl(baseUrl),
		chatCompletionsUrl:
			api === 'openai-compatible' ? openAICompatibleUrl(baseUrl, '/chat/completions') : undefined,
		ollamaChatUrl: api === 'ollama' ? ollamaChatUrl(baseUrl) : undefined,
		model,
		apiKey: envValue(params.env, params.apiKeyEnv),
		label: params.label ? params.label(model) : localChatLabel(model),
		source: params.source,
	};
}

function chatProviderIsConfigured(env: EnvLike): boolean {
	return Boolean(
		envValue(env, 'CHAT_LLM_PROVIDER') ||
			envValue(env, 'CHAT_LLM_API') ||
			envValue(env, 'CHAT_LLM_BASE_URL') ||
			envValue(env, 'CHAT_LLM_MODEL') ||
			envValue(env, 'CHAT_LLM_API_KEY'),
	);
}

function digestProviderIsConfigured(env: EnvLike): boolean {
	return Boolean(
		envValue(env, 'DIGEST_LLM_PROVIDER') ||
			envValue(env, 'DIGEST_LLM_API') ||
			envValue(env, 'DIGEST_LLM_BASE_URL') ||
			envValue(env, 'DIGEST_LLM_MODEL') ||
			envValue(env, 'DIGEST_LLM_API_KEY'),
	);
}

export function getChatLlmRuntime(env: EnvLike): ChatLlmRuntime {
	if (chatProviderIsConfigured(env)) {
		const provider = parseProvider(envValue(env, 'CHAT_LLM_PROVIDER'), 'CHAT_LLM_PROVIDER');
		if (provider === 'local') {
			return fromLocalConfig({
				env,
				source: 'chat',
				providerEnv: 'CHAT_LLM_PROVIDER',
				apiEnv: 'CHAT_LLM_API',
				baseUrlEnv: 'CHAT_LLM_BASE_URL',
				modelEnv: 'CHAT_LLM_MODEL',
				apiKeyEnv: 'CHAT_LLM_API_KEY',
			});
		}
		return { provider, mode: 'cloud', label: 'cloud chat', source: 'chat' };
	}

	if (envValue(env, 'COMMITMENT_LLM_PROVIDER') === 'local') {
		return fromLocalConfig({
			env,
			source: 'commitment-fallback',
			providerEnv: 'COMMITMENT_LLM_PROVIDER',
			apiEnv: 'COMMITMENT_LLM_API',
			baseUrlEnv: 'COMMITMENT_LLM_BASE_URL',
			modelEnv: 'COMMITMENT_LLM_MODEL',
			apiKeyEnv: 'COMMITMENT_LLM_API_KEY',
		});
	}

	return { provider: 'cloud', mode: 'cloud', label: 'cloud chat', source: 'default' };
}

export function getDigestLlmRuntime(env: EnvLike): DigestLlmRuntime {
	if (digestProviderIsConfigured(env)) {
		const provider = parseProvider(envValue(env, 'DIGEST_LLM_PROVIDER'), 'DIGEST_LLM_PROVIDER');
		if (provider === 'local') {
			return fromLocalConfig({
				env,
				source: 'digest',
				providerEnv: 'DIGEST_LLM_PROVIDER',
				apiEnv: 'DIGEST_LLM_API',
				baseUrlEnv: 'DIGEST_LLM_BASE_URL',
				modelEnv: 'DIGEST_LLM_MODEL',
				apiKeyEnv: 'DIGEST_LLM_API_KEY',
				label: localDigestLabel,
			});
		}
		return { provider, mode: 'cloud', label: 'cloud digest', source: 'digest' };
	}

	const chat = getChatLlmRuntime(env);
	if (chat.mode === 'local' && chat.model) {
		return {
			...chat,
			label: localDigestLabel(chat.model),
			source: chat.source === 'chat' ? 'chat-fallback' : 'commitment-fallback',
		};
	}

	return { provider: 'cloud', mode: 'cloud', label: 'cloud digest', source: 'default' };
}

export function canRunLocalChat(env: EnvLike = process.env): boolean {
	return getChatLlmRuntime(env).mode === 'local';
}

export function canRunLocalDigest(env: EnvLike = process.env): boolean {
	return getDigestLlmRuntime(env).mode === 'local';
}
