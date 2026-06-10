import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DRIZZLE_DIR = join(__dirname, '..', '..', 'drizzle');

function readMigration(name: string) {
	return readFileSync(join(DRIZZLE_DIR, name), 'utf-8');
}

describe('deal migration regression coverage', () => {
	it('keeps deal privacy/cockpit/local-AI migrations additive and ordered', () => {
		const migrations = readdirSync(DRIZZLE_DIR);

		expect(migrations).toContain('0071_deal_artifact_privacy.sql');
		expect(migrations).toContain('0072_deal_cockpit.sql');
		expect(migrations).toContain('0073_deal_ai_runs.sql');
		expect(migrations).toContain('0074_deal_ai_run_source_manifest_privacy.sql');
		expect(
			migrations.filter((name) => name.startsWith('007') && name.includes('deal')).sort(),
		).toEqual([
			'0071_deal_artifact_privacy.sql',
			'0072_deal_cockpit.sql',
			'0073_deal_ai_runs.sql',
			'0074_deal_ai_run_source_manifest_privacy.sql',
		]);
	});

	it('creates only additive deal cockpit and local AI tables/indexes', () => {
		const cockpit = readMigration('0072_deal_cockpit.sql');
		const aiRuns = readMigration('0073_deal_ai_runs.sql');
		const combined = `${cockpit}\n${aiRuns}`.toLowerCase();

		expect(cockpit).toContain('CREATE TABLE IF NOT EXISTS "deal_stage_events"');
		expect(cockpit).toContain('CREATE TABLE IF NOT EXISTS "deal_decisions"');
		expect(cockpit).toContain('CREATE TABLE IF NOT EXISTS "deal_evidence_links"');
		expect(aiRuns).toContain('CREATE TABLE IF NOT EXISTS "deal_ai_runs"');
		expect(aiRuns).toContain('"source_manifest" text NOT NULL');
		expect(combined).not.toMatch(/\bdrop\s+table\b/);
		expect(combined).not.toMatch(/\bdrop\s+column\b/);
		expect(combined).not.toMatch(/\bdelete\s+from\b/);
		expect(combined).not.toMatch(/\btruncate\b/);
	});

	it('documents encrypted deal columns added by the privacy migrations', () => {
		const privacy = readMigration('0071_deal_artifact_privacy.sql');
		const cockpit = readMigration('0072_deal_cockpit.sql');
		const aiRuns = readMigration('0073_deal_ai_runs.sql');

		expect(privacy).toContain('deal_artifacts');
		expect(privacy).toContain('deal_artifact_sensitive');
		expect(cockpit).toContain('COMMENT ON COLUMN "deal_stage_events"."note"');
		expect(cockpit).toContain('COMMENT ON COLUMN "deal_evidence_links"."summary"');
		expect(aiRuns).toContain('COMMENT ON COLUMN "deal_ai_runs"."output"');
		expect(aiRuns).toContain('COMMENT ON COLUMN "deal_ai_runs"."uncertainty"');
		expect(aiRuns).toContain('COMMENT ON COLUMN "deal_ai_runs"."source_manifest"');
	});
});
