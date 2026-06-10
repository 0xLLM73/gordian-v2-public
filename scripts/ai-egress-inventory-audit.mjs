#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const INVENTORY_DOC = 'docs/AI_EGRESS_INVENTORY.md';
const SOURCE_ROOTS = ['apps', 'packages', 'scripts'];
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.ts', '.tsx']);
const IGNORED_PATH_PARTS = [
	'/.next/',
	'/coverage/',
	'/dist/',
	'/node_modules/',
	'/__tests__/',
	'/e2e/',
	'/test-results/',
];
const IGNORED_FILE_PATTERNS = [
	/\.test\.[cm]?[jt]sx?$/i,
	/\.spec\.[cm]?[jt]sx?$/i,
	/^scripts\/ai-egress-inventory-audit\.mjs$/,
];

const PROVIDER_PATTERNS = [
	{
		name: 'Anthropic SDK',
		pattern: /@anthropic-ai\/sdk|\bnew\s+Anthropic\b|\bmessages\.create\b|\bmessages\.stream\b/,
	},
	{
		name: 'Gemini SDK',
		pattern:
			/@google\/generative-ai|\bGoogleGenerativeAI\b|\bgetGenerativeModel\b|\bgenerateContent\b/,
	},
	{
		name: 'AI inference helper',
		pattern: /\b(?:inferWithCache|streamInfer|inferWithGemini)\b/,
	},
	{
		name: 'Embedding helper',
		pattern:
			/\b(?:generateEmbedding|generateEmbeddings|generateEmbeddingCached|generateEmbeddingsCached)\b/,
	},
	{
		name: 'OpenAI-compatible endpoint',
		pattern:
			/api\.openai\.com|runtime\.embeddingsUrl|runtime\.chatCompletionsUrl|ollamaChatUrl|openAICompatibleUrl\([^)]*\/(?:embeddings|chat\/completions)|['"`]\/v1\/embeddings|['"`]\/embeddings|['"`]\/chat\/completions/,
	},
	{
		name: 'Worker embedding handoff',
		pattern: /\/admin\/embed/,
	},
	{
		name: 'Helicone egress',
		pattern: /anthropic\.helicone\.ai|api\.helicone\.ai/,
	},
];

function walk(dir) {
	if (!existsSync(dir)) return [];
	const entries = readdirSync(dir);
	const files = [];
	for (const entry of entries) {
		const absolute = join(dir, entry);
		const relative = absolute.slice(ROOT.length + 1);
		const normalized = relative.split('\\').join('/');
		if (IGNORED_PATH_PARTS.some((part) => `/${normalized}/`.includes(part))) continue;

		const stat = statSync(absolute);
		if (stat.isDirectory()) {
			files.push(...walk(absolute));
			continue;
		}
		if (!stat.isFile()) continue;
		if (IGNORED_FILE_PATTERNS.some((pattern) => pattern.test(normalized))) continue;
		if (!SOURCE_EXTENSIONS.has(extension(normalized))) continue;
		files.push(normalized);
	}
	return files;
}

function extension(path) {
	const match = path.match(/(\.[^.]+)$/);
	return match ? match[1] : '';
}

function read(path) {
	return readFileSync(join(ROOT, path), 'utf8');
}

function discoverCallSites() {
	return SOURCE_ROOTS.flatMap((root) => walk(join(ROOT, root)))
		.map((path) => {
			const text = read(path);
			const matches = PROVIDER_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(
				({ name }) => name,
			);
			return { path, matches };
		})
		.filter((entry) => entry.matches.length > 0)
		.sort((a, b) => a.path.localeCompare(b.path));
}

function inventoryPaths() {
	if (!existsSync(join(ROOT, INVENTORY_DOC))) {
		return { paths: new Set(), error: `${INVENTORY_DOC} is missing` };
	}
	const text = read(INVENTORY_DOC);
	const paths = new Set(
		[...text.matchAll(/`((?:apps|packages|scripts)\/[^`]+)`/g)]
			.map((m) => m[1])
			.filter((path) => !IGNORED_FILE_PATTERNS.some((pattern) => pattern.test(path))),
	);
	return { paths };
}

const discovered = discoverCallSites();
if (process.argv.includes('--list')) {
	for (const entry of discovered) {
		console.log(`${entry.path}\t${entry.matches.join(', ')}`);
	}
	process.exit(0);
}

const inventory = inventoryPaths();
const failures = [];

if (inventory.error) failures.push(inventory.error);

if (!inventory.error) {
	for (const entry of discovered) {
		if (!inventory.paths.has(entry.path)) {
			failures.push(`${entry.path} is missing from ${INVENTORY_DOC} (${entry.matches.join(', ')})`);
		}
	}

	for (const path of inventory.paths) {
		if (!discovered.some((entry) => entry.path === path)) {
			failures.push(`${path} is listed in ${INVENTORY_DOC} but no AI egress pattern was found`);
		}
	}
}

if (failures.length > 0) {
	console.error('AI egress inventory audit failed:');
	for (const failure of failures) console.error(`- ${failure}`);
	process.exit(1);
}

console.log(`AI egress inventory audit passed (${discovered.length} files inventoried).`);
