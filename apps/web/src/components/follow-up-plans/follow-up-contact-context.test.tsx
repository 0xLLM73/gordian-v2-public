import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FollowUpContactContext } from './follow-up-contact-context';

describe('FollowUpContactContext', () => {
	beforeEach(() => {
		vi.stubGlobal('React', React);
	});

	it('shows the latest local summary and recent imported messages', () => {
		render(
			React.createElement(FollowUpContactContext, {
				contactName: 'Ada Lovelace',
				summary: {
					summary: 'Investor relationship with a warm follow-up preference.',
					messageCount: 42,
					generatedAt: '2026-06-09T12:00:00Z',
				},
				messages: [
					{
						id: 'message-1',
						text: 'Sent the data room.',
						isOutgoing: true,
						sentAt: '2026-06-09T12:00:00Z',
					},
					{
						id: 'message-2',
						text: 'Thanks, I will review it.',
						isOutgoing: false,
						sentAt: '2026-06-09T12:05:00Z',
					},
				],
				messageCount: 42,
				lastMessageAt: '2026-06-09T12:05:00Z',
			}),
		);

		expect(screen.getByText('Contact context')).toBeTruthy();
		expect(screen.getByText('Ada Lovelace')).toBeTruthy();
		expect(screen.getByText('42 summarized messages')).toBeTruthy();
		expect(
			screen.getByText('Investor relationship with a warm follow-up preference.'),
		).toBeTruthy();
		expect(screen.getByText('Sent the data room.')).toBeTruthy();
		expect(screen.getByText('Thanks, I will review it.')).toBeTruthy();
	});

	it('keeps the detail page useful when no local context exists yet', () => {
		render(
			React.createElement(FollowUpContactContext, {
				contactName: null,
				summary: null,
				messages: [],
				messageCount: 0,
				lastMessageAt: null,
			}),
		);

		expect(screen.getByText('Unknown contact')).toBeTruthy();
		expect(
			screen.getByText(
				'No local summary available yet. Drafts can still use the plan prompt and manual edits.',
			),
		).toBeTruthy();
		expect(screen.getByText('No recent imported messages for this contact.')).toBeTruthy();
	});
});
