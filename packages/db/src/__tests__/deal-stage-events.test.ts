import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');

function read(path: string) {
	return readFileSync(resolve(ROOT, path), 'utf8');
}

describe('deal stage events contract', () => {
	it('stores stage notes as encrypted durable events', () => {
		const schema = read('src/schema/deal-stage-events.ts');
		const migration = read('drizzle/0072_deal_cockpit.sql');

		expect(schema).toContain("pgTable(\n\t'deal_stage_events'");
		expect(schema).toContain("note: encryptedText('note')");
		expect(schema).toContain("previousStage: dealStageEnum('previous_stage')");
		expect(schema).toContain("nextStage: dealStageEnum('next_stage').notNull()");
		expect(migration).toContain('CREATE TABLE IF NOT EXISTS "deal_stage_events"');
	});

	it('writes stage event and current stage update transactionally', () => {
		const dal = read('src/dal/deals.ts');

		expect(dal).toContain('db.transaction');
		expect(dal).toMatch(/tx\s*\.\s*update\(deals\)/);
		expect(dal).toMatch(/tx\s*\.\s*insert\(dealStageEvents\)/);
		expect(dal).toMatch(/previousStage:\s*current\.stage/);
		expect(dal).toContain('note: stageNote || null');
	});
});
