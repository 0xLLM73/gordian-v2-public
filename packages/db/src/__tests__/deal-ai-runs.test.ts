import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DB_SRC = join(__dirname, '..');

function read(relativePath: string) {
	return readFileSync(join(DB_SRC, relativePath), 'utf-8');
}

describe('deal AI runs contract', () => {
	it('stores saved local AI output, uncertainty, and source manifest as encrypted fields', () => {
		const schema = read('schema/deal-ai-runs.ts');
		const migration = read('../drizzle/0073_deal_ai_runs.sql');

		expect(schema).toContain("output: encryptedText('output').notNull()");
		expect(schema).toContain("uncertainty: encryptedText('uncertainty')");
		expect(schema).toContain("sourceManifest: encryptedJson('source_manifest')");
		expect(migration).toContain('CREATE TABLE IF NOT EXISTS "deal_ai_runs"');
		expect(migration).toContain('COMMENT ON COLUMN "deal_ai_runs"."output"');
		expect(migration).toContain('COMMENT ON COLUMN "deal_ai_runs"."source_manifest"');
	});

	it('requires workspace keys and verifies the parent deal before saving or listing', () => {
		const dal = read('dal/deal-ai-runs.ts');

		expect(dal).toContain('envelope: SealedEnvelope');
		expect(dal).toContain('return withKeys(envelope, async () => {');
		expect(dal).toContain('await assertDealInWorkspace(workspaceId, input.dealId)');
		expect(dal).toContain('await assertDealInWorkspace(workspaceId, dealId)');
		expect(dal).toContain("if (!deal) throw new Error('Not found')");
	});

	it('keeps acceptance and dismissal explicit status updates only', () => {
		const dal = read('dal/deal-ai-runs.ts');

		expect(dal).toContain("export type DealAiRunStatus = 'draft' | 'accepted' | 'dismissed'");
		expect(dal).toContain("acceptedAt: status === 'accepted' ? sql`now()` : undefined");
		expect(dal).toContain("dismissedAt: status === 'dismissed' ? sql`now()` : undefined");
		expect(dal).toContain('returning({');
		expect(dal).not.toContain('createCommitment');
		expect(dal).not.toContain('updateDeal(');
	});
});
