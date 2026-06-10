import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DB_SRC = join(__dirname, '..');

function read(relativePath: string) {
	return readFileSync(join(DB_SRC, relativePath), 'utf-8');
}

describe('deal artifact encryption contract', () => {
	it('declares artifact title and URL/reference as encrypted fields', () => {
		const schema = read('schema/deal-artifacts.ts');

		expect(schema).toContain("title: encryptedText('title').notNull()");
		expect(schema).toContain("url: encryptedText('url')");
		expect(schema).not.toContain("title: text('title').notNull()");
		expect(schema).not.toContain("url: text('url')");
	});

	it('requires workspace keys for artifact writes and reads', () => {
		const dal = read('dal/deal-artifacts.ts');

		expect(dal).toContain('envelope: SealedEnvelope');
		expect(dal).toContain('return withKeys(envelope, async () => {');
		expect(dal).toContain('title: input.title');
		expect(dal).toContain('url: input.url || null');
	});

	it('includes deal artifacts in the workspace-key backfill script', () => {
		const backfill = read('scripts/encrypt-backfill.ts');

		expect(backfill).toContain("table: 'deal_artifacts'");
		expect(backfill).toContain("columns: ['title', 'url']");
	});
});
