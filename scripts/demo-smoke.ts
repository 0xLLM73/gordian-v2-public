import { spawnSync } from 'node:child_process';

const demoEnv = {
	BETTER_AUTH_BASE_URL: 'http://localhost:3456',
	BETTER_AUTH_SECRET: 'demo-smoke-better-auth-secret-min-32',
	BETTER_AUTH_URL: 'http://localhost:3456',
	DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/gordian_dev',
	DEV_KMS_BYPASS: 'true',
	DIRECT_URL: 'postgresql://postgres:postgres@localhost:5432/gordian_dev',
	DRAGONFLY_URL: 'redis://localhost:6379',
	INTERNAL_AUTH_SECRET: 'demo-smoke-internal-secret-min-32',
	NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED: 'false',
	SEED_PASSWORD: 'gordian-demo',
	TELEGRAM_BOT_ENABLED: 'false',
	TELEGRAM_MTPROTO_ENABLED: 'false',
	TELEGRAM_SEND_ENABLED: 'false',
	WEB_URL: 'http://localhost:3456',
	WORKSPACE_KEY_PROVIDER: 'dev-insecure',
	WORKER_URL: 'http://localhost:3001',
};

function run(command: string, args: string[]) {
	const result = spawnSync(command, args, {
		env: { ...process.env, ...demoEnv },
		stdio: 'inherit',
	});

	if (result.error) {
		console.error(result.error.message);
		process.exit(1);
	}

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

const auditOnly = process.argv.includes('--audit-only');
const releaseSmoke = process.argv.includes('--release');

run('pnpm', ['--filter', '@repo/db', 'exec', 'tsx', 'scripts/demo-data-audit.ts']);
if (!auditOnly) {
	run('pnpm', ['--filter', 'web', 'exec', 'playwright', 'install', 'chromium']);
	run('pnpm', [
		'--filter',
		'web',
		'test:e2e',
		'--',
		releaseSmoke ? 'release-smoke.spec.ts' : 'demo-smoke.spec.ts',
	]);
}
