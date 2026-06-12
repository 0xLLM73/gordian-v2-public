#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const root = process.cwd();
const failures = [];

function fail(message) {
	failures.push(message);
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
		'TELEGRAM_SESSION_KEY_PROVIDER="dev-insecure"',
		'TELEGRAM_MTPROTO_PER_INTERACTION_UNLOCK="false"',
		'TELEGRAM_MTPROTO_SESSION_IDLE_MINUTES="30"',
		'WORKSPACE_KEY_PROVIDER="dev-insecure"',
		'WORKSPACE_KEY_CACHE_TTL_MINUTES="60"',
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
		'docs/RELEASE_REGRESSION_SYSTEM.md',
		'docs/SECURITY_NOTES.md',
		'docs/ENVIRONMENT_MATRIX.md',
		'docs/AI_EGRESS_INVENTORY.md',
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
		'scripts/release-regression-guard.mjs',
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

	if (existsSync('.github/dependabot.yml')) assertDependabotCoverage();

	if (
		existsSync('.github/ISSUE_TEMPLATE/config.yml') &&
		!readFileSync('.github/ISSUE_TEMPLATE/config.yml', 'utf8').includes('/security/policy')
	) {
		fail('.github/ISSUE_TEMPLATE/config.yml must point security reports to the security policy');
	}

	assertContributorGuardrails();
}

function assertContributorGuardrails() {
	if (existsSync('.github/CODEOWNERS')) {
		const codeowners = readFileSync('.github/CODEOWNERS', 'utf8');
		if (!/^\*\s+@0xLLM73\s+@thegrovest\s*$/m.test(codeowners)) {
			fail('.github/CODEOWNERS must require @0xLLM73 and @thegrovest review for every path');
		}
	}

	if (existsSync('.github/pull_request_template.md')) {
		const template = readFileSync('.github/pull_request_template.md', 'utf8');
		for (const phrase of [
			'No new data model field was added',
			'No new export path was added',
			'No new logging, audit event, or error serialization was added',
			'No new AI provider egress, prompt, embedding, or observability path was added',
			'No new browser-visible sensitive data surface was added',
			'No Telegram sending, import, sync, or session-custody behavior changed',
			'Browser QA is not required for this PR',
		]) {
			if (!template.includes(phrase)) {
				fail(
					`.github/pull_request_template.md must include sensitive-data checklist item: ${phrase}`,
				);
			}
		}
	}

	if (existsSync('.github/ISSUE_TEMPLATE/config.yml')) {
		const config = readFileSync('.github/ISSUE_TEMPLATE/config.yml', 'utf8');
		if (!/blank_issues_enabled:\s*false/.test(config)) {
			fail('.github/ISSUE_TEMPLATE/config.yml must keep blank public issues disabled');
		}
		if (!config.includes('gordian-v2-public/security/policy')) {
			fail(
				'.github/ISSUE_TEMPLATE/config.yml must route security reports to the public mirror security policy',
			);
		}
	}

	for (const issueTemplate of [
		'.github/ISSUE_TEMPLATE/bug_report.yml',
		'.github/ISSUE_TEMPLATE/feature_request.yml',
	]) {
		if (!existsSync(issueTemplate)) continue;
		const text = readFileSync(issueTemplate, 'utf8');
		for (const phrase of [
			'Do not include real Telegram messages',
			'session strings',
			'API keys',
			'provider logs with secrets',
		]) {
			if (!text.includes(phrase)) {
				fail(`${issueTemplate} must warn contributors not to include ${phrase}`);
			}
		}
	}

	if (existsSync('CONTRIBUTING.md')) {
		const contributing = readFileSync('CONTRIBUTING.md', 'utf8');
		for (const phrase of [
			'docs/DATA_CLASSIFICATION.md',
			'AI provider calls',
			'Telegram import, sync, send',
			'in-app browser or Playwright QA',
		]) {
			if (!contributing.includes(phrase)) {
				fail(`CONTRIBUTING.md must include contributor sensitive-data guidance: ${phrase}`);
			}
		}
	}

	if (existsSync('SECURITY.md')) {
		const security = readFileSync('SECURITY.md', 'utf8');
		for (const phrase of [
			'private vulnerability reporting',
			'Do not attach `.env`',
			'AI provider egress',
			'browser-visible errors',
		]) {
			if (!security.includes(phrase)) {
				fail(`SECURITY.md must include release security guidance: ${phrase}`);
			}
		}
	}
}

function dependabotUpdates(config) {
	const updates = [];
	let current = null;
	for (const line of config.split(/\r?\n/)) {
		const ecosystem = line.match(/^\s*-\s*package-ecosystem:\s*"?([^"\s]+)"?\s*$/);
		if (ecosystem) {
			current = { ecosystem: ecosystem[1], directory: null };
			updates.push(current);
			continue;
		}

		const directory = line.match(/^\s*directory:\s*"?([^"\s]+)"?\s*$/);
		if (directory && current) current.directory = directory[1];
	}

	return updates;
}

function assertDependabotCoverage() {
	const updates = dependabotUpdates(readFileSync('.github/dependabot.yml', 'utf8'));
	for (const required of [
		{ ecosystem: 'npm', directory: '/' },
		{ ecosystem: 'github-actions', directory: '/' },
		{ ecosystem: 'docker', directory: '/apps/web' },
		{ ecosystem: 'docker', directory: '/apps/worker' },
		{ ecosystem: 'docker-compose', directory: '/' },
	]) {
		if (
			!updates.some(
				(update) =>
					update.ecosystem === required.ecosystem && update.directory === required.directory,
			)
		) {
			fail(
				`.github/dependabot.yml must cover ${required.ecosystem} dependencies in ${required.directory}`,
			);
		}
	}
}

const allowedSqlFiles = [/^packages\/db\/drizzle\/[0-9]{4}[a-z]?_[A-Za-z0-9_-]+\.sql$/];

const allowedPublicFixtureFiles = [
	/^apps\/web\/e2e\/fixtures\/(auth|deals)\.ts$/,
	/^packages\/db\/src\/__tests__\/fixtures\/knowledge-recall-(fixture|harness|quality)\.ts$/,
	/^packages\/db\/src\/__tests__\/fixtures\/knowledge-recall-quality-baseline\.json$/,
];

const highRiskPublicArtifactRules = [
	{
		label: 'database or backup dump',
		pattern: /\.(sqlite|sqlite3|db|dump|backup|bak|pgdump|psql)$/i,
	},
	{
		label: 'dataset export',
		pattern: /\.(csv|tsv|jsonl|ndjson|parquet|arrow|xls|xlsx|ods)$/i,
	},
	{
		label: 'log, HAR, or trace artifact',
		pattern: /\.(log|har|trace)$/i,
	},
	{
		label: 'screenshot or captured image artifact',
		pattern: /\.(png|jpg|jpeg|webp|gif|bmp|tif|tiff|heic)$/i,
	},
	{
		label: 'video or screen-recording artifact',
		pattern: /\.(mp4|mov|webm|mkv|avi)$/i,
	},
	{
		label: 'compressed archive artifact',
		pattern: /\.(zip|tar|tgz|tar\.gz|gz|7z|rar)$/i,
	},
];

const highRiskJsonArtifactPath =
	/(^|\/)(exports?|data-exports?|dumps?|db-dumps?|database-dumps?|backups?|snapshots?|logs?|screenshots?|screen-recordings?|recordings?|playwright-report|test-results)\/.*\.json$/i;

function isAllowedSqlFile(path) {
	return allowedSqlFiles.some((pattern) => pattern.test(path));
}

function isFixturePath(path) {
	return /(^|\/)(__fixtures__|fixtures)(\/|$)/.test(path);
}

function isAllowedPublicFixtureFile(path) {
	return allowedPublicFixtureFiles.some((pattern) => pattern.test(path));
}

function assertPublicArtifactPath(path) {
	if (/\.sql$/i.test(path) && !isAllowedSqlFile(path)) {
		fail(
			`${path} is a SQL file outside the Drizzle migration allowlist; do not publish database dumps or ad hoc SQL exports`,
		);
	}

	for (const rule of highRiskPublicArtifactRules) {
		if (rule.pattern.test(path)) {
			fail(
				`${path} looks like a ${rule.label}; public PRs must not include dumps, exports, logs, screenshots, videos, or archives`,
			);
		}
	}

	if (highRiskJsonArtifactPath.test(path)) {
		fail(
			`${path} looks like exported JSON or a generated report artifact; keep exports, logs, screenshots, and test reports out of the public tree`,
		);
	}

	if (isFixturePath(path) && !isAllowedPublicFixtureFile(path)) {
		fail(
			`${path} is a fixture outside the approved synthetic fixture allowlist; add only deterministic demo fixtures and update the allowlist intentionally`,
		);
	}
}

function scanCurrentTree() {
	const forbiddenSensitiveFiles = [
		/\.p12$/i,
		/\.mobileprovision$/i,
		/AuthKey_[A-Z0-9]+\.p8$/i,
		/(^|\/)(api-key|notarytool|apple-signing|codesign).*\.(json|plist|txt)$/i,
	];
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
		/APPLE_ID="[^"<][^"]+"/,
		/APPLE_TEAM_ID="[^"<][^"]+"/,
		/APPLE_APP_SPECIFIC_PASSWORD="[^"<][^"]+"/,
		/-----BEGIN (RSA |EC |OPENSSH |)?PRIVATE KEY-----/,
	];

	for (const path of trackedAndPendingFiles()) {
		assertPublicArtifactPath(path);

		for (const pattern of forbiddenSensitiveFiles) {
			if (pattern.test(path)) {
				fail(`${path} matched forbidden sensitive-file pattern ${pattern}`);
			}
		}

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
		fail('gitleaks is required for full-history and working-tree secret scanning');
		return;
	}

	const shallow = run('git', ['rev-parse', '--is-shallow-repository']);
	if (shallow.status !== 0) {
		fail(`Could not determine whether git history is shallow: ${shallow.stderr.trim()}`);
		return;
	}
	if (shallow.stdout.trim() === 'true') {
		fail('gitleaks full-history scanning requires a full-depth git checkout');
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

function runLocalRuntimeSafetySmoke() {
	const result = run('node', ['scripts/local-runtime-safety-smoke.mjs']);
	if (result.status !== 0) {
		fail(`local runtime safety smoke failed:\n${result.stdout}${result.stderr}`);
	}
}

function runReleaseRegressionGuard() {
	const result = run('node', ['scripts/release-regression-guard.mjs']);
	if (result.status !== 0) {
		fail(`release regression guard failed:\n${result.stdout}${result.stderr}`);
	}
}

function runAiEgressInventoryAudit() {
	const result = run('node', ['scripts/ai-egress-inventory-audit.mjs']);
	if (result.status !== 0) {
		fail(`AI egress inventory audit failed:\n${result.stdout}${result.stderr}`);
	}
}

assertEnvExample();
assertArchiveTombstoneOnly();
assertNoGenericDeployScript();
assertExampleInfraNames();
assertDocsExist();
assertOssGovernance();
scanCurrentTree();
runAiEgressInventoryAudit();
runLocalRuntimeSafetySmoke();
runReleaseRegressionGuard();
runGitleaks();

if (failures.length > 0) {
	console.error('\nOpen-source audit failed:');
	for (const message of failures) console.error(`- ${message}`);
	process.exit(1);
}

console.log('Open-source audit passed.');
