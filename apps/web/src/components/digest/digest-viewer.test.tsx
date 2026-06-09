import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DigestViewer } from './digest-viewer';

vi.mock('@/app/actions/digest', () => ({
	generateDigestAction: vi.fn(),
	listDigestsAction: vi.fn(),
}));

describe('DigestViewer', () => {
	it('shows source coverage percentages for sampled digests', () => {
		render(
			React.createElement(DigestViewer, {
				pastDigests: [
					{
						id: 'digest-1',
						period: 'today',
						periodStart: new Date('2026-06-02T00:00:00Z'),
						periodEnd: new Date('2026-06-02T23:59:59Z'),
						content: null,
						messageCount: 240,
						contactCount: 10,
						generatedAt: new Date('2026-06-02T12:00:00Z'),
						createdAt: new Date('2026-06-02T12:00:00Z'),
						styleVariant: null,
						toneVariant: null,
						sections: {
							activity_overview: {
								summary: 'Busy day across investor conversations.',
								message_count: 240,
								active_conversations: 10,
								new_contacts: 1,
							},
							source_coverage: {
								total_messages: 240,
								sampled_messages: 120,
								total_conversations: 10,
								sampled_conversations: 10,
								prompt_conversations: 8,
								prompt_messages: 60,
								sample_strategy: 'time-spread:6x20',
								message_budget: 240,
								batch_count: 2,
								batch_messages: 60,
								batch_strategy: 'conversation-batches',
							},
							highlights: [],
							key_conversations: [],
							action_items: [],
							watch_list: [],
						},
					},
				],
			}),
		);

		expect(screen.getByText('Messages sampled')).toBeTruthy();
		expect(screen.getByText('Prompt excerpts')).toBeTruthy();
		expect(screen.getByText('Conversations covered')).toBeTruthy();
		expect(screen.getByText('120 / 240')).toBeTruthy();
		expect(screen.getByText('60 / 240')).toBeTruthy();
		expect(screen.getByText('8 / 10')).toBeTruthy();
		expect(
			screen.getByText('Sampled context: some messages were not included in prompt excerpts.'),
		).toBeTruthy();
	});
});
