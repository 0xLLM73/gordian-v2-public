#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';

const failures = [];

function fail(message) {
	failures.push(message);
}

function readRequired(path) {
	if (!existsSync(path)) {
		fail(`${path} is missing`);
		return '';
	}
	return readFileSync(path, 'utf8');
}

function assertIncludes(path, text, phrases) {
	for (const phrase of phrases) {
		if (!text.includes(phrase)) fail(`${path} must include ${phrase}`);
	}
}

const regressionDoc = readRequired('docs/RELEASE_REGRESSION_SYSTEM.md');
assertIncludes('docs/RELEASE_REGRESSION_SYSTEM.md', regressionDoc, [
	'## Every PR',
	'## Every Release Candidate',
	'## Weekly',
	'## Monthly',
	'## Regression Triggers',
	'## Accepted Risks',
	'pnpm audit:open-source',
	'pnpm audit --prod',
	'pnpm test',
	'pnpm demo:smoke',
	'pnpm check:publication --repo 0xLLM73/gordian-v2-public',
	'pnpm security:derived-data-audit',
	'pnpm kg:security:audit',
	'pnpm telegram:security-smoke --allow-missing-credentials --skip-db --skip-redis --skip-worker',
	'database dumps, ad hoc SQL exports outside Drizzle migrations',
	'approved deterministic synthetic fixture allowlist',
	'/settings/audit',
	'/search',
	'New AI prompt, embedding flow, model call, retrieval context, or derived-data',
	'New Telegram send/import/session behavior',
	'New fixture, dump, screenshot, log, generated report, or dataset artifact',
]);

const prTemplate = readRequired('.github/pull_request_template.md');
assertIncludes('.github/pull_request_template.md', prTemplate, [
	'## Regression Triggers',
	'New data model field',
	'New export path',
	'New fixture, dump, screenshot/video, log, generated report, or dataset artifact',
	'New logger, audit event, telemetry event, or error serialization path',
	'New AI prompt, embedding flow, model call, retrieval context, or derived-data cache',
	'New Telegram send/import/session behavior',
	'New browser-visible sensitive data',
]);

const openSourceAudit = readRequired('scripts/open-source-audit.mjs');
assertIncludes('scripts/open-source-audit.mjs', openSourceAudit, [
	'allowedPublicFixtureFiles',
	'highRiskPublicArtifactRules',
	'highRiskJsonArtifactPath',
	'SQL file outside the Drizzle migration allowlist',
	'public PRs must not include dumps, exports, logs, screenshots, videos, or archives',
	'fixture outside the approved synthetic fixture allowlist',
]);

const publishing = readRequired('docs/PUBLISHING.md');
assertIncludes('docs/PUBLISHING.md', publishing, [
	'docs/RELEASE_REGRESSION_SYSTEM.md',
	'release regression system',
	'pnpm bootstrap:local-owner',
]);

const publicStatus = readRequired('docs/PUBLIC_STATUS.md');
assertIncludes('docs/PUBLIC_STATUS.md', publicStatus, [
	'pnpm bootstrap:local-owner',
	'Public email signup is disabled',
]);

const attestation = readRequired('docs/RELEASE_ATTESTATION.md');
assertIncludes('docs/RELEASE_ATTESTATION.md', attestation, [
	'## Ongoing Regression System',
	'Every PR gate',
	'Release browser QA matrix',
	'Weekly publication review',
	'Monthly sensitive-data review',
]);

const ci = readRequired('.github/workflows/ci.yml');
assertIncludes('.github/workflows/ci.yml', ci, [
	'pnpm audit:open-source',
	'pnpm audit',
	'pnpm audit --prod',
	'pnpm lint',
	'pnpm typecheck',
	'pnpm test',
	'demo-smoke.spec.ts',
]);

const packageJson = readRequired('package.json');
assertIncludes('package.json', packageJson, [
	'"bootstrap:local-owner": "tsx scripts/bootstrap-local-owner.ts"',
]);

const localOwnerBootstrap = readRequired('scripts/bootstrap-local-owner.ts');
assertIncludes('scripts/bootstrap-local-owner.ts', localOwnerBootstrap, [
	'Local owner bootstrap refuses nonlocal DATABASE_URL',
	'shouldRefuseForExistingUsers',
	'createWorkspace(',
]);

const telegramSecuritySmoke = readRequired('scripts/telegram-security-smoke.mjs');
assertIncludes('scripts/telegram-security-smoke.mjs', telegramSecuritySmoke, [
	"runtimeValue(env, 'WORKER_INTERNAL_SECRET') ?? runtimeValue(env, 'INTERNAL_AUTH_SECRET')",
	'WORKER_URL/WORKER_INTERNAL_SECRET or INTERNAL_AUTH_SECRET not set',
]);

if (failures.length > 0) {
	console.error('\nRelease regression guard failed:');
	for (const message of failures) console.error(`- ${message}`);
	process.exit(1);
}

console.log('Release regression guard passed.');
