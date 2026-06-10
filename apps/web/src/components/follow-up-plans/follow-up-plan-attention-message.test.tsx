import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FollowUpPlanAttentionMessage } from './follow-up-plan-attention-message';

describe('FollowUpPlanAttentionMessage', () => {
	beforeEach(() => {
		vi.stubGlobal('React', React);
	});

	it('explains overdue due steps as waiting for the local worker without sending', () => {
		render(
			React.createElement(FollowUpPlanAttentionMessage, {
				attention: {
					status: 'overdue',
					label: 'Due now',
					detail: 'Waiting for the local worker to generate a review draft.',
					tone: 'warn',
				},
			}),
		);

		expect(
			screen.getByText(
				'Due now: Waiting for the local worker to generate a review draft. Draft not sent.',
			),
		).toBeTruthy();
	});

	it('explains blocked local generation as retryable and unsent', () => {
		render(
			React.createElement(FollowUpPlanAttentionMessage, {
				attention: {
					status: 'blocked',
					label: 'Local AI blocked',
					detail: 'local AI unavailable Retryable when the local worker runs.',
					tone: 'danger',
				},
			}),
		);

		expect(
			screen.getByText(
				'Local AI blocked: local AI unavailable Retryable when the local worker runs. Draft not sent.',
			),
		).toBeTruthy();
	});

	it('stays hidden for ordinary scheduled work', () => {
		const { container } = render(
			React.createElement(FollowUpPlanAttentionMessage, {
				attention: {
					status: 'scheduled',
					label: 'Scheduled 6/10/2026',
					detail: 'No draft will be generated until this step is due.',
					tone: 'neutral',
				},
			}),
		);

		expect(container.textContent).toBe('');
	});
});
