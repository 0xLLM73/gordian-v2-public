import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactReplyPauseNotice, findContactReplyPauseEvent } from './contact-reply-pause-notice';

describe('ContactReplyPauseNotice', () => {
	beforeEach(() => {
		vi.stubGlobal('React', React);
	});

	it('explains that a paused plan stopped because the contact replied', () => {
		render(
			React.createElement(ContactReplyPauseNotice, {
				planStatus: 'paused',
				contactName: 'Ada Lovelace',
				activityEvents: [
					{
						eventType: 'draft_copied',
						summary: 'Draft copied.',
						metadata: {},
						createdAt: '2026-06-09T11:00:00Z',
					},
					{
						eventType: 'plan_paused',
						summary: 'Plan paused because the contact replied.',
						metadata: { reason: 'contact_replied' },
						createdAt: '2026-06-09T12:00:00Z',
					},
				],
			}),
		);

		expect(screen.getByText('Contact replied')).toBeTruthy();
		expect(screen.getByText('Plan paused because Ada Lovelace replied.')).toBeTruthy();
		expect(
			screen.getByText(
				'Review the latest local messages before resuming. Paused plans do not generate new drafts, and no message has been sent automatically.',
			),
		).toBeTruthy();
		expect(screen.getByText('Plan paused because the contact replied.')).toBeTruthy();
	});

	it('stays hidden for active plans even if old contact-reply activity exists', () => {
		const { container } = render(
			React.createElement(ContactReplyPauseNotice, {
				planStatus: 'active',
				contactName: 'Ada Lovelace',
				activityEvents: [
					{
						eventType: 'plan_paused',
						summary: 'Plan paused because the contact replied.',
						metadata: { reason: 'contact_replied' },
						createdAt: '2026-06-09T12:00:00Z',
					},
				],
			}),
		);

		expect(container.textContent).toBe('');
	});

	it('ignores pause events that were not caused by a contact reply', () => {
		const { container } = render(
			React.createElement(ContactReplyPauseNotice, {
				planStatus: 'paused',
				contactName: null,
				activityEvents: [
					{
						eventType: 'plan_paused',
						summary: 'Plan paused manually.',
						metadata: { reason: 'manual' },
						createdAt: '2026-06-09T12:00:00Z',
					},
				],
			}),
		);

		expect(container.textContent).toBe('');
	});
});

describe('findContactReplyPauseEvent', () => {
	it('returns the first contact-reply pause from a newest-first activity list', () => {
		const event = findContactReplyPauseEvent([
			{
				eventType: 'plan_paused',
				summary: 'Latest contact reply pause.',
				metadata: { reason: 'contact_replied' },
			},
			{
				eventType: 'plan_paused',
				summary: 'Older contact reply pause.',
				metadata: { reason: 'contact_replied' },
			},
		]);

		expect(event?.summary).toBe('Latest contact reply pause.');
	});
});
