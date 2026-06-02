#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { writePrivateEnvFile } from './lib/env-file.mjs';
import {
	changedEnvKeys,
	chooseInstalledCommitmentModel,
	getLocalKgPreset,
	knownLocalKgPresetNames,
	localKgEnvValues,
} from './lib/local-kg-models.mjs';
import {
	DEFAULT_ENV_PATH,
	parseArgs,
	parseEnvText,
	readEnvText,
	updateEnvText,
} from './lib/telegram-local-mode.mjs';

function printHelp() {
	console.log(`Usage: pnpm local-ai:setup:nomic
       pnpm local-ai:setup:qwen
       pnpm local-ai:setup -- --preset nomic [options]
       pnpm local-ai:setup -- --preset qwen [options]

Configures local knowledge-graph AI against an OpenAI-compatible Ollama embedding endpoint.
The Qwen preset keeps KG chat extraction disabled by default, while configuring
Qwen local commitment extraction through native Ollama chat separately.
Chat uses CHAT_LLM_* and digest generation uses DIGEST_LLM_*; both default to
the same local Qwen model.

Options:
  --preset <name>       Local KG preset. Supported: ${knownLocalKgPresetNames().join(', ')}.
                        Defaults to nomic.
  --env <path>          Env file to update. Defaults to .env.local.
  --base-url <url>      KG OpenAI-compatible base URL. Defaults to http://localhost:11434/v1.
  --embedding-model <m> Override the preset embedding model.
  --llm-model <m>       Enable/override the local KG JSON extraction chat model.
  --commitment-model <m>
                        Enable/override the local commitment extraction chat model.
  --chat-model <m>      Enable/override the local chat assistant model.
  --digest-model <m>    Enable/override the local digest generation model.
  --skip-commitment-llm Do not configure local commitment extraction.
  --ollama-bin <path>   Ollama binary. Defaults to ollama.
  --skip-pull           Do not run "ollama pull" for preset models.
  --skip-smoke          Do not run pnpm kg:local:smoke after writing env.
  --dry-run             Print the keys that would change without writing or pulling.
  --help                Show this help text.

Before running:
  1. Install Ollama from https://ollama.com.
  2. Start Ollama so http://localhost:11434 is reachable.
  3. Run this setup command.
`);
}

function loadBaseEnvText(envPath) {
	const existing = readEnvText(envPath);
	if (existing) return { createdFromExample: false, text: existing };

	const examplePath = path.resolve(process.cwd(), '.env.example');
	if (!fs.existsSync(examplePath)) {
		throw new Error(`${envPath} does not exist and .env.example was not found`);
	}

	return { createdFromExample: true, text: fs.readFileSync(examplePath, 'utf8') };
}

async function runCommand(command, args) {
	await new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			env: process.env,
			stdio: 'inherit',
		});
		child.once('error', reject);
		child.once('exit', (code) => {
			if (code === 0) resolve();
			else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
		});
	});
}

async function captureCommand(command, args) {
	return await new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			env: process.env,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk) => {
			stdout += String(chunk);
		});
		child.stderr.on('data', (chunk) => {
			stderr += String(chunk);
		});
		child.once('error', reject);
		child.once('exit', (code) => {
			if (code === 0) resolve(stdout);
			else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}: ${stderr}`));
		});
	});
}

async function listInstalledOllamaModels(binary) {
	try {
		const stdout = await captureCommand(binary, ['list']);
		return stdout
			.split('\n')
			.slice(1)
			.map((line) => line.trim().split(/\s+/)[0])
			.filter(Boolean);
	} catch {
		return [];
	}
}

async function pullOllamaModel(binary, model) {
	console.log(`Pulling ${model} with ${binary}...`);
	await runCommand(binary, ['pull', model]);
}

async function runSmoke() {
	console.log('Running pnpm kg:local:smoke...');
	await runCommand('pnpm', ['kg:local:smoke']);
}

function ollamaModelsForSetup(updates) {
	return [
		...new Set(
			[
				updates.KNOWLEDGE_EMBEDDING_MODEL,
				updates.KNOWLEDGE_LLM_MODEL,
				updates.COMMITMENT_LLM_MODEL,
				updates.CHAT_LLM_MODEL,
				updates.DIGEST_LLM_MODEL,
			].filter((model) => typeof model === 'string' && model.length > 0),
		),
	];
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		printHelp();
		return;
	}

	const preset = getLocalKgPreset(String(args.preset || 'nomic'));
	const envPath = args.env || DEFAULT_ENV_PATH;
	const { createdFromExample, text } = loadBaseEnvText(envPath);
	const ollamaBin = String(args['ollama-bin'] || 'ollama');
	const updates = localKgEnvValues(preset, {
		baseUrl: args['base-url'],
		embeddingModel: args['embedding-model'],
		llmModel: args['llm-model'],
		commitmentModel: args['commitment-model'],
		chatModel: args['chat-model'],
		digestModel: args['digest-model'],
		skipCommitmentLlm: args['skip-commitment-llm'] === true,
	});
	if (updates.COMMITMENT_LLM_PROVIDER === 'local' && !args['commitment-model']) {
		const installedModels = await listInstalledOllamaModels(ollamaBin);
		const installedCommitmentModel = chooseInstalledCommitmentModel(
			updates.COMMITMENT_LLM_MODEL,
			installedModels,
		);
		if (installedCommitmentModel && installedCommitmentModel !== updates.COMMITMENT_LLM_MODEL) {
			updates.COMMITMENT_LLM_MODEL = installedCommitmentModel;
			if (updates.CHAT_LLM_PROVIDER === 'local' && !args['chat-model']) {
				updates.CHAT_LLM_MODEL = installedCommitmentModel;
			}
			if (updates.DIGEST_LLM_PROVIDER === 'local' && !args['digest-model']) {
				updates.DIGEST_LLM_MODEL = installedCommitmentModel;
			}
		}
	}
	const nextText = updateEnvText(text, updates);
	const changed = changedEnvKeys(text, nextText, parseEnvText);
	const ollamaModels = ollamaModelsForSetup(updates);

	if (args['dry-run']) {
		console.log(`Dry run for ${preset.label} (${envPath})`);
		console.log(
			createdFromExample
				? 'Would create the env file from .env.example.'
				: 'Would update the existing env file.',
		);
		console.log(`Changed keys: ${changed.length > 0 ? changed.join(', ') : 'none'}`);
		console.log(
			args['skip-pull']
				? 'Would skip Ollama model pulls.'
				: `Would pull Ollama models: ${ollamaModels.join(', ')}`,
		);
		console.log(args['skip-smoke'] ? 'Would skip smoke validation.' : 'Would run kg:local:smoke.');
		return;
	}

	writePrivateEnvFile(envPath, nextText);
	for (const [key, value] of Object.entries(updates)) {
		process.env[key] = value;
	}

	console.log(`${createdFromExample ? 'Created' : 'Updated'} ${envPath}`);
	console.log(`Set ${changed.length} local KG model setting(s).`);
	console.log(`Preset: ${preset.label}`);
	console.log(`Embedding model: ${updates.KNOWLEDGE_EMBEDDING_MODEL}`);
	console.log(
		`Knowledge extraction model: ${
			updates.KNOWLEDGE_LLM_PROVIDER === 'local'
				? updates.KNOWLEDGE_LLM_MODEL
				: updates.KNOWLEDGE_LLM_PROVIDER
		}`,
	);
	console.log(
		`Chat model: ${
			updates.CHAT_LLM_PROVIDER === 'local' ? updates.CHAT_LLM_MODEL : updates.CHAT_LLM_PROVIDER
		}`,
	);
	console.log(
		`Digest model: ${
			updates.DIGEST_LLM_PROVIDER === 'local'
				? updates.DIGEST_LLM_MODEL
				: updates.DIGEST_LLM_PROVIDER
		}`,
	);
	console.log(
		`Commitment model: ${
			updates.COMMITMENT_LLM_PROVIDER === 'local'
				? updates.COMMITMENT_LLM_MODEL
				: updates.COMMITMENT_LLM_PROVIDER
		}`,
	);
	console.log(`Base URL: ${updates.KNOWLEDGE_EMBEDDING_BASE_URL}`);
	console.log(`Embedding fingerprint: ${updates.KNOWLEDGE_EMBEDDING_FINGERPRINT}`);

	if (!args['skip-pull']) {
		for (const model of ollamaModels) {
			await pullOllamaModel(ollamaBin, model);
		}
	}

	if (!args['skip-smoke']) {
		await runSmoke();
	}

	console.log(`Local ${preset.name} KG setup is ready.`);
	console.log('Next: restart web and worker processes so they read the updated env.');
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
