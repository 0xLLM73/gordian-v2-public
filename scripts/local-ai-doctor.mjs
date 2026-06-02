#!/usr/bin/env node

import { LOCAL_KG_MODEL_PRESETS, localKgEmbeddingFingerprintKey } from './lib/local-kg-models.mjs';
import {
	DEFAULT_ENV_PATH,
	canConnectTcp,
	endpointFromUrl,
	envValue,
	parseArgs,
	parseEnvText,
	readEnvText,
} from './lib/telegram-local-mode.mjs';

function printHelp() {
	console.log(`Usage: pnpm local-ai:doctor [options]

Checks local knowledge-graph AI, chat, and digest configuration without modifying files.

Options:
  --env <path>    Env file to inspect. Defaults to .env.local.
  --help          Show this help text.

For live endpoint validation, run pnpm kg:local:smoke.
`);
}

function add(checks, level, name, detail) {
	checks.push({ detail, level, name });
}

function printChecks(checks) {
	for (const check of checks) {
		const label = check.level.toUpperCase().padEnd(4, ' ');
		console.log(`${label} ${check.name}: ${check.detail}`);
	}
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		printHelp();
		return;
	}

	const envPath = args.env || DEFAULT_ENV_PATH;
	const text = readEnvText(envPath);
	if (!text) {
		console.error(`FAIL .env file: ${envPath} does not exist or is empty`);
		process.exitCode = 1;
		return;
	}

	const env = parseEnvText(text);
	const checks = [];
	const embeddingProvider = envValue(env, 'KNOWLEDGE_EMBEDDING_PROVIDER');
	const embeddingPreset = envValue(env, 'KNOWLEDGE_EMBEDDING_PRESET') || 'custom';
	const embeddingModel = envValue(env, 'KNOWLEDGE_EMBEDDING_MODEL');
	const embeddingDimensions = envValue(env, 'KNOWLEDGE_EMBEDDING_DIMENSIONS');
	const embeddingBaseUrl = envValue(env, 'KNOWLEDGE_EMBEDDING_BASE_URL');
	const embeddingFingerprint = envValue(env, 'KNOWLEDGE_EMBEDDING_FINGERPRINT');
	const llmProvider = envValue(env, 'KNOWLEDGE_LLM_PROVIDER');
	const llmModel = envValue(env, 'KNOWLEDGE_LLM_MODEL');
	const commitmentProvider = envValue(env, 'COMMITMENT_LLM_PROVIDER') || 'cloud';
	const commitmentApi = envValue(env, 'COMMITMENT_LLM_API') || 'ollama';
	const commitmentBaseUrl = envValue(env, 'COMMITMENT_LLM_BASE_URL');
	const commitmentModel = envValue(env, 'COMMITMENT_LLM_MODEL');
	const chatProvider = envValue(env, 'CHAT_LLM_PROVIDER') || commitmentProvider;
	const chatApi = envValue(env, 'CHAT_LLM_API') || commitmentApi;
	const chatBaseUrl = envValue(env, 'CHAT_LLM_BASE_URL') || commitmentBaseUrl;
	const chatModel = envValue(env, 'CHAT_LLM_MODEL') || commitmentModel;
	const digestProvider = envValue(env, 'DIGEST_LLM_PROVIDER') || chatProvider;
	const digestApi = envValue(env, 'DIGEST_LLM_API') || chatApi;
	const digestBaseUrl = envValue(env, 'DIGEST_LLM_BASE_URL') || chatBaseUrl;
	const digestModel = envValue(env, 'DIGEST_LLM_MODEL') || chatModel;
	const preset = LOCAL_KG_MODEL_PRESETS[embeddingPreset];
	const expectedFingerprint = localKgEmbeddingFingerprintKey({
		KNOWLEDGE_EMBEDDING_PROVIDER: embeddingProvider || 'local',
		KNOWLEDGE_EMBEDDING_PRESET: embeddingPreset,
		KNOWLEDGE_EMBEDDING_MODEL: embeddingModel,
		KNOWLEDGE_EMBEDDING_DIMENSIONS: embeddingDimensions || '512',
	});

	add(
		checks,
		embeddingProvider === 'local' ? 'pass' : 'fail',
		'KNOWLEDGE_EMBEDDING_PROVIDER',
		embeddingProvider === 'local'
			? 'is local'
			: `expected local, found ${embeddingProvider || 'blank'}`,
	);
	add(
		checks,
		preset ? 'pass' : 'warn',
		'KNOWLEDGE_EMBEDDING_PRESET',
		preset
			? `is ${embeddingPreset}`
			: `is ${embeddingPreset}; supported presets are ${Object.keys(LOCAL_KG_MODEL_PRESETS).join(', ')} or custom`,
	);
	add(
		checks,
		preset && embeddingModel === preset.embeddingModel ? 'pass' : 'warn',
		'KNOWLEDGE_EMBEDDING_MODEL',
		preset && embeddingModel === preset.embeddingModel
			? `is ${preset.embeddingModel}`
			: `is ${embeddingModel || 'blank'}; smoke must confirm it returns 512 dimensions`,
	);
	add(
		checks,
		embeddingDimensions === '512' ? 'pass' : 'fail',
		'KNOWLEDGE_EMBEDDING_DIMENSIONS',
		embeddingDimensions === '512'
			? 'is 512'
			: `expected 512, found ${embeddingDimensions || 'blank'}`,
	);
	const llmProviderOk = llmProvider === 'local' || llmProvider === 'disabled';
	add(
		checks,
		llmProviderOk ? 'pass' : 'fail',
		'KNOWLEDGE_LLM_PROVIDER',
		llmProvider === 'local'
			? 'is local'
			: llmProvider === 'disabled'
				? 'is disabled; vector-only validation will skip JSON extraction'
				: `expected local or disabled, found ${llmProvider || 'blank'}`,
	);
	add(
		checks,
		llmProvider === 'disabled' || llmModel ? 'pass' : 'fail',
		'KNOWLEDGE_LLM_MODEL',
		llmProvider === 'disabled'
			? 'not required while KG LLM extraction is disabled'
			: `is ${llmModel || 'blank'}`,
	);
	const commitmentProviderOk =
		commitmentProvider === 'local' ||
		commitmentProvider === 'disabled' ||
		commitmentProvider === 'cloud';
	add(
		checks,
		commitmentProviderOk ? 'pass' : 'fail',
		'COMMITMENT_LLM_PROVIDER',
		commitmentProvider === 'local'
			? 'is local'
			: commitmentProvider === 'disabled'
				? 'is disabled'
				: commitmentProvider === 'cloud'
					? 'is cloud; requires AI_PROCESSING_ENABLED=true before vendor egress'
					: `expected local, cloud, or disabled; found ${commitmentProvider || 'blank'}`,
	);
	add(
		checks,
		commitmentProvider !== 'local' ||
			commitmentApi === 'ollama' ||
			commitmentApi === 'openai-compatible'
			? 'pass'
			: 'fail',
		'COMMITMENT_LLM_API',
		commitmentProvider === 'local'
			? `is ${commitmentApi || 'blank'}`
			: 'not required while commitment extraction is not local',
	);
	add(
		checks,
		commitmentProvider !== 'local' || commitmentBaseUrl ? 'pass' : 'fail',
		'COMMITMENT_LLM_BASE_URL',
		commitmentProvider === 'local'
			? `is ${commitmentBaseUrl || 'blank'}`
			: 'not required while commitment extraction is not local',
	);
	add(
		checks,
		commitmentProvider !== 'local' || commitmentModel ? 'pass' : 'fail',
		'COMMITMENT_LLM_MODEL',
		commitmentProvider === 'local'
			? `is ${commitmentModel || 'blank'}`
			: 'not required while commitment extraction is not local',
	);
	add(
		checks,
		chatProvider === 'local' || chatProvider === 'cloud' ? 'pass' : 'fail',
		'CHAT_LLM_PROVIDER',
		envValue(env, 'CHAT_LLM_PROVIDER')
			? chatProvider === 'local' || chatProvider === 'cloud'
				? `is ${chatProvider}`
				: `expected local or cloud, found ${chatProvider}`
			: `falls back to ${commitmentProvider === 'local' ? 'COMMITMENT_LLM_PROVIDER=local' : 'cloud chat'}`,
	);
	add(
		checks,
		chatProvider !== 'local' || chatApi === 'ollama' || chatApi === 'openai-compatible'
			? 'pass'
			: 'fail',
		'CHAT_LLM_API',
		chatProvider === 'local' ? `is ${chatApi || 'blank'}` : 'not required while chat is not local',
	);
	add(
		checks,
		chatProvider !== 'local' || chatBaseUrl ? 'pass' : 'fail',
		'CHAT_LLM_BASE_URL',
		chatProvider === 'local'
			? `is ${chatBaseUrl || 'blank'}`
			: 'not required while chat is not local',
	);
	add(
		checks,
		chatProvider !== 'local' || chatModel ? 'pass' : 'fail',
		'CHAT_LLM_MODEL',
		chatProvider === 'local'
			? `is ${chatModel || 'blank'}`
			: 'not required while chat is not local',
	);
	add(
		checks,
		digestProvider === 'local' ? 'pass' : 'fail',
		'DIGEST_LLM_PROVIDER',
		envValue(env, 'DIGEST_LLM_PROVIDER')
			? digestProvider === 'local'
				? 'is local'
				: `expected local for private digest generation, found ${digestProvider}`
			: `falls back to ${chatProvider === 'local' ? 'CHAT_LLM_PROVIDER=local' : 'cloud digest'}`,
	);
	add(
		checks,
		digestProvider !== 'local' || digestApi === 'ollama' || digestApi === 'openai-compatible'
			? 'pass'
			: 'fail',
		'DIGEST_LLM_API',
		digestProvider === 'local' ? `is ${digestApi || 'blank'}` : 'not local',
	);
	add(
		checks,
		digestProvider !== 'local' || digestBaseUrl ? 'pass' : 'fail',
		'DIGEST_LLM_BASE_URL',
		digestProvider === 'local'
			? envValue(env, 'DIGEST_LLM_BASE_URL')
				? `is ${digestBaseUrl || 'blank'}`
				: `falls back to ${chatProvider === 'local' ? 'CHAT_LLM_BASE_URL' : 'blank'}`
			: 'not local',
	);
	add(
		checks,
		digestProvider !== 'local' || digestModel ? 'pass' : 'fail',
		'DIGEST_LLM_MODEL',
		digestProvider === 'local'
			? envValue(env, 'DIGEST_LLM_MODEL')
				? `is ${digestModel || 'blank'}`
				: `falls back to ${chatProvider === 'local' ? 'CHAT_LLM_MODEL' : 'blank'}`
			: 'not local',
	);
	add(
		checks,
		embeddingFingerprint === expectedFingerprint ? 'pass' : 'warn',
		'KNOWLEDGE_EMBEDDING_FINGERPRINT',
		embeddingFingerprint === expectedFingerprint
			? 'matches active embedding runtime'
			: embeddingFingerprint
				? `is ${embeddingFingerprint}; expected ${expectedFingerprint}. Re-embed the KG after switching embedding models.`
				: `missing; run pnpm local-ai:setup -- --preset ${preset?.name ?? 'nomic'} to record model compatibility`,
	);

	try {
		const endpoint = endpointFromUrl(embeddingBaseUrl || 'http://localhost:11434/v1', 11434);
		const reachable = await canConnectTcp(endpoint.host, endpoint.port);
		add(
			checks,
			reachable ? 'pass' : 'fail',
			'Local AI TCP',
			reachable
				? `reachable at ${endpoint.host}:${endpoint.port}`
				: `not reachable at ${endpoint.host}:${endpoint.port}; start Ollama`,
		);
	} catch {
		add(checks, 'fail', 'KNOWLEDGE_EMBEDDING_BASE_URL', 'could not parse local endpoint URL');
	}

	console.log(`Local KG AI doctor (${envPath})`);
	printChecks(checks);
	const failures = checks.filter((check) => check.level === 'fail').length;
	const warnings = checks.filter((check) => check.level === 'warn').length;
	console.log(`Summary: ${failures} failure(s), ${warnings} warning(s)`);

	if (failures > 0) {
		console.log('Fix failures, then run pnpm kg:local:smoke for live endpoint validation.');
		process.exitCode = 1;
	} else {
		console.log('Local KG AI env shape is ready. Next: pnpm kg:local:smoke');
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
