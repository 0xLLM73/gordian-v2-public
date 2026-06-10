import { describe, expect, it } from 'vitest';
import { buildDealContextPack, generateDealDraftFollowUp } from '../deal-intelligence';

describe('deal follow-up draft generation', () => {
	it('returns a draft-only output and does not claim Telegram was mutated', async () => {
		const context = buildDealContextPack({
			workspaceId: 'workspace-a',
			deal: {
				id: 'deal-a',
				workspaceId: 'workspace-a',
				title: 'MoveProtocol Seed Extension',
				stage: 'diligence',
				value: 500_000_00,
			},
		});

		const result = await generateDealDraftFollowUp(context, { allowLiveModel: false });

		expect(result.output).toContain('Draft only - not sent');
		expect(result.output).not.toContain('Message sent');
		expect(result.runType).toBe('follow_up_draft');
		expect(result.localVendorMode).toBe('deterministic_fallback');
	});
});
