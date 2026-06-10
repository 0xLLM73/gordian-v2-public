import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DB_SRC = join(__dirname, '..');

function read(relativePath: string) {
	return readFileSync(join(DB_SRC, relativePath), 'utf-8');
}

describe('deal privacy regression contracts', () => {
	it('keeps sensitive deal extension fields encrypted in schema', () => {
		const artifacts = read('schema/deal-artifacts.ts');
		const stageEvents = read('schema/deal-stage-events.ts');
		const decisions = read('schema/deal-decisions.ts');
		const evidence = read('schema/deal-evidence-links.ts');
		const aiRuns = read('schema/deal-ai-runs.ts');

		expect(artifacts).toContain("title: encryptedText('title').notNull()");
		expect(artifacts).toContain("url: encryptedText('url')");
		expect(stageEvents).toContain("note: encryptedText('note')");
		expect(decisions).toContain("label: encryptedText('label').notNull()");
		expect(decisions).toContain("rationale: encryptedText('rationale')");
		expect(evidence).toContain("label: encryptedText('label')");
		expect(evidence).toContain("summary: encryptedText('summary')");
		expect(aiRuns).toContain("output: encryptedText('output').notNull()");
		expect(aiRuns).toContain("uncertainty: encryptedText('uncertainty')");
		expect(aiRuns).toContain("sourceManifest: encryptedJson('source_manifest')");
	});

	it('routes reads and writes of sensitive deal extensions through workspace envelope keys', () => {
		const files = [
			read('dal/deal-artifacts.ts'),
			read('dal/deal-cockpit.ts'),
			read('dal/deal-ai-runs.ts'),
		];

		for (const file of files) {
			expect(file).toContain('envelope: SealedEnvelope');
			expect(file).toContain('withKeys(envelope');
			expect(file).toContain("throw new Error('Not found')");
		}
	});

	it('does not add raw SQL bypasses for deal encrypted fields in DAL code', () => {
		const dealDalFiles = [
			'deal-artifacts.ts',
			'deal-cockpit.ts',
			'deal-ai-runs.ts',
			'deals.ts',
		].map((file) => read(`dal/${file}`));

		for (const content of dealDalFiles) {
			expect(content).not.toContain('db.execute');
			expect(content).not.toContain('sql.raw');
		}
	});
});
