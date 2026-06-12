import fs from 'node:fs';
import path from 'node:path';
import { chromium, type FullConfig } from '@playwright/test';

// Load app and repo-root env files so seeded demo credentials work from pnpm commands.
const envLocalPaths = [
	path.resolve(process.cwd(), '.env.local'),
	path.resolve(process.cwd(), '../../.env.local'),
];
for (const envLocalPath of envLocalPaths) {
	if (!fs.existsSync(envLocalPath)) continue;
	for (const line of fs.readFileSync(envLocalPath, 'utf-8').split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq === -1) continue;
		const key = trimmed.slice(0, eq).trim();
		const val = trimmed
			.slice(eq + 1)
			.trim()
			.replace(/^["']|["']$/g, '');
		if (!(key in process.env)) process.env[key] = val;
	}
}

// Relative to apps/web/ (where playwright.config.ts lives)
export const AUTH_FILE = path.resolve(process.cwd(), 'e2e/fixtures/.auth/session.json');

export default async function globalSetup(config: FullConfig) {
	const baseURL = config.projects[0].use.baseURL ?? 'http://localhost:3456';

	const email = process.env.E2E_EMAIL ?? 'alice@gordian.dev';
	const password = process.env.E2E_PASSWORD ?? process.env.SEED_PASSWORD ?? 'gordian-demo';
	if (!email || !password) {
		throw new Error('E2E_EMAIL and E2E_PASSWORD must be set, or run pnpm seed:demo first.');
	}

	// Ensure .auth directory exists
	fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });

	const browser = await chromium.launch();
	const context = await browser.newContext();

	// Sign in via Better Auth REST API — more reliable than UI for global setup
	const res = await context.request.post(`${baseURL}/api/auth/sign-in/email`, {
		data: { email, password },
		headers: { 'Content-Type': 'application/json' },
	});

	if (!res.ok()) {
		const body = await res.text();
		throw new Error(`Login failed (${res.status()}): ${body.slice(0, 200)}`);
	}

	// Save session cookies for reuse across tests
	await context.storageState({ path: AUTH_FILE });
	await browser.close();
}
