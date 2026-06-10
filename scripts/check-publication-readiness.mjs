#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const failures = [];
const warnings = [];
const { slug, source, help } = parseArgs(process.argv.slice(2));
let checkedRepoIsPublic = null;

if (help) {
	console.log(`Usage: pnpm check:publication [owner/repo]
       pnpm check:publication --repo owner/repo

Checks the GitHub-side publication settings for the selected repository.

Target selection:
  1. positional owner/repo or --repo owner/repo
  2. GORDIAN_PUBLICATION_REPO or PUBLICATION_REPO
  3. origin remote
`);
	process.exit(0);
}

function parseArgs(args) {
	let explicitRepo = null;

	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === '--help' || arg === '-h') return { slug: null, source: 'help', help: true };
		if (arg === '--repo') {
			const value = args[i + 1];
			if (!value) {
				fail('--repo requires an owner/repo value');
				continue;
			}
			explicitRepo = value;
			i += 1;
			continue;
		}
		if (arg.startsWith('--repo=')) {
			explicitRepo = arg.slice('--repo='.length);
			continue;
		}
		if (arg.startsWith('-')) {
			fail(`Unknown option: ${arg}`);
			continue;
		}
		if (!explicitRepo) {
			explicitRepo = arg;
			continue;
		}
		fail(`Unexpected argument: ${arg}`);
	}

	const envRepo = process.env.GORDIAN_PUBLICATION_REPO || process.env.PUBLICATION_REPO;
	if (explicitRepo) return { slug: explicitRepo.trim(), source: 'argument', help: false };
	if (envRepo?.trim()) return { slug: envRepo.trim(), source: 'environment', help: false };
	return { slug: inferRepoSlug(), source: 'origin remote', help: false };
}

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

function isRepoPublic(repo) {
	return repo.private === false && repo.visibility === 'public';
}

function visibilityLabel(repo) {
	if (repo.visibility) return repo.visibility;
	return repo.private ? 'private' : 'unknown';
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

	if (existsSync('.github/dependabot.yml')) assertDependabotCoverage();
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

function assertRepoMetadata(repo) {
	const repoIsPublic = isRepoPublic(repo);
	if (!repoIsPublic) {
		fail(
			`Repository must be public before announcing this as an open-source release; current visibility is ${visibilityLabel(repo)}`,
		);
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
		const privateHint = repoIsPublic
			? ''
			: '; this may remain unavailable while the selected repository is private';
		fail(
			`Secret scanning must be enabled; current status is ${security.secret_scanning?.status ?? 'unavailable'}${privateHint}`,
		);
	}
	if (security.secret_scanning_push_protection?.status !== 'enabled') {
		const privateHint = repoIsPublic
			? ''
			: '; this may remain unavailable while the selected repository is private';
		fail(
			`Secret scanning push protection must be enabled; current status is ${security.secret_scanning_push_protection?.status ?? 'unavailable'}${privateHint}`,
		);
	}

	return repoIsPublic;
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
		fail('main must require at least one approving pull request review');
	}

	if (protection.required_pull_request_reviews?.require_code_owner_reviews !== true) {
		fail('main must require CODEOWNER review before merge');
	}
}

function assertPrivateVulnerabilityReporting(repoSlug, repoIsPublic) {
	const pvr = gh([`repos/${repoSlug}/private-vulnerability-reporting`], { json: false });
	if (!pvr.ok) {
		const privateHint =
			repoIsPublic === false
				? ' This endpoint may return 404 while the selected repository is private; make the sanitized mirror public intentionally, enable private vulnerability reporting, then rerun this check.'
				: '';
		fail(`Private vulnerability reporting must be enabled: ${pvr.error}${privateHint}`);
	}
}

function printNextSteps(repoSlug, repoIsPublic, targetSource) {
	console.error('\nPublication readiness next steps:');
	if (targetSource === 'origin remote' && repoSlug === '0xLLM73/gordian-v2') {
		console.error(
			'- Do not make the private source repository public. Run this check against 0xLLM73/gordian-v2-public from the mirror checkout, with --repo, or with GORDIAN_PUBLICATION_REPO.',
		);
	} else if (repoIsPublic === false) {
		console.error(
			`- Make ${repoSlug} public only after the sanitized release tree, provider-side rotation, runtime cleanup, and human sign-off are complete.`,
		);
	}
	console.error(
		'- In GitHub Settings > Code security and analysis, enable secret scanning, push protection, Dependabot alerts, Dependabot security updates, and private vulnerability reporting.',
	);
	console.error('- Re-run this command against the publication target repository.');
}

if (!slug) {
	fail('Could not infer GitHub repository from origin remote; pass owner/repo as an argument');
} else {
	console.log(`Checking GitHub publication readiness for ${slug} (${source})`);
	if (source === 'origin remote') {
		warn(
			'Using origin remote as the publication target; from the private source checkout, pass --repo 0xLLM73/gordian-v2-public or set GORDIAN_PUBLICATION_REPO',
		);
	}
	assertLocalGovernanceFiles();

	const repo = requireOk('Repository metadata', gh([`repos/${slug}`]));
	const repoIsPublic = repo ? assertRepoMetadata(repo) : null;
	checkedRepoIsPublic = repoIsPublic;

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

	assertPrivateVulnerabilityReporting(slug, repoIsPublic);

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
	if (slug) printNextSteps(slug, checkedRepoIsPublic, source);
	process.exit(1);
}

console.log('Publication readiness check passed.');
