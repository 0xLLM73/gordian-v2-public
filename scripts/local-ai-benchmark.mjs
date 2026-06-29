#!/usr/bin/env node

import { loadRootEnv } from './lib/load-root-env.mjs';
import { knowledgeRelationshipBenchmarkCases } from './lib/local-ai-benchmark-relations.mjs';

loadRootEnv();

const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODELS = ['qwen3.5:9b', 'gemma4:12b-it-q4_K_M'];
const DEFAULT_KEEP_ALIVE = '0';
const DEFAULT_TIMEOUT_MS = 180_000;

function parseArgs(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg.startsWith('--')) continue;
		const key = arg.slice(2);
		const next = argv[i + 1];
		if (!next || next.startsWith('--')) {
			args[key] = true;
		} else {
			args[key] = next;
			i++;
		}
	}
	return args;
}

function printHelp() {
	console.log(`Usage: pnpm local-ai:benchmark [options]

Runs local non-embedding model parity checks against Ollama. This never calls a
cloud provider and does not use real Telegram data.

Options:
  --models <csv>       Models to compare. Defaults to ${DEFAULT_MODELS.join(',')}.
  --cases <csv>        Benchmark case names to run. Defaults to all cases.
  --base-url <url>     Native Ollama base URL. Defaults to ${DEFAULT_BASE_URL}.
  --keep-alive <value> Ollama keep_alive value. Defaults to ${DEFAULT_KEEP_ALIVE}.
  --timeout-ms <n>     Per-request timeout. Defaults to ${DEFAULT_TIMEOUT_MS}.
  --json               Print JSON instead of a table.
  --help               Show this help text.

Relationship benchmark rows include a SAFETY column when available. OK remains
the strict extraction-quality result; SAFETY reports whether confirmed-eligible
relations would be safe to promote.
`);
}

function normalizeBaseUrl(value) {
	return value.replace(/\/+$/, '');
}

function ollamaChatEndpoint(baseUrl) {
	return `${normalizeBaseUrl(baseUrl)}/api/chat`;
}

function stripJsonFence(text) {
	return text
		.trim()
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/\s*```$/i, '')
		.trim();
}

function findJsonSlice(text) {
	const stripped = stripJsonFence(text);
	let inString = false;
	let escaped = false;
	let depth = 0;
	let start = -1;

	for (let i = 0; i < stripped.length; i++) {
		const char = stripped[i];
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (char === '\\') {
				escaped = true;
			} else if (char === '"') {
				inString = false;
			}
			continue;
		}
		if (char === '"') {
			inString = true;
			continue;
		}
		if (char === '{') {
			if (depth === 0) start = i;
			depth++;
			continue;
		}
		if (char === '}' && depth > 0) {
			depth--;
			if (depth === 0 && start >= 0) return stripped.slice(start, i + 1);
		}
	}

	return undefined;
}

function parseJsonObject(text) {
	const slice = findJsonSlice(text);
	if (!slice) throw new Error('response did not contain a JSON object');
	return JSON.parse(slice);
}

function isRecord(input) {
	return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function assertArray(input, name) {
	if (!Array.isArray(input)) throw new Error(`${name} is not an array`);
	return input;
}

function exactQuoteInSource(quote, source) {
	return typeof quote === 'string' && quote.length > 0 && source.includes(quote);
}

function hasOnlySourceIds(ids, allowed) {
	return (
		Array.isArray(ids) &&
		ids.length > 0 &&
		ids.every((id) => typeof id === 'string' && allowed.has(id))
	);
}

function responsePreview(text) {
	return stripJsonFence(text).replace(/\s+/g, ' ').slice(0, 220);
}

const cases = [
	{
		name: 'chat_assistant',
		description: 'Local chat assistant JSON answer',
		maxTokens: 256,
		temperature: 0.2,
		format: {
			type: 'object',
			additionalProperties: false,
			properties: {
				type: { type: 'string', enum: ['answer'] },
				response: { type: 'string' },
			},
			required: ['type', 'response'],
		},
		messages: [
			{
				role: 'system',
				content:
					'You are a local CRM assistant. Return JSON only with {"type":"answer","response":"..."} and never invent facts.',
			},
			{
				role: 'user',
				content:
					'Context: Alice is a founder working on Solana payments. The latest note says she asked for a concise follow-up next week. What should I do next?',
			},
		],
		validate(parsed) {
			if (parsed.type !== 'answer') throw new Error('type is not answer');
			if (typeof parsed.response !== 'string' || parsed.response.length < 20) {
				throw new Error('response is too short');
			}
		},
	},
	{
		name: 'digest_generation',
		description: 'Digest JSON sections',
		maxTokens: 700,
		temperature: 0.2,
		format: {
			type: 'object',
			additionalProperties: false,
			properties: {
				activity_overview: {
					type: 'object',
					additionalProperties: false,
					properties: {
						summary: { type: 'string' },
						message_count: { type: 'number' },
						active_conversations: { type: 'number' },
					},
					required: ['summary', 'message_count', 'active_conversations'],
				},
				highlights: { type: 'array', items: { type: 'string' } },
				action_items: { type: 'array', items: { type: 'string' } },
				watch_list: { type: 'array', items: { type: 'string' } },
			},
			required: ['activity_overview', 'highlights', 'action_items', 'watch_list'],
		},
		messages: [
			{
				role: 'system',
				content:
					'Generate a local CRM digest from the provided masked source messages. Return JSON only.',
			},
			{
				role: 'user',
				content:
					'[m1] Alice: I can review the deck Friday.\n[m2] Ben: Great meeting you at the incubator today.\n[m3] Cara: Send me the Solana payments intro when ready.',
			},
		],
		validate(parsed) {
			if (!isRecord(parsed.activity_overview)) throw new Error('missing activity_overview');
			assertArray(parsed.highlights, 'highlights');
			assertArray(parsed.action_items, 'action_items');
			assertArray(parsed.watch_list, 'watch_list');
		},
	},
	{
		name: 'commitment_extraction',
		description: 'Strict commitment JSON with grounded quote/source ids',
		maxTokens: 700,
		temperature: 0,
		sourceText:
			'[source:m1] Alice: I will send the partner deck tomorrow.\n[source:m2] User: Great, I can review it Friday morning.',
		format: {
			type: 'object',
			additionalProperties: false,
			properties: {
				commitments: {
					type: 'array',
					items: {
						type: 'object',
						additionalProperties: false,
						properties: {
							title: { type: 'string' },
							assignee: { type: 'string' },
							quote: { type: 'string' },
							source_message_ids: { type: 'array', items: { type: 'string' } },
							confidence: { type: 'number' },
						},
						required: ['title', 'assignee', 'quote', 'source_message_ids', 'confidence'],
					},
				},
			},
			required: ['commitments'],
		},
		messagesFor(testCase) {
			return [
				{
					role: 'system',
					content:
						'Extract trackable CRM commitments. Return JSON only. Every quote must be an exact substring from the transcript and every source id must exist.',
				},
				{
					role: 'user',
					content: `Transcript:\n${testCase.sourceText}\n\nReturn commitments.`,
				},
			];
		},
		validate(parsed, testCase) {
			const commitments = assertArray(parsed.commitments, 'commitments');
			if (commitments.length === 0) throw new Error('no commitment found');
			const allowed = new Set(['m1', 'm2']);
			for (const commitment of commitments) {
				if (!exactQuoteInSource(commitment.quote, testCase.sourceText)) {
					throw new Error(`ungrounded quote: ${commitment.quote}`);
				}
				if (!hasOnlySourceIds(commitment.source_message_ids, allowed)) {
					throw new Error('invalid source_message_ids');
				}
			}
		},
	},
	{
		name: 'follow_up_draft',
		description: 'Plain-text follow-up draft',
		maxTokens: 220,
		temperature: 0.6,
		messages: [
			{
				role: 'system',
				content: 'You draft concise Telegram follow-ups. Return only the draft text, no markdown.',
			},
			{
				role: 'user',
				content:
					'Contact summary: Alice is building Solana payment infrastructure. Recent messages: she asked to reconnect after reviewing a partner deck. Draft a warm follow-up.',
			},
		],
		validateText(text) {
			const cleaned = stripJsonFence(text);
			if (cleaned.length < 20) throw new Error('draft is too short');
			if (cleaned.length > 700) throw new Error('draft is too long');
			if (/[{}]/.test(cleaned)) throw new Error('draft looks like JSON instead of text');
		},
	},
	{
		name: 'knowledge_extraction',
		description: 'Knowledge graph entity JSON',
		maxTokens: 600,
		temperature: 0.1,
		format: {
			type: 'object',
			additionalProperties: false,
			properties: {
				entities: {
					type: 'array',
					items: {
						type: 'object',
						additionalProperties: true,
						properties: {
							type: { type: 'string' },
							name: { type: 'string' },
							displayName: { type: 'string' },
							relationshipType: { type: 'string' },
							confidence: { type: 'number' },
							sourceMention: { type: 'string' },
						},
						required: ['type', 'name', 'displayName', 'relationshipType', 'confidence'],
					},
				},
			},
			required: ['entities'],
		},
		messages: [
			{
				role: 'system',
				content:
					'Extract structured knowledge entities from CRM messages. Return JSON only with an entities array.',
			},
			{
				role: 'user',
				content:
					'Messages: Alice said she is building Solana payment rails for DePIN teams and advises founders on stablecoin settlement.',
			},
		],
		validate(parsed) {
			const entities = assertArray(parsed.entities, 'entities');
			if (entities.length === 0) throw new Error('no entities found');
			for (const entity of entities) {
				if (!entity.name || !entity.displayName || !entity.relationshipType) {
					throw new Error('entity missing required label fields');
				}
			}
		},
	},
	{
		name: 'introduction_detection',
		description: 'Introduction candidate JSON',
		maxTokens: 450,
		temperature: 0.1,
		sourceText:
			'[source:m1] User: Alice, meet Ben. Ben runs investor relations at Northstar.\n[source:m2] Alice: Nice to meet you Ben.',
		format: {
			type: 'object',
			additionalProperties: false,
			properties: {
				introductions: {
					type: 'array',
					items: {
						type: 'object',
						additionalProperties: false,
						properties: {
							contact_a: { type: 'string' },
							contact_b: { type: 'string' },
							quote: { type: 'string' },
							source_message_ids: { type: 'array', items: { type: 'string' } },
							confidence: { type: 'number' },
						},
						required: ['contact_a', 'contact_b', 'quote', 'source_message_ids', 'confidence'],
					},
				},
			},
			required: ['introductions'],
		},
		messagesFor(testCase) {
			return [
				{
					role: 'system',
					content:
						'Detect explicit introductions between people. Return JSON only with grounded quotes and source ids.',
				},
				{ role: 'user', content: testCase.sourceText },
			];
		},
		validate(parsed, testCase) {
			const introductions = assertArray(parsed.introductions, 'introductions');
			if (introductions.length === 0) throw new Error('no introduction found');
			const allowed = new Set(['m1', 'm2']);
			for (const intro of introductions) {
				if (!exactQuoteInSource(intro.quote, testCase.sourceText)) {
					throw new Error(`ungrounded quote: ${intro.quote}`);
				}
				if (!hasOnlySourceIds(intro.source_message_ids, allowed)) {
					throw new Error('invalid source_message_ids');
				}
			}
		},
	},
	{
		name: 'new_connection_detection',
		description: 'New connection candidate JSON',
		maxTokens: 420,
		temperature: 0.1,
		sourceText:
			'[source:m1] Ben: Nice to meet you today at the incubator.\n[source:m2] User: Likewise, excited to talk more about payments.',
		format: {
			type: 'object',
			additionalProperties: false,
			properties: {
				connections: {
					type: 'array',
					items: {
						type: 'object',
						additionalProperties: false,
						properties: {
							event: { type: 'string' },
							quote: { type: 'string' },
							source_message_ids: { type: 'array', items: { type: 'string' } },
							confidence: { type: 'number' },
						},
						required: ['event', 'quote', 'source_message_ids', 'confidence'],
					},
				},
			},
			required: ['connections'],
		},
		messagesFor(testCase) {
			return [
				{
					role: 'system',
					content:
						'Detect first-meeting or new-connection signals. Return JSON only with grounded quotes and source ids.',
				},
				{ role: 'user', content: testCase.sourceText },
			];
		},
		validate(parsed, testCase) {
			const connections = assertArray(parsed.connections, 'connections');
			if (connections.length === 0) throw new Error('no connection found');
			const allowed = new Set(['m1', 'm2']);
			for (const connection of connections) {
				if (!exactQuoteInSource(connection.quote, testCase.sourceText)) {
					throw new Error(`ungrounded quote: ${connection.quote}`);
				}
				if (!hasOnlySourceIds(connection.source_message_ids, allowed)) {
					throw new Error('invalid source_message_ids');
				}
			}
		},
	},
	{
		name: 'relationship_health',
		description: 'Relationship health classifier JSON',
		maxTokens: 260,
		temperature: 0,
		format: {
			type: 'object',
			additionalProperties: false,
			properties: {
				health: { type: 'string', enum: ['strong', 'neutral', 'at_risk'] },
				confidence: { type: 'number' },
				reason: { type: 'string' },
			},
			required: ['health', 'confidence', 'reason'],
		},
		messages: [
			{
				role: 'system',
				content: 'Classify CRM relationship health from recent messages. Return JSON only.',
			},
			{
				role: 'user',
				content:
					'Recent thread: Alice replied quickly, asked for the deck, and suggested a follow-up Friday. No unresolved conflict.',
			},
		],
		validate(parsed) {
			if (!['strong', 'neutral', 'at_risk'].includes(parsed.health)) {
				throw new Error('invalid health label');
			}
			if (typeof parsed.confidence !== 'number') throw new Error('missing confidence');
		},
	},
	{
		name: 'deal_brief',
		description: 'Deal local AI JSON brief',
		maxTokens: 420,
		temperature: 0.2,
		format: {
			type: 'object',
			additionalProperties: false,
			properties: {
				summary: { type: 'string' },
				risks: { type: 'array', items: { type: 'string' } },
				next_steps: { type: 'array', items: { type: 'string' } },
			},
			required: ['summary', 'risks', 'next_steps'],
		},
		messages: [
			{
				role: 'system',
				content: 'Create a local-only CRM deal brief from provided context. Return JSON only.',
			},
			{
				role: 'user',
				content:
					'Deal: Northstar pilot. Stage: discovery. Contact asked for pricing and security notes. Risk: unclear budget owner.',
			},
		],
		validate(parsed) {
			if (typeof parsed.summary !== 'string' || parsed.summary.trim().length === 0) {
				throw new Error('summary is empty');
			}
			assertArray(parsed.risks, 'risks');
			assertArray(parsed.next_steps, 'next_steps');
		},
	},
	...knowledgeRelationshipBenchmarkCases,
];

async function fetchWithTimeout(input, init, timeoutMs) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(input, { ...init, signal: controller.signal });
	} catch (error) {
		if (controller.signal.aborted) throw new Error(`timed out after ${timeoutMs}ms`);
		throw error;
	} finally {
		clearTimeout(timeout);
	}
}

async function runCase({ baseUrl, keepAlive, model, testCase, timeoutMs }) {
	const messages = testCase.messagesFor ? testCase.messagesFor(testCase) : testCase.messages;
	const started = Date.now();
	const response = await fetchWithTimeout(
		ollamaChatEndpoint(baseUrl),
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model,
				messages,
				stream: false,
				think: false,
				keep_alive: keepAlive,
				format: testCase.format,
				options: {
					temperature: testCase.temperature,
					num_predict: testCase.maxTokens,
				},
			}),
		},
		timeoutMs,
	);
	const elapsedMs = Date.now() - started;
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}: ${await response.text()}`);
	}

	const data = await response.json();
	const text = data?.message?.content?.trim();
	if (!text) throw new Error('model returned no message content');

	if (testCase.validateText) {
		testCase.validateText(text, testCase);
		return { elapsedMs, preview: responsePreview(text) };
	}

	let safety;
	try {
		const parsed = parseJsonObject(text);
		if (testCase.validateSafety) {
			try {
				testCase.validateSafety(parsed, testCase);
				safety = { ok: true };
			} catch (error) {
				safety = {
					ok: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		}
		testCase.validate(parsed, testCase);
		return { elapsedMs, preview: responsePreview(text), safety };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const wrapped = new Error(`${message}; preview: ${responsePreview(text)}`);
		if (safety) wrapped.safety = safety;
		throw wrapped;
	}
}

function resultRow(result) {
	return [
		result.model.padEnd(28, ' '),
		result.case.padEnd(25, ' '),
		result.ok ? 'PASS' : 'FAIL',
		result.safetyOk === undefined ? 'n/a   ' : result.safetyOk ? 'PASS  ' : 'FAIL  ',
		String(result.elapsedMs ?? '-').padStart(7, ' '),
		result.safetyError
			? `${result.error ? `${result.error} | ` : ''}safety: ${result.safetyError}`
			: result.error
				? result.error
				: result.preview,
	].join('  ');
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		printHelp();
		return;
	}

	const baseUrl = String(
		args['base-url'] || process.env.LOCAL_AI_BENCHMARK_BASE_URL || DEFAULT_BASE_URL,
	);
	const keepAlive = String(
		args['keep-alive'] || process.env.LOCAL_AI_BENCHMARK_KEEP_ALIVE || DEFAULT_KEEP_ALIVE,
	);
	const timeoutMs = Number(
		args['timeout-ms'] || process.env.LOCAL_AI_BENCHMARK_TIMEOUT_MS || DEFAULT_TIMEOUT_MS,
	);
	const models = String(
		args.models || process.env.LOCAL_AI_BENCHMARK_MODELS || DEFAULT_MODELS.join(','),
	)
		.split(',')
		.map((model) => model.trim())
		.filter(Boolean);
	const selectedCaseNames =
		typeof args.cases === 'string'
			? new Set(
					args.cases
						.split(',')
						.map((name) => name.trim())
						.filter(Boolean),
				)
			: undefined;
	const selectedCases = selectedCaseNames
		? cases.filter((testCase) => selectedCaseNames.has(testCase.name))
		: cases;
	if (selectedCases.length === 0) {
		const available = cases.map((testCase) => testCase.name).join(', ');
		throw new Error(`No benchmark cases matched --cases. Available cases: ${available}`);
	}

	const results = [];
	for (const model of models) {
		for (const testCase of selectedCases) {
			try {
				const run = await runCase({ baseUrl, keepAlive, model, testCase, timeoutMs });
				results.push({
					case: testCase.name,
					description: testCase.description,
					elapsedMs: run.elapsedMs,
					model,
					ok: true,
					preview: run.preview,
					safetyError: run.safety?.error,
					safetyOk: run.safety?.ok,
				});
			} catch (error) {
				results.push({
					case: testCase.name,
					description: testCase.description,
					elapsedMs: undefined,
					error: error instanceof Error ? error.message : String(error),
					model,
					ok: false,
					safetyError: error instanceof Error ? error.safety?.error : undefined,
					safetyOk: error instanceof Error ? error.safety?.ok : undefined,
				});
			}
		}
	}

	if (args.json) {
		console.log(JSON.stringify({ baseUrl, keepAlive, models, results }, null, 2));
	} else {
		console.log(`Local AI benchmark (${baseUrl}, keep_alive=${keepAlive})`);
		console.log(
			['MODEL'.padEnd(28, ' '), 'CASE'.padEnd(25, ' '), 'OK  ', 'SAFETY', '  MS   ', 'DETAIL'].join(
				'  ',
			),
		);
		for (const result of results) console.log(resultRow(result));
		const failures = results.filter((result) => !result.ok).length;
		console.log(`Summary: ${results.length - failures}/${results.length} passed`);
	}

	if (results.some((result) => !result.ok)) process.exitCode = 1;
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
