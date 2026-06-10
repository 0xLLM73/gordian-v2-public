import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

function readRoot(relativePath: string) {
	return readFileSync(join(REPO_ROOT, relativePath), 'utf-8');
}

function dataFixtureText(seed: string) {
	return seed
		.split('\n')
		.filter((line) => !line.includes('.replace('))
		.filter((line) => !line.includes('DATABASE_URL'))
		.join('\n');
}

describe('demo seed data safety', () => {
	const seed = readRoot('scripts/seed.ts');

	it('keeps seeded demo accounts and contacts on reserved demo domains', () => {
		const emails = [...seed.matchAll(/\bemail:\s*'([^']+)'/g)].map((match) => match[1]);
		expect(emails.length).toBeGreaterThan(0);

		for (const email of emails) {
			expect(email, email).toMatch(/@(gordian\.dev|[a-z0-9.-]+\.example)$/);
		}
	});

	it('does not embed raw wallet addresses, API keys, or session strings in fixture content', () => {
		const fixture = dataFixtureText(seed);

		expect(fixture).not.toMatch(/0x[a-fA-F0-9]{40}/);
		expect(fixture).not.toMatch(/\b[A-HJ-NP-Za-km-z1-9]{32,44}\b/);
		expect(fixture).not.toMatch(/\b(sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/);
		expect(fixture).not.toMatch(/\b\d{5,}:[A-Za-z0-9_-]{20,}\b/);
		expect(fixture).not.toMatch(/\b1[A-Za-z0-9+/=_-]{80,}\b/);
	});

	it('guards local demo targets and writes masked memory content for derived data', () => {
		expect(seed).toContain('assertLocalDemoTargets(process.env)');
		expect(seed).toContain('const sanitized = maskContent(m.content)');
		expect(seed).toContain('contentSanitized: sanitized');
		expect(seed).toContain('[ETH_ADDRESS]');
		expect(seed).toContain('[SOL_ADDRESS]');
	});

	it('does not print generated workspace key material in seed output', () => {
		expect(seed).toContain('Dev WRK: generated for local encrypted seed data (value not printed)');
		expect(seed).not.toContain('console.log(`  ${DEV_WRK_BASE64}`)');
	});
});
