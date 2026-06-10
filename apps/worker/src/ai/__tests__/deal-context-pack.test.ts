import { describe, expect, it } from 'vitest';
import { buildDealContextPack } from '../deal-intelligence';

const workspaceId = 'workspace-a';
const dealId = 'deal-a';

describe('deal context pack', () => {
	it('builds a source manifest from authorized local deal sources', () => {
		const context = buildDealContextPack({
			workspaceId,
			deal: {
				id: dealId,
				workspaceId,
				title: 'Aptos Series A',
				stage: 'diligence',
				value: 2_000_000_00,
				updatedAt: new Date('2026-06-09T12:00:00Z'),
			},
			participants: [
				{ id: 'participant-1', workspaceId, dealId, contactId: 'contact-1', role: 'lead' },
			],
			artifacts: [
				{
					id: 'artifact-1',
					workspaceId,
					dealId,
					title: 'Encrypted SAFT',
					artifactType: 'saft',
				},
			],
			stageEvents: [
				{
					id: 'event-1',
					workspaceId,
					dealId,
					previousStage: 'discovery',
					nextStage: 'diligence',
					note: 'Positive first call',
				},
			],
			evidenceLinks: [
				{
					id: 'evidence-1',
					workspaceId,
					dealId,
					sourceType: 'deal_artifact',
					sourceId: 'artifact-1',
					label: 'SAFT',
					summary: 'Terms are attached.',
				},
			],
		});

		expect(context.sourceManifest.map((source) => source.type)).toEqual([
			'deal',
			'deal_participant',
			'deal_artifact',
			'deal_stage_event',
			'deal_artifact',
		]);
		expect(context.metrics).toEqual({
			participants: 1,
			artifacts: 1,
			evidence: 1,
			stageEvents: 1,
		});
		expect(context.risks).toContain('High-value deal needs explicit evidence review.');
	});

	it('rejects sources from another workspace or deal', () => {
		expect(() =>
			buildDealContextPack({
				workspaceId,
				deal: { id: dealId, workspaceId, title: 'Deal', stage: 'discovery', value: 0 },
				artifacts: [
					{
						id: 'artifact-2',
						workspaceId: 'workspace-b',
						dealId,
						title: 'Cross workspace',
					},
				],
			}),
		).toThrow('Artifact belongs to another workspace');

		expect(() =>
			buildDealContextPack({
				workspaceId,
				deal: { id: dealId, workspaceId, title: 'Deal', stage: 'discovery', value: 0 },
				stageEvents: [
					{
						id: 'event-2',
						workspaceId,
						dealId: 'deal-b',
						nextStage: 'diligence',
					},
				],
			}),
		).toThrow('Stage event belongs to another deal');
	});
});
