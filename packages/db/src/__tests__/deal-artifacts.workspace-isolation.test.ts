import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dal = readFileSync(join(__dirname, '..', 'dal', 'deal-artifacts.ts'), 'utf-8');

describe('deal artifact workspace isolation contract', () => {
	it('verifies the parent deal belongs to the workspace before insert', () => {
		expect(dal).toContain('eq(deals.id, input.dealId)');
		expect(dal).toContain('eq(deals.workspaceId, workspaceId)');
		expect(dal).toContain("if (!deal) throw new Error('Not found')");
	});

	it('scopes artifact list and remove operations to workspace id', () => {
		expect(dal).toContain('eq(dealArtifacts.workspaceId, workspaceId)');
		expect(dal).toContain('eq(dealArtifacts.dealId, dealId)');
		expect(dal).toContain('eq(dealArtifacts.id, artifactId)');
	});
});
