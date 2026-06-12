import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DigestViewer } from './digest-viewer';

const mockGenerateDigestAction = vi.hoisted(() => vi.fn());
const mockListDigestsAction = vi.hoisted(() => vi.fn());

vi.mock('@/app/actions/digest', () => ({
	generateDigestAction: mockGenerateDigestAction,
	listDigestsAction: mockListDigestsAction,
}));

describe('DigestViewer', () => {
	beforeEach(() => {
		mockGenerateDigestAction.mockReset();
		mockListDigestsAction.mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

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

	it('keeps polling until a slow generated digest becomes visible', async () => {
		vi.useFakeTimers();
		mockGenerateDigestAction.mockResolvedValue({ data: { queued: true, period: 'week' } });
		mockListDigestsAction.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({
			data: [
				{
					id: 'digest-ready',
					period: 'week',
					periodStart: new Date('2026-06-01T00:00:00Z'),
					periodEnd: new Date('2026-06-08T00:00:00Z'),
					content: null,
					messageCount: 120,
					contactCount: 8,
					generatedAt: new Date('2026-06-08T12:00:00Z'),
					createdAt: new Date('2026-06-08T12:00:00Z'),
					styleVariant: null,
					toneVariant: null,
					sections: {
						activity_overview: {
							summary: 'Digest is ready after a slow local model run.',
							message_count: 120,
							active_conversations: 8,
							new_contacts: 0,
						},
						source_coverage: {
							total_messages: 120,
							sampled_messages: 120,
							total_conversations: 8,
							sampled_conversations: 8,
							prompt_conversations: 8,
							prompt_messages: 60,
							sample_strategy: 'time-spread:3x20',
							message_budget: 240,
						},
						highlights: [],
						key_conversations: [],
						action_items: [],
						watch_list: [],
					},
				},
			],
		});

		render(React.createElement(DigestViewer, { pastDigests: [] }));
		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: 'Generate Digest' }));
		});

		expect(mockGenerateDigestAction).toHaveBeenCalledWith({ period: 'today' });
		expect(screen.getByRole('button', { name: 'Generating...' })).toBeTruthy();

		await act(async () => {
			vi.advanceTimersByTime(5000);
			await Promise.resolve();
		});
		expect(mockListDigestsAction).toHaveBeenCalledTimes(1);
		expect(screen.getByRole('button', { name: 'Generating...' })).toBeTruthy();

		await act(async () => {
			vi.advanceTimersByTime(5000);
			await Promise.resolve();
		});

		expect(mockListDigestsAction).toHaveBeenCalledTimes(2);
		expect(screen.getByText('Digest is ready after a slow local model run.')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Generate Digest' })).toBeTruthy();
	});
});
