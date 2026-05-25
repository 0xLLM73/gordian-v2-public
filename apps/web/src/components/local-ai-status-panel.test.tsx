import { render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalAiStatusPanel } from './local-ai-status-panel';

vi.stubGlobal('React', React);

describe('LocalAiStatusPanel', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('shows configured Nomic, Llama, and Qwen local model roles', () => {
		vi.stubEnv('KNOWLEDGE_EMBEDDING_PROVIDER', 'local');
		vi.stubEnv('KNOWLEDGE_EMBEDDING_PRESET', 'nomic');
		vi.stubEnv('KNOWLEDGE_EMBEDDING_MODEL', 'nomic-embed-text');
		vi.stubEnv('KNOWLEDGE_EMBEDDING_DIMENSIONS', '512');
		vi.stubEnv('KNOWLEDGE_LLM_PROVIDER', 'local');
		vi.stubEnv('KNOWLEDGE_LLM_MODEL', 'llama3.1:8b');
		vi.stubEnv('CHAT_LLM_PROVIDER', 'local');
		vi.stubEnv('CHAT_LLM_MODEL', 'qwen3.5:9b');

		render(React.createElement(LocalAiStatusPanel));

		expect(screen.getByText('AI search vectors')).toBeTruthy();
		expect(screen.getByText('nomic-embed-text')).toBeTruthy();
		expect(screen.getByText('512 dimensions')).toBeTruthy();
		expect(screen.getByText('Knowledge extraction')).toBeTruthy();
		expect(screen.getByText('llama3.1:8b')).toBeTruthy();
		expect(screen.getByText('Digest generation')).toBeTruthy();
		expect(screen.getByText('Using CHAT_LLM_* fallback')).toBeTruthy();
		expect(screen.getByText('Chat assistant')).toBeTruthy();
		expect(screen.getAllByText('qwen3.5:9b')).toHaveLength(2);
		expect(screen.getByText('Using CHAT_LLM_*')).toBeTruthy();
		expect(
			screen.getByText(
				'Local AI is configured for AI search vectors, Knowledge extraction, Digest generation, Chat assistant; other roles are off.',
			),
		).toBeTruthy();
	});

	it('warns when any model role is configured for cloud AI', () => {
		vi.stubEnv('KNOWLEDGE_EMBEDDING_PROVIDER', 'openai');
		vi.stubEnv('KNOWLEDGE_LLM_PROVIDER', 'local');
		vi.stubEnv('KNOWLEDGE_LLM_MODEL', 'llama3.1:8b');
		vi.stubEnv('CHAT_LLM_PROVIDER', 'local');
		vi.stubEnv('CHAT_LLM_MODEL', 'qwen3.5:9b');

		render(React.createElement(LocalAiStatusPanel));

		expect(screen.getByText('Privacy posture:')).toBeTruthy();
		expect(screen.getByText('Cloud AI is configured for AI search vectors.')).toBeTruthy();
		expect(screen.getByText('OpenAI cloud embeddings')).toBeTruthy();
	});
});
