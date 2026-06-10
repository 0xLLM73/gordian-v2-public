import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DealStageTimeline } from './deal-stage-timeline';

describe('DealStageTimeline', () => {
	beforeEach(() => {
		vi.stubGlobal('React', React);
	});

	it('prefers durable stage events and renders notes', () => {
		const { container } = render(
			React.createElement(DealStageTimeline, {
				events: [
					{
						id: 'event-1',
						previousStage: 'discovery',
						nextStage: 'diligence',
						note: 'Moved after partner call',
						source: 'manual',
						occurredAt: '2026-06-09T12:00:00.000Z',
					},
				],
				stageHistory: [{ stage: 'discovery', timestamp: '2026-06-01T00:00:00.000Z' }],
			}),
		);

		expect(screen.getByTestId('deal-stage-timeline')).toBeTruthy();
		expect(container.textContent).toContain('Durable events');
		expect(container.textContent).toContain('Discovery -> Diligence');
		expect(container.textContent).toContain('Moved after partner call');
	});

	it('falls back to legacy stage history when events are absent', () => {
		const { container } = render(
			React.createElement(DealStageTimeline, {
				events: [],
				stageHistory: [{ stage: 'discovery', timestamp: '2026-06-01T00:00:00.000Z' }],
			}),
		);

		expect(container.textContent).toContain('Legacy history');
		expect(container.textContent).toContain('Discovery');
	});
});
