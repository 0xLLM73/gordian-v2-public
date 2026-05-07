#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const root = process.cwd();
const failures = [];
const warnings = [];

function fail(message) {
	failures.push(message);
}

function warn(message) {
	warnings.push(message);
}

function run(command, args, options = {}) {
	return spawnSync(command, args, {
		cwd: root,
		encoding: 'utf8',
		...options,
	});
}

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

function publicTreeFiles() {
	const result = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
	if (result.status !== 0) {
		fail(`git ls-files failed: ${result.stderr.trim()}`);
		return [];
	}

	return result.stdout
		.split('\0')
		.filter(Boolean)
		.filter((path) => !path.startsWith('node_modules/'))
		.filter((path) => !path.includes('/node_modules/'))
		.filter((path) => !path.startsWith('.git/'))
		.filter((path) => !path.startsWith('.turbo/'))
		.filter((path) => !path.includes('/.turbo/'));
}

function trackedAndPendingFiles() {
	return publicTreeFiles()
		.filter((path) => path !== 'scripts/open-source-audit.mjs')
		.filter((path) => path !== 'pnpm-lock.yaml');
}

function listFiles(path) {
	if (!existsSync(path)) return [];
	const stat = statSync(path);
	if (stat.isFile()) return [path];
	if (!stat.isDirectory()) return [];

	return readdirSync(path).flatMap((entry) => listFiles(`${path}/${entry}`));
}

function assertEnvExample() {
	const envPath = '.env.example';
	if (!existsSync(envPath)) {
		fail('.env.example is missing');
		return;
	}

	const env = readFileSync(envPath, 'utf8');
	const requiredLines = [
		'TELEGRAM_BOT_ENABLED="false"',
		'TELEGRAM_MTPROTO_ENABLED="false"',
		'TELEGRAM_SEND_ENABLED="false"',
		'NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED="false"',
		'BOT_TOKEN=""',
		'TELEGRAM_API_ID=""',
		'TELEGRAM_API_HASH=""',
	];

	for (const line of requiredLines) {
		if (!env.includes(line)) fail(`.env.example must include ${line}`);
	}
}

function assertArchiveTombstoneOnly() {
	const archiveFiles = listFiles('docs/archive').filter(
		(path) => path !== 'docs/archive/README.md',
	);
	if (archiveFiles.length > 0) {
		fail(
			`docs/archive must remain a tombstone only; remove private archive files: ${archiveFiles.join(', ')}`,
		);
	}
}

function assertNoGenericDeployScript() {
	for (const path of ['package.json', 'apps/worker/package.json', 'apps/web/package.json']) {
		if (!existsSync(path)) continue;
		const json = readJson(path);
		if (json.scripts?.deploy) {
			fail(`${path} contains a generic deploy script; use an explicitly named example script`);
		}
	}
}

function assertExampleInfraNames() {
	const workerFly = 'apps/worker/fly.toml';
	if (existsSync(workerFly)) {
		const text = readFileSync(workerFly, 'utf8');
		if (!text.includes('app = "gordian-worker-example"')) {
			fail(`${workerFly} must use an obvious example app name`);
		}
	}

	const dragonflyFly = 'infra/dragonfly/fly.toml';
	if (existsSync(dragonflyFly)) {
		const text = readFileSync(dragonflyFly, 'utf8');
		if (!text.includes('app = "gordian-dragonfly-example"')) {
			fail(`${dragonflyFly} must use an obvious example app name`);
		}
		if (!text.includes('source = "dragonfly_data_example"')) {
			fail(`${dragonflyFly} must use an obvious example volume name`);
		}
	}
}

function assertDocsExist() {
	const docs = [
		'README.md',
		'ARCHITECTURE.md',
		'SECURITY.md',
		'SUPPORT.md',
		'CONTRIBUTING.md',
		'docs/BUILDING_TELEGRAM_CRMS.md',
		'docs/PUBLISHING.md',
		'docs/OPEN_SOURCE.md',
		'docs/PUBLIC_STATUS.md',
		'docs/SECURITY_NOTES.md',
		'docs/ENVIRONMENT_MATRIX.md',
	];

	for (const doc of docs) {
		if (!existsSync(doc)) fail(`${doc} is missing`);
	}
}

function assertOssGovernance() {
	const requiredFiles = [
		'LICENSE',
		'.github/CODEOWNERS',
		'.github/dependabot.yml',
		'.github/pull_request_template.md',
		'.github/ISSUE_TEMPLATE/bug_report.yml',
		'.github/ISSUE_TEMPLATE/feature_request.yml',
		'.github/ISSUE_TEMPLATE/config.yml',
		'.github/workflows/ci.yml',
		'.github/workflows/secret-rotation-reminder.yml',
		'scripts/check-publication-readiness.mjs',
	];

	for (const file of requiredFiles) {
		if (!existsSync(file)) fail(`${file} is missing`);
	}

	if (existsSync('LICENSE') && !readFileSync('LICENSE', 'utf8').includes('MIT License')) {
		fail('LICENSE must contain the MIT License text');
	}

	if (existsSync('package.json') && readJson('package.json').license !== 'MIT') {
		fail('package.json license must be MIT');
	}

	if (
		existsSync('.github/dependabot.yml') &&
		(!readFileSync('.github/dependabot.yml', 'utf8').includes('package-ecosystem: npm') ||
			!readFileSync('.github/dependabot.yml', 'utf8').includes('package-ecosystem: github-actions'))
	) {
		fail('.github/dependabot.yml must cover npm and GitHub Actions dependencies');
	}

	if (
		existsSync('.github/ISSUE_TEMPLATE/config.yml') &&
		!readFileSync('.github/ISSUE_TEMPLATE/config.yml', 'utf8').includes('/security/policy')
	) {
		fail('.github/ISSUE_TEMPLATE/config.yml must point security reports to the security policy');
	}
}

function scanCurrentTree() {
	const stalePatterns = [
		/gordian\.lol/i,
		/gordian-worker\.internal/i,
		/app\s*=\s*"gordian-dragonfly"/i,
		/s3:\/\/gordian/i,
		/api\.cabal/i,
		/\bcabal\b/i,
	];

	const secretPatterns = [
		/sk-[A-Za-z0-9]{20,}/,
		/gh[pousr]_[A-Za-z0-9_]{20,}/,
		/AKIA[0-9A-Z]{16}/,
		/[0-9]{6,}:[A-Za-z0-9_-]{30,}/,
		/xox[baprs]-[A-Za-z0-9-]{20,}/,
		/TELEGRAM_API_HASH="[^"<][^"]+"/,
		/BOT_TOKEN="[^"<][^"]+"/,
		/OPENAI_API_KEY="sk-[A-Za-z0-9_-]{20,}"/,
		/ANTHROPIC_API_KEY="sk-ant-[A-Za-z0-9_-]{20,}"/,
		/AWS_SECRET_ACCESS_KEY="[^"<][^"]+"/,
		/SUPABASE_SERVICE_KEY="[^"<][^"]+"/,
	];

	for (const path of trackedAndPendingFiles()) {
		let text;
		try {
			text = readFileSync(path, 'utf8');
		} catch {
			continue;
		}

		const patterns =
			path === '.env.example' ? stalePatterns : [...stalePatterns, ...secretPatterns];
		for (const pattern of patterns) {
			if (pattern.test(text)) {
				fail(`${path} matched public-release scan pattern ${pattern}`);
			}
		}
	}
}

function runGitleaks() {
	const hasGitleaks = run('gitleaks', ['version']);
	if (hasGitleaks.status !== 0) {
		warn('gitleaks is not installed; skipping full-history and working-tree secret scanner');
		return;
	}

	const snapshot = mkdtempSync(join(tmpdir(), 'gordian-open-source-audit-'));
	try {
		for (const file of publicTreeFiles()) {
			if (!existsSync(file)) continue;
			if (!statSync(file).isFile()) continue;
			const target = join(snapshot, file);
			mkdirSync(dirname(target), { recursive: true });
			copyFileSync(file, target);
		}

		for (const args of [
			['detect', '--no-banner', '--redact'],
			['dir', '--no-banner', '--redact', snapshot],
		]) {
			const result = run('gitleaks', args);
			if (result.status !== 0) {
				fail(`gitleaks ${args[0]} failed:\n${result.stdout}${result.stderr}`);
			}
		}
	} finally {
		rmSync(snapshot, { recursive: true, force: true });
	}
}

assertEnvExample();
assertArchiveTombstoneOnly();
assertNoGenericDeployScript();
assertExampleInfraNames();
assertDocsExist();
assertOssGovernance();
scanCurrentTree();
runGitleaks();

for (const message of warnings) console.warn(`WARN ${message}`);

if (failures.length > 0) {
	console.error('\nOpen-source audit failed:');
	for (const message of failures) console.error(`- ${message}`);
	process.exit(1);
}

console.log('Open-source audit passed.');
