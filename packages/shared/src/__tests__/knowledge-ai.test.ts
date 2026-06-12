import { describe, expect, it } from 'vitest';
import {
	assertTrustedLocalAiBaseUrl,
	formatKnowledgeEmbeddingInput,
	getKnowledgeEmbeddingFingerprint,
	getKnowledgeEmbeddingFingerprintWarning,
	getKnowledgeEmbeddingRuntime,
	getKnowledgeLlmRuntime,
	KNOWLEDGE_EMBEDDING_DIMENSIONS,
	knowledgeEmbeddingFingerprintKey,
} from '../knowledge-ai';

describe('knowledge AI runtime config', () => {
	it('defaults to OpenAI-compatible cloud embeddings and cloud LLM mode', () => {
		const embedding = getKnowledgeEmbeddingRuntime({});
		const llm = getKnowledgeLlmRuntime({});

		expect(embedding.provider).toBe('openai');
		expect(embedding.mode).toBe('cloud');
		expect(embedding.preset).toBe('custom');
		expect(embedding.embeddingsUrl).toBe('https://api.openai.com/v1/embeddings');
		expect(embedding.model).toBe('text-embedding-3-small');
		expect(embedding.dimensions).toBe(KNOWLEDGE_EMBEDDING_DIMENSIONS);
		expect(embedding.label).toBe('OpenAI cloud embeddings');
		expect(llm.mode).toBe('cloud');
		expect(llm.label).toBe('cloud LLM');
	});

	it('configures local OpenAI-compatible KG endpoints', () => {
		const embedding = getKnowledgeEmbeddingRuntime({
			KNOWLEDGE_EMBEDDING_BASE_URL: 'http://localhost:11434/v1/',
			KNOWLEDGE_EMBEDDING_MODEL: 'local-embed',
			KNOWLEDGE_EMBEDDING_PROVIDER: 'local',
		});
		const llm = getKnowledgeLlmRuntime({
			KNOWLEDGE_LLM_BASE_URL: 'http://localhost:11434/v1/',
			KNOWLEDGE_LLM_MODEL: 'local-chat',
			KNOWLEDGE_LLM_PROVIDER: 'local',
		});

		expect(embedding.provider).toBe('local');
		expect(embedding.mode).toBe('local');
		expect(embedding.preset).toBe('custom');
		expect(embedding.embeddingsUrl).toBe('http://localhost:11434/v1/embeddings');
		expect(embedding.model).toBe('local-embed');
		expect(llm).toMatchObject({
			provider: 'local',
			mode: 'local',
			chatCompletionsUrl: 'http://localhost:11434/v1/chat/completions',
			model: 'local-chat',
			label: 'local LLM',
		});
	});

	it('rejects remote URLs configured as local AI endpoints unless explicitly allowed', () => {
		expect(() =>
			getKnowledgeEmbeddingRuntime({
				KNOWLEDGE_EMBEDDING_BASE_URL: 'https://models.example.com/v1',
				KNOWLEDGE_EMBEDDING_PROVIDER: 'local',
			}),
		).toThrow(/local AI endpoint/);
		expect(() =>
			getKnowledgeLlmRuntime({
				KNOWLEDGE_LLM_BASE_URL: 'https://models.example.com/v1',
				KNOWLEDGE_LLM_PROVIDER: 'local',
			}),
		).toThrow(/local AI endpoint/);
		expect(() =>
			getKnowledgeEmbeddingRuntime({
				ALLOW_NONLOCAL_AI_ENDPOINTS: 'true',
				KNOWLEDGE_EMBEDDING_BASE_URL: 'https://models.example.com/v1',
				KNOWLEDGE_EMBEDDING_PROVIDER: 'local',
			}),
		).not.toThrow();
	});

	it('allows loopback, docker-host, and private network local AI endpoints', () => {
		for (const baseUrl of [
			'http://127.0.0.1:11434/v1',
			'http://[::1]:11434/v1',
			'http://host.docker.internal:11434/v1',
			'http://10.0.0.2:11434/v1',
			'http://172.16.0.2:11434/v1',
			'http://192.168.1.20:11434/v1',
		]) {
			expect(() => assertTrustedLocalAiBaseUrl(baseUrl, {}, 'TEST_LOCAL_AI_URL')).not.toThrow();
		}
	});

	it('labels Nomic local embeddings from preset or model name', () => {
		const fromPreset = getKnowledgeEmbeddingRuntime({
			KNOWLEDGE_EMBEDDING_MODEL: 'custom-local-model',
			KNOWLEDGE_EMBEDDING_PRESET: 'nomic',
			KNOWLEDGE_EMBEDDING_PROVIDER: 'local',
		});
		const fromModel = getKnowledgeEmbeddingRuntime({
			KNOWLEDGE_EMBEDDING_MODEL: 'nomic-embed-text',
			KNOWLEDGE_EMBEDDING_PROVIDER: 'local',
		});

		expect(fromPreset.preset).toBe('nomic');
		expect(fromPreset.label).toBe('Nomic local embeddings');
		expect(fromModel.preset).toBe('nomic');
		expect(fromModel.label).toBe('Nomic local embeddings');
	});

	it('labels Qwen local embeddings from preset or model name', () => {
		const fromPreset = getKnowledgeEmbeddingRuntime({
			KNOWLEDGE_EMBEDDING_MODEL: 'custom-local-model',
			KNOWLEDGE_EMBEDDING_PRESET: 'qwen',
			KNOWLEDGE_EMBEDDING_PROVIDER: 'local',
		});
		const fromModel = getKnowledgeEmbeddingRuntime({
			KNOWLEDGE_EMBEDDING_MODEL: 'qwen3-embedding:0.6b',
			KNOWLEDGE_EMBEDDING_PROVIDER: 'local',
		});

		expect(fromPreset.preset).toBe('qwen');
		expect(fromPreset.label).toBe('Qwen local embeddings');
		expect(fromModel.preset).toBe('qwen');
		expect(fromModel.label).toBe('Qwen local embeddings');
	});

	it('formats Nomic embedding inputs by retrieval side', () => {
		const runtime = getKnowledgeEmbeddingRuntime({
			KNOWLEDGE_EMBEDDING_PROVIDER: 'local',
			KNOWLEDGE_EMBEDDING_PRESET: 'nomic',
		});

		expect(
			formatKnowledgeEmbeddingInput('Solana DePIN infrastructure', {
				runtime,
				purpose: 'document',
			}),
		).toBe('search_document: Solana DePIN infrastructure');
		expect(
			formatKnowledgeEmbeddingInput('who knows about DePIN?', { runtime, purpose: 'query' }),
		).toBe('search_query: who knows about DePIN?');
		expect(
			formatKnowledgeEmbeddingInput('Solana DePIN infrastructure', { runtime, purpose: 'dedup' }),
		).toBe('search_document: Solana DePIN infrastructure');
	});

	it('formats Qwen query inputs with an instruction and keeps document text raw', () => {
		const runtime = getKnowledgeEmbeddingRuntime({
			KNOWLEDGE_EMBEDDING_PROVIDER: 'local',
			KNOWLEDGE_EMBEDDING_PRESET: 'qwen',
		});

		expect(
			formatKnowledgeEmbeddingInput('Solana DePIN infrastructure', {
				runtime,
				purpose: 'document',
			}),
		).toBe('Solana DePIN infrastructure');
		expect(
			formatKnowledgeEmbeddingInput('who knows about DePIN?', { runtime, purpose: 'query' }),
		).toBe(
			'Instruct: Retrieve relevant knowledge graph entities and contacts.\nQuery: who knows about DePIN?',
		);
	});

	it('keeps cloud embedding inputs raw', () => {
		const runtime = getKnowledgeEmbeddingRuntime({});

		expect(
			formatKnowledgeEmbeddingInput('who knows about DePIN?', { runtime, purpose: 'query' }),
		).toBe('who knows about DePIN?');
	});

	it('builds and compares stable embedding fingerprints', () => {
		const env = {
			KNOWLEDGE_EMBEDDING_PROVIDER: 'local',
			KNOWLEDGE_EMBEDDING_PRESET: 'qwen',
			KNOWLEDGE_EMBEDDING_MODEL: 'qwen3-embedding:0.6b',
		};
		const key = knowledgeEmbeddingFingerprintKey(getKnowledgeEmbeddingFingerprint(env));

		expect(key).toBe('local:local:qwen:qwen3-embedding:0.6b:512:kg-embedding-format-v1');
		expect(
			getKnowledgeEmbeddingFingerprintWarning({
				...env,
				KNOWLEDGE_EMBEDDING_FINGERPRINT: key,
			}),
		).toBeUndefined();
		expect(
			getKnowledgeEmbeddingFingerprintWarning({
				...env,
				KNOWLEDGE_EMBEDDING_FINGERPRINT:
					'local:local:nomic:nomic-embed-text:512:kg-embedding-format-v1',
			}),
		).toMatch(/does not match the active embedding runtime/);
	});

	it('rejects non-512 knowledge embedding dimensions', () => {
		expect(() =>
			getKnowledgeEmbeddingRuntime({
				KNOWLEDGE_EMBEDDING_DIMENSIONS: '768',
				KNOWLEDGE_EMBEDDING_PROVIDER: 'local',
			}),
		).toThrow(/must be 512 dimensions/);
	});
});
