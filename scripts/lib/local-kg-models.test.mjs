import { describe, expect, it } from 'vitest';
import {
	chooseInstalledCommitmentModel,
	LOCAL_KG_MODEL_PRESETS,
	localKgEnvValues,
} from './local-kg-models.mjs';

describe('local KG model presets', () => {
	it('keeps Qwen KG embeddings at 512 dimensions while enabling local commitments', () => {
		const values = localKgEnvValues(LOCAL_KG_MODEL_PRESETS.qwen);

		expect(values.KNOWLEDGE_EMBEDDING_MODEL).toBe('qwen3-embedding:0.6b');
		expect(values.KNOWLEDGE_EMBEDDING_DIMENSIONS).toBe('512');
		expect(values.AI_SEARCH_EMBEDDINGS_ENABLED).toBe('true');
		expect(values.COMMITMENT_LLM_PROVIDER).toBe('local');
		expect(values.COMMITMENT_LLM_API).toBe('ollama');
		expect(values.COMMITMENT_CLOUD_AI_ENABLED).toBe('false');
		expect(values.CHAT_LLM_PROVIDER).toBe('local');
		expect(values.CHAT_LLM_API).toBe('ollama');
		expect(values.CHAT_LLM_MODEL).toBe('qwen3.5:4b');
		expect(values.DIGEST_LLM_PROVIDER).toBe('local');
		expect(values.DIGEST_LLM_API).toBe('ollama');
		expect(values.DIGEST_LLM_MODEL).toBe('qwen3.5:4b');
	});

	it('keeps Nomic embeddings while routing chat and digest roles to local Qwen', () => {
		const values = localKgEnvValues(LOCAL_KG_MODEL_PRESETS.nomic);

		expect(values.KNOWLEDGE_EMBEDDING_MODEL).toBe('nomic-embed-text');
		expect(values.KNOWLEDGE_EMBEDDING_DIMENSIONS).toBe('512');
		expect(values.KNOWLEDGE_LLM_PROVIDER).toBe('local');
		expect(values.KNOWLEDGE_LLM_MODEL).toBe('llama3.1:8b');
		expect(values.COMMITMENT_LLM_PROVIDER).toBe('local');
		expect(values.COMMITMENT_LLM_MODEL).toBe('qwen3.5:4b');
		expect(values.CHAT_LLM_PROVIDER).toBe('local');
		expect(values.CHAT_LLM_MODEL).toBe('qwen3.5:4b');
		expect(values.DIGEST_LLM_PROVIDER).toBe('local');
		expect(values.DIGEST_LLM_MODEL).toBe('qwen3.5:4b');
	});

	it('prefers an installed Qwen commitment model before asking setup to pull the preset', () => {
		expect(
			chooseInstalledCommitmentModel('qwen3.5:4b', ['qwen3-embedding:0.6b', 'qwen3.5:2b']),
		).toBe('qwen3.5:2b');
		expect(chooseInstalledCommitmentModel('qwen3.5:4b', ['qwen3.5:9b', 'qwen3:4b-instruct'])).toBe(
			'qwen3.5:9b',
		);
	});
});
