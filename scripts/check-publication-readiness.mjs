#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const slug = process.argv[2] ?? inferRepoSlug();
const failures = [];
const warnings = [];

function inferRepoSlug() {
	const result = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' });
	if (result.status !== 0) return null;

	const remote = result.stdout.trim();
	const match = remote.match(/github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/);
	return match?.[1] ?? null;
}

function fail(message) {
	failures.push(message);
}

function warn(message) {
	warnings.push(message);
}

function gh(args, { json = true } = {}) {
	const result = spawnSync('gh', ['api', ...args], { encoding: 'utf8' });
	if (result.status !== 0) {
		return {
			ok: false,
			error: `${result.stdout}${result.stderr}`.trim() || `gh api ${args.join(' ')} failed`,
		};
	}

	if (!json || result.stdout.trim() === '') return { ok: true, value: null };

	try {
		return { ok: true, value: JSON.parse(result.stdout) };
	} catch (error) {
		return { ok: false, error: `Failed to parse gh output for ${args.join(' ')}: ${error}` };
	}
}

function requireOk(label, response) {
	if (!response.ok) {
		fail(`${label}: ${response.error}`);
		return null;
	}
	return response.value;
}

function assertLocalGovernanceFiles() {
	const required = [
		'LICENSE',
		'SECURITY.md',
		'SUPPORT.md',
		'CONTRIBUTING.md',
		'.github/CODEOWNERS',
		'.github/dependabot.yml',
		'.github/ISSUE_TEMPLATE/bug_report.yml',
		'.github/ISSUE_TEMPLATE/feature_request.yml',
		'.github/ISSUE_TEMPLATE/config.yml',
		'.github/workflows/ci.yml',
		'.github/workflows/secret-rotation-reminder.yml',
	];

	for (const file of required) {
		if (!existsSync(file)) fail(`${file} is missing`);
	}

	if (
		existsSync('SECURITY.md') &&
		!readFileSync('SECURITY.md', 'utf8').includes('Reporting a Vulnerability')
	) {
		fail('SECURITY.md must include vulnerability reporting instructions');
	}
}

function assertRepoMetadata(repo) {
	if (repo.private !== false || repo.visibility !== 'public') {
		fail('Repository must be public before announcing this as an open-source release');
	}
	if (repo.default_branch !== 'main')
		fail(`Default branch must be main, found ${repo.default_branch}`);
	if (repo.has_issues !== true) fail('GitHub Issues must be enabled');
	if (repo.has_wiki === true)
		warn(
			'GitHub Wiki is enabled; keep project documentation in the repo unless intentionally using Wiki',
		);

	const security = repo.security_and_analysis ?? {};
	if (security.secret_scanning?.status !== 'enabled') {
		fail(
			`Secret scanning must be enabled; current status is ${security.secret_scanning?.status ?? 'unavailable'}`,
		);
	}
	if (security.secret_scanning_push_protection?.status !== 'enabled') {
		fail(
			`Secret scanning push protection must be enabled; current status is ${security.secret_scanning_push_protection?.status ?? 'unavailable'}`,
		);
	}
}

function assertBranchProtection(protection) {
	const checks = protection.required_status_checks;
	if (!checks) fail('main must require status checks');
	if (checks && checks.strict !== true)
		fail('main required status checks must require branches to be up to date');

	const contexts = new Set(checks?.contexts ?? []);
	for (const context of ['validate', 'demo-smoke']) {
		if (!contexts.has(context)) fail(`main must require the ${context} status check`);
	}

	if (protection.enforce_admins?.enabled !== true)
		fail('main branch protection must enforce admins');
	if (protection.required_linear_history?.enabled !== true)
		fail('main must require linear history');
	if (protection.allow_force_pushes?.enabled !== false) fail('main must block force pushes');
	if (protection.allow_deletions?.enabled !== false) fail('main must block branch deletion');
	if (protection.required_conversation_resolution?.enabled !== true) {
		fail('main must require conversation resolution before merge');
	}

	const reviewCount =
		protection.required_pull_request_reviews?.required_approving_review_count ?? 0;
	if (reviewCount < 1) {
		warn(
			'main does not currently require an approving review; consider requiring at least one review for public contributions',
		);
	}
}

if (!slug) {
	fail('Could not infer GitHub repository from origin remote; pass owner/repo as an argument');
} else {
	console.log(`Checking GitHub publication readiness for ${slug}`);
	assertLocalGovernanceFiles();

	const repo = requireOk('Repository metadata', gh([`repos/${slug}`]));
	if (repo) assertRepoMetadata(repo);

	requireOk(
		'Dependabot vulnerability alerts',
		gh([`repos/${slug}/vulnerability-alerts`], { json: false }),
	);

	const automatedFixes = requireOk(
		'Dependabot security updates',
		gh([`repos/${slug}/automated-security-fixes`]),
	);
	if (automatedFixes) {
		if (automatedFixes.enabled !== true || automatedFixes.paused === true) {
			fail('Dependabot security updates must be enabled and unpaused');
		}
	}

	const pvr = gh([`repos/${slug}/private-vulnerability-reporting`], { json: false });
	if (!pvr.ok) fail(`Private vulnerability reporting must be enabled: ${pvr.error}`);

	const protection = requireOk(
		'main branch protection',
		gh([`repos/${slug}/branches/main/protection`]),
	);
	if (protection) assertBranchProtection(protection);
}

for (const message of warnings) console.warn(`WARN ${message}`);

if (failures.length > 0) {
	console.error('\nPublication readiness check failed:');
	for (const message of failures) console.error(`- ${message}`);
	process.exit(1);
}

console.log('Publication readiness check passed.');
