import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');

function read(path: string) {
	return readFileSync(resolve(ROOT, path), 'utf8');
}

describe('deal decisions contract', () => {
	it('keeps deal decision label and rationale encrypted', () => {
		const schema = read('src/schema/deal-decisions.ts');
		const migration = read('drizzle/0072_deal_cockpit.sql');

		expect(schema).toContain("label: encryptedText('label').notNull()");
		expect(schema).toContain("rationale: encryptedText('rationale')");
		expect(schema).toContain("workspaceId: uuid('workspace_id')");
		expect(schema).toContain("dealId: uuid('deal_id')");
		expect(migration).toContain('CREATE TABLE IF NOT EXISTS "deal_decisions"');
	});

	it('lists decision entries with linked evidence', () => {
		const dal = read('src/dal/deal-cockpit.ts');

		expect(dal).toContain('listDealDecisionsWithEvidence');
		expect(dal).toContain('evidenceByDecision');
		expect(dal).toContain('decisionId');
		expect(dal).toContain('assertDealInWorkspace(workspaceId, dealId)');
	});
});
