import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');

function read(path: string) {
	return readFileSync(resolve(ROOT, path), 'utf8');
}

describe('deal evidence links contract', () => {
	it('encrypts evidence labels and summaries', () => {
		const schema = read('src/schema/deal-evidence-links.ts');
		const migration = read('drizzle/0072_deal_cockpit.sql');

		expect(schema).toContain("label: encryptedText('label')");
		expect(schema).toContain("summary: encryptedText('summary')");
		expect(schema).toContain("sourceType: text('source_type').notNull()");
		expect(migration).toContain('CREATE TABLE IF NOT EXISTS "deal_evidence_links"');
	});

	it('validates evidence sources inside the caller workspace', () => {
		const dal = read('src/dal/deal-cockpit.ts');

		for (const source of [
			'deal_artifact',
			'deal_stage_event',
			'deal_decision',
			'knowledge_node',
			'knowledge_evidence',
			'message',
			'contact',
			'goal',
			'commitment',
		]) {
			expect(dal).toContain(`${source}: () =>`);
		}
		expect(dal).toContain('assertDecisionInDeal(workspaceId, input.dealId, input.decisionId)');
		expect(dal).toContain('eq(dealArtifacts.dealId, dealId)');
		expect(dal).toContain('eq(knowledgeNodes.workspaceId, workspaceId)');
		expect(dal).toContain('eq(messages.workspaceId, workspaceId)');
	});
});
