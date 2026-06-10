import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(join(__dirname, '..', 'schema', 'deal-artifacts.ts'), 'utf-8');

describe('deal artifact blind-index policy', () => {
	it('does not add artifact title or URL blind indexes without an approved exact lookup need', () => {
		expect(schema).not.toContain('titleBlindIndex');
		expect(schema).not.toContain('urlBlindIndex');
		expect(schema).not.toContain("index('deal_artifacts_title");
		expect(schema).not.toContain("index('deal_artifacts_url");
	});

	it('keeps only structural artifact indexes', () => {
		expect(schema).toContain("index('deal_artifacts_deal_idx').on(table.dealId)");
		expect(schema).toContain("index('deal_artifacts_type_idx').on(table.artifactType)");
	});
});
