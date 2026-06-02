export const LOCAL_KG_MODEL_PRESETS = {
	nomic: {
		name: 'nomic',
		label: 'Nomic local KG',
		baseUrl: 'http://localhost:11434/v1',
		embeddingModel: 'nomic-embed-text',
		embeddingDimensions: '512',
		llmProvider: 'local',
		llmModel: 'llama3.1:8b',
		commitmentLlmProvider: 'local',
		commitmentLlmApi: 'ollama',
		commitmentBaseUrl: 'http://localhost:11434',
		commitmentLlmModel: 'qwen3.5:4b',
		ollamaModels: ['nomic-embed-text', 'llama3.1:8b', 'qwen3.5:4b'],
	},
	qwen: {
		name: 'qwen',
		label: 'Qwen local KG embeddings',
		baseUrl: 'http://localhost:11434/v1',
		embeddingModel: 'qwen3-embedding:0.6b',
		embeddingDimensions: '512',
		llmProvider: 'disabled',
		llmModel: '',
		commitmentLlmProvider: 'local',
		commitmentLlmApi: 'ollama',
		commitmentBaseUrl: 'http://localhost:11434',
		commitmentLlmModel: 'qwen3.5:4b',
		ollamaModels: ['qwen3-embedding:0.6b', 'qwen3.5:4b'],
	},
};

export const KNOWLEDGE_EMBEDDING_FORMAT_VERSION = 'kg-embedding-format-v1';
export const DEFAULT_LOCAL_CHAT_LLM_MODEL = 'qwen3.5:4b';
export const QWEN_COMMITMENT_MODEL_FALLBACKS = [
	'qwen3.5:4b',
	'qwen3.5:9b',
	'qwen3:4b-instruct',
	'qwen3.5:2b',
];

export function knownLocalKgPresetNames() {
	return Object.keys(LOCAL_KG_MODEL_PRESETS);
}

export function getLocalKgPreset(name = 'nomic') {
	const preset = LOCAL_KG_MODEL_PRESETS[name];
	if (!preset) {
		throw new Error(
			`Unknown local KG preset "${name}". Supported presets: ${knownLocalKgPresetNames().join(', ')}`,
		);
	}
	return preset;
}

export function localKgEnvValues(preset, overrides = {}) {
	const baseUrl = overrides.baseUrl || preset.baseUrl;
	const llmModel = overrides.llmModel || preset.llmModel || '';
	const llmProvider = overrides.llmModel ? 'local' : preset.llmProvider || 'local';
	const commitmentLlmProvider = overrides.skipCommitmentLlm
		? 'disabled'
		: overrides.commitmentModel || preset.commitmentLlmModel
			? 'local'
			: preset.commitmentLlmProvider || 'disabled';
	const commitmentLlmModel =
		commitmentLlmProvider === 'local'
			? overrides.commitmentModel || preset.commitmentLlmModel || ''
			: '';
	const chatLlmProvider =
		overrides.chatModel || commitmentLlmProvider === 'local' ? 'local' : 'cloud';
	const chatLlmModel =
		chatLlmProvider === 'local'
			? overrides.chatModel || commitmentLlmModel || DEFAULT_LOCAL_CHAT_LLM_MODEL
			: '';
	const digestLlmProvider =
		overrides.digestModel || chatLlmProvider === 'local' ? 'local' : 'cloud';
	const digestLlmModel =
		digestLlmProvider === 'local'
			? overrides.digestModel || chatLlmModel || commitmentLlmModel || DEFAULT_LOCAL_CHAT_LLM_MODEL
			: '';
	const values = {
		NEXT_PUBLIC_LOCAL_AI_PROCESSING_ENABLED: 'true',
		AI_SEARCH_EMBEDDINGS_ENABLED: 'true',
		KNOWLEDGE_EMBEDDING_PROVIDER: 'local',
		KNOWLEDGE_EMBEDDING_PRESET: preset.name,
		KNOWLEDGE_EMBEDDING_BASE_URL: baseUrl,
		KNOWLEDGE_EMBEDDING_MODEL: overrides.embeddingModel || preset.embeddingModel,
		KNOWLEDGE_EMBEDDING_DIMENSIONS: preset.embeddingDimensions,
		KNOWLEDGE_EMBEDDING_API_KEY: overrides.embeddingApiKey || '',
		KNOWLEDGE_LLM_PROVIDER: llmProvider,
		KNOWLEDGE_LLM_BASE_URL: llmProvider === 'local' ? overrides.llmBaseUrl || baseUrl : '',
		KNOWLEDGE_LLM_MODEL: llmProvider === 'local' ? llmModel : '',
		KNOWLEDGE_LLM_API_KEY: llmProvider === 'local' ? overrides.llmApiKey || '' : '',
		COMMITMENT_CLOUD_AI_ENABLED: commitmentLlmProvider === 'local' ? 'false' : 'true',
		COMMITMENT_LLM_PROVIDER: commitmentLlmProvider,
		COMMITMENT_LLM_API:
			commitmentLlmProvider === 'local' ? preset.commitmentLlmApi || 'ollama' : '',
		COMMITMENT_LLM_BASE_URL:
			commitmentLlmProvider === 'local'
				? overrides.commitmentBaseUrl || preset.commitmentBaseUrl || baseUrl
				: '',
		COMMITMENT_LLM_MODEL: commitmentLlmModel,
		COMMITMENT_LLM_API_KEY:
			commitmentLlmProvider === 'local' ? overrides.commitmentApiKey || '' : '',
		CHAT_LLM_PROVIDER: chatLlmProvider,
		CHAT_LLM_API: chatLlmProvider === 'local' ? preset.commitmentLlmApi || 'ollama' : '',
		CHAT_LLM_BASE_URL:
			chatLlmProvider === 'local'
				? overrides.chatBaseUrl ||
					overrides.commitmentBaseUrl ||
					preset.commitmentBaseUrl ||
					baseUrl
				: '',
		CHAT_LLM_MODEL: chatLlmModel,
		CHAT_LLM_API_KEY:
			chatLlmProvider === 'local' ? overrides.chatApiKey || overrides.commitmentApiKey || '' : '',
		DIGEST_LLM_PROVIDER: digestLlmProvider,
		DIGEST_LLM_API: digestLlmProvider === 'local' ? preset.commitmentLlmApi || 'ollama' : '',
		DIGEST_LLM_BASE_URL:
			digestLlmProvider === 'local'
				? overrides.digestBaseUrl ||
					overrides.chatBaseUrl ||
					overrides.commitmentBaseUrl ||
					preset.commitmentBaseUrl ||
					baseUrl
				: '',
		DIGEST_LLM_MODEL: digestLlmModel,
		DIGEST_LLM_API_KEY:
			digestLlmProvider === 'local'
				? overrides.digestApiKey || overrides.chatApiKey || overrides.commitmentApiKey || ''
				: '',
	};
	values.KNOWLEDGE_EMBEDDING_FINGERPRINT = localKgEmbeddingFingerprintKey(values);
	return values;
}

export function localKgEmbeddingFingerprintKey(values) {
	const provider = values.KNOWLEDGE_EMBEDDING_PROVIDER || 'local';
	const mode = provider === 'local' ? 'local' : 'cloud';
	return [
		provider,
		mode,
		values.KNOWLEDGE_EMBEDDING_PRESET || 'custom',
		values.KNOWLEDGE_EMBEDDING_MODEL || '',
		values.KNOWLEDGE_EMBEDDING_DIMENSIONS || '512',
		KNOWLEDGE_EMBEDDING_FORMAT_VERSION,
	].join(':');
}

export function chooseInstalledCommitmentModel(preferredModel, installedModels = []) {
	const installed = new Set(
		installedModels
			.filter((model) => typeof model === 'string')
			.map((model) => model.trim())
			.filter(Boolean),
	);
	const candidates = [
		preferredModel,
		...QWEN_COMMITMENT_MODEL_FALLBACKS.filter((model) => model !== preferredModel),
	].filter(Boolean);
	return candidates.find((model) => installed.has(model));
}

export function changedEnvKeys(beforeText, afterText, parseEnvText) {
	const beforeEnv = parseEnvText(beforeText);
	const afterEnv = parseEnvText(afterText);
	return [...afterEnv.keys()].filter((key) => beforeEnv.get(key) !== afterEnv.get(key)).sort();
}
