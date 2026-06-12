import { assertTrustedLocalAiBaseUrl, type EnvLike, openAICompatibleUrl } from './knowledge-ai';

export type CommitmentLlmProvider = 'cloud' | 'local' | 'disabled';
export type CommitmentLlmMode = 'cloud' | 'local' | 'disabled';
export type CommitmentLlmApi = 'ollama' | 'openai-compatible';

export const DEFAULT_LOCAL_COMMITMENT_LLM_MODEL = 'qwen3.5:4b';
export const DEFAULT_LOCAL_COMMITMENT_LLM_BASE_URL = 'http://localhost:11434';

export interface CommitmentLlmRuntime {
	provider: CommitmentLlmProvider;
	mode: CommitmentLlmMode;
	api?: CommitmentLlmApi;
	baseUrl?: string;
	chatCompletionsUrl?: string;
	ollamaChatUrl?: string;
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

function parseCommitmentLlmProvider(value?: string): CommitmentLlmProvider {
	if (!value) return 'cloud';
	if (value === 'cloud' || value === 'local' || value === 'disabled') return value;
	throw new Error(
		`Invalid COMMITMENT_LLM_PROVIDER="${value}". Expected cloud, local, or disabled.`,
	);
}

function parseCommitmentLlmApi(value: string | undefined, baseUrl: string): CommitmentLlmApi {
	if (value === 'ollama' || value === 'openai-compatible') return value;
	if (value) {
		throw new Error(`Invalid COMMITMENT_LLM_API="${value}". Expected ollama or openai-compatible.`);
	}

	try {
		const parsed = new URL(baseUrl);
		if (parsed.port === '11434') return 'ollama';
	} catch {
		// The base URL validator below will return the clearer error.
	}

	return 'openai-compatible';
}

function ollamaChatUrl(baseUrl: string): string {
	const parsed = new URL(baseUrl);
	return `${parsed.origin}/api/chat`;
}

function localCommitmentLabel(model: string): string {
	return model.toLowerCase().includes('qwen')
		? 'Qwen local commitment extraction'
		: `${model} local commitment extraction`;
}

export function getCommitmentLlmRuntime(env: EnvLike): CommitmentLlmRuntime {
	const provider = parseCommitmentLlmProvider(envValue(env, 'COMMITMENT_LLM_PROVIDER'));

	if (provider === 'disabled') {
		return { provider, mode: 'disabled', label: 'commitment extraction disabled' };
	}

	if (provider === 'local') {
		const baseUrl =
			envValue(env, 'COMMITMENT_LLM_BASE_URL') || DEFAULT_LOCAL_COMMITMENT_LLM_BASE_URL;
		assertTrustedLocalAiBaseUrl(baseUrl, env, 'COMMITMENT_LLM_BASE_URL');
		const model = envValue(env, 'COMMITMENT_LLM_MODEL') || DEFAULT_LOCAL_COMMITMENT_LLM_MODEL;
		const api = parseCommitmentLlmApi(envValue(env, 'COMMITMENT_LLM_API'), baseUrl);
		const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
		return {
			provider,
			mode: 'local',
			api,
			baseUrl: normalizedBaseUrl,
			chatCompletionsUrl:
				api === 'openai-compatible' ? openAICompatibleUrl(baseUrl, '/chat/completions') : undefined,
			ollamaChatUrl: api === 'ollama' ? ollamaChatUrl(baseUrl) : undefined,
			model,
			apiKey: envValue(env, 'COMMITMENT_LLM_API_KEY'),
			label: localCommitmentLabel(model),
		};
	}

	return { provider, mode: 'cloud', label: 'Claude cloud commitment extraction' };
}

export function canRunLocalCommitmentExtraction(env: EnvLike = process.env): boolean {
	return getCommitmentLlmRuntime(env).mode === 'local';
}
