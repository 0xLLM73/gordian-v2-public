#!/usr/bin/env node

import { loadRootEnv } from './lib/load-root-env.mjs';

loadRootEnv();

const EXPECTED_DIMENSIONS = 512;
const DEFAULT_LOCAL_BASE_URL = 'http://localhost:11434/v1';
const DEFAULT_NOMIC_EMBEDDING_MODEL = 'nomic-embed-text';
const DEFAULT_LOCAL_CHAT_MODEL = 'gemma4:12b-it-q4_K_M';
const DEFAULT_NATIVE_CHAT_BASE_URL = 'http://localhost:11434';
const DEFAULT_LOCAL_ROLE_CHAT_MODEL = 'gemma4:12b-it-q4_K_M';

function envValue(key) {
	const value = process.env[key]?.trim();
	return value && value.length > 0 ? value : undefined;
}

function normalizeBaseUrl(value) {
	return value.replace(/\/+$/, '');
}

function endpoint(baseUrl, path) {
	return `${normalizeBaseUrl(baseUrl)}${path}`;
}

function ollamaChatEndpoint(baseUrl) {
	const parsed = new URL(baseUrl);
	return `${parsed.origin}/api/chat`;
}

function parseChatApi(value, baseUrl) {
	if (value === 'ollama' || value === 'openai-compatible') return value;
	if (value) throw new Error(`Unsupported local chat API "${value}".`);
	try {
		if (new URL(baseUrl).port === '11434') return 'ollama';
	} catch {
		throw new Error(`Could not parse local chat base URL "${baseUrl}".`);
	}
	return 'openai-compatible';
}

function stripJsonFence(text) {
	return text
		.trim()
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/\s*```$/i, '')
		.trim();
}

function parseJsonObject(text) {
	const stripped = stripJsonFence(text);
	const firstBrace = stripped.indexOf('{');
	const lastBrace = stripped.lastIndexOf('}');
	if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
		throw new Error('Local chat smoke returned non-JSON content.');
	}
	return JSON.parse(stripped.slice(firstBrace, lastBrace + 1));
}

function assertLocalMode() {
	const embeddingProvider = envValue('KNOWLEDGE_EMBEDDING_PROVIDER');
	const llmProvider = envValue('KNOWLEDGE_LLM_PROVIDER');
	if (embeddingProvider !== 'local') {
		throw new Error('Set KNOWLEDGE_EMBEDDING_PROVIDER=local before running kg:local:smoke.');
	}
	if (llmProvider !== 'local' && llmProvider !== 'disabled') {
		throw new Error('Set KNOWLEDGE_LLM_PROVIDER=local or disabled before running kg:local:smoke.');
	}
	return llmProvider;
}

function authHeaders(apiKey) {
	const headers = { 'Content-Type': 'application/json' };
	if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
	return headers;
}

async function checkEmbedding() {
	const baseUrl = envValue('KNOWLEDGE_EMBEDDING_BASE_URL') || DEFAULT_LOCAL_BASE_URL;
	const model = envValue('KNOWLEDGE_EMBEDDING_MODEL') || DEFAULT_NOMIC_EMBEDDING_MODEL;
	const apiKey = envValue('KNOWLEDGE_EMBEDDING_API_KEY');
	const response = await fetch(endpoint(baseUrl, '/embeddings'), {
		method: 'POST',
		headers: authHeaders(apiKey),
		body: JSON.stringify({
			model,
			input: ['masked local knowledge graph smoke test'],
			dimensions: EXPECTED_DIMENSIONS,
		}),
	});
	if (!response.ok) {
		throw new Error(`Embedding endpoint failed (${response.status}): ${await response.text()}`);
	}

	const data = await response.json();
	const embedding = data?.data?.[0]?.embedding;
	if (!Array.isArray(embedding))
		throw new Error('Embedding endpoint returned no embedding vector.');
	if (embedding.length !== EXPECTED_DIMENSIONS) {
		throw new Error(
			`Embedding endpoint returned ${embedding.length} dimensions; KG requires ${EXPECTED_DIMENSIONS}. Use the documented Nomic or Qwen setup and confirm your OpenAI-compatible server honors the dimensions request.`,
		);
	}
	console.log(`PASS local embeddings: ${model} returned ${embedding.length} dimensions`);
}

async function checkLlm() {
	const baseUrl = envValue('KNOWLEDGE_LLM_BASE_URL') || DEFAULT_LOCAL_BASE_URL;
	const model = envValue('KNOWLEDGE_LLM_MODEL') || DEFAULT_LOCAL_CHAT_MODEL;
	const apiKey = envValue('KNOWLEDGE_LLM_API_KEY');
	const response = await fetch(endpoint(baseUrl, '/chat/completions'), {
		method: 'POST',
		headers: authHeaders(apiKey),
		body: JSON.stringify({
			model,
			temperature: 0.1,
			response_format: { type: 'json_object' },
			messages: [
				{
					role: 'system',
					content:
						'Return only JSON with an entities array. Each entity has name, displayName, type, description, relationshipType, confidence.',
				},
				{
					role: 'user',
					content:
						'Extract one knowledge entity from: We are building Solana infrastructure for DePIN teams.',
				},
			],
		}),
	});
	if (!response.ok)
		throw new Error(`LLM endpoint failed (${response.status}): ${await response.text()}`);

	const data = await response.json();
	const content = data?.choices?.[0]?.message?.content;
	if (!content || typeof content !== 'string') throw new Error('LLM endpoint returned no content.');
	const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim());
	if (!Array.isArray(parsed.entities))
		throw new Error('LLM response did not include entities array.');
	console.log(`PASS local LLM: ${model} returned ${parsed.entities.length} entities`);
}

function collectLocalChatRoles() {
	const commitmentProvider = envValue('COMMITMENT_LLM_PROVIDER') || 'cloud';
	const commitmentApi = envValue('COMMITMENT_LLM_API') || 'ollama';
	const commitmentBaseUrl = envValue('COMMITMENT_LLM_BASE_URL') || DEFAULT_NATIVE_CHAT_BASE_URL;
	const commitmentModel = envValue('COMMITMENT_LLM_MODEL') || DEFAULT_LOCAL_ROLE_CHAT_MODEL;
	const commitmentApiKey = envValue('COMMITMENT_LLM_API_KEY');

	const chatProvider = envValue('CHAT_LLM_PROVIDER') || commitmentProvider;
	const chatApi = envValue('CHAT_LLM_API') || commitmentApi;
	const chatBaseUrl = envValue('CHAT_LLM_BASE_URL') || commitmentBaseUrl;
	const chatModel = envValue('CHAT_LLM_MODEL') || commitmentModel;
	const chatApiKey = envValue('CHAT_LLM_API_KEY') || commitmentApiKey;

	const digestProvider = envValue('DIGEST_LLM_PROVIDER') || chatProvider;
	const digestApi = envValue('DIGEST_LLM_API') || chatApi;
	const digestBaseUrl = envValue('DIGEST_LLM_BASE_URL') || chatBaseUrl;
	const digestModel = envValue('DIGEST_LLM_MODEL') || chatModel;
	const digestApiKey = envValue('DIGEST_LLM_API_KEY') || chatApiKey;

	const roles = [
		{
			api: commitmentApi,
			apiKey: commitmentApiKey,
			baseUrl: commitmentBaseUrl,
			model: commitmentModel,
			provider: commitmentProvider,
			role: 'commitment extraction',
		},
		{
			api: chatApi,
			apiKey: chatApiKey,
			baseUrl: chatBaseUrl,
			model: chatModel,
			provider: chatProvider,
			role: 'chat assistant',
		},
		{
			api: digestApi,
			apiKey: digestApiKey,
			baseUrl: digestBaseUrl,
			model: digestModel,
			provider: digestProvider,
			role: 'digest generation',
		},
	].filter((config) => config.provider === 'local');

	const grouped = new Map();
	for (const config of roles) {
		if (!config.model) throw new Error(`${config.role} is local but has no model configured.`);
		const api = parseChatApi(config.api, config.baseUrl);
		const key = `${api}|${config.baseUrl}|${config.model}|${config.apiKey || ''}`;
		const existing = grouped.get(key);
		if (existing) {
			existing.roles.push(config.role);
		} else {
			grouped.set(key, { ...config, api, roles: [config.role] });
		}
	}
	return [...grouped.values()];
}

async function checkLocalChatModels() {
	const configs = collectLocalChatRoles();
	if (configs.length === 0) {
		console.log('PASS local chat models: no local chat or digest roles configured; skipped');
		return;
	}

	for (const config of configs) {
		const messages = [
			{
				role: 'system',
				content: 'Return only JSON with {"ok":true}.',
			},
			{
				role: 'user',
				content: 'Local private AI smoke test.',
			},
		];
		const response =
			config.api === 'ollama'
				? await fetch(ollamaChatEndpoint(config.baseUrl), {
						method: 'POST',
						headers: authHeaders(config.apiKey),
						body: JSON.stringify({
							model: config.model,
							messages,
							stream: false,
							think: false,
							format: {
								type: 'object',
								properties: { ok: { type: 'boolean' } },
								required: ['ok'],
							},
							options: {
								temperature: 0,
								num_predict: 80,
							},
						}),
					})
				: await fetch(endpoint(config.baseUrl, '/chat/completions'), {
						method: 'POST',
						headers: authHeaders(config.apiKey),
						body: JSON.stringify({
							model: config.model,
							messages,
							temperature: 0,
							max_tokens: 80,
							response_format: { type: 'json_object' },
						}),
					});
		if (!response.ok) {
			throw new Error(
				`Local chat model ${config.model} failed (${response.status}): ${await response.text()}`,
			);
		}

		const data = await response.json();
		const content =
			config.api === 'ollama' ? data?.message?.content : data?.choices?.[0]?.message?.content;
		if (!content || typeof content !== 'string') {
			throw new Error(`Local chat model ${config.model} returned no content.`);
		}
		const parsed = parseJsonObject(content);
		if (parsed.ok !== true) throw new Error(`Local chat model ${config.model} failed JSON smoke.`);
		console.log(`PASS local chat model: ${config.model} handled ${config.roles.join(', ')}`);
	}
}

async function checkModelsEndpoint() {
	const baseUrl = envValue('KNOWLEDGE_EMBEDDING_BASE_URL') || DEFAULT_LOCAL_BASE_URL;
	const apiKey = envValue('KNOWLEDGE_EMBEDDING_API_KEY');
	try {
		const response = await fetch(endpoint(baseUrl, '/models'), {
			headers: authHeaders(apiKey),
		});
		if (!response.ok) {
			console.log(`WARN local models endpoint: /models returned ${response.status}`);
			return;
		}
		const data = await response.json();
		const modelCount = Array.isArray(data?.data) ? data.data.length : 0;
		console.log(`PASS local models endpoint: ${modelCount} model(s) visible`);
	} catch (err) {
		console.log(`WARN local models endpoint: ${err instanceof Error ? err.message : String(err)}`);
	}
}

async function main() {
	const llmProvider = assertLocalMode();
	await checkModelsEndpoint();
	await checkEmbedding();
	if (llmProvider === 'local') {
		await checkLlm();
	} else {
		console.log('PASS local LLM: disabled; skipped JSON extraction smoke');
	}
	await checkLocalChatModels();
	console.log('PASS kg:local:smoke');
}

main().catch((err) => {
	console.error(`FAIL kg:local:smoke: ${err.message}`);
	process.exitCode = 1;
});
