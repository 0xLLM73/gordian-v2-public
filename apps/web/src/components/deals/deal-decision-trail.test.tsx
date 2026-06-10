import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DealDecisionTrailPanel } from './deal-decision-trail';

describe('DealDecisionTrailPanel', () => {
	beforeEach(() => {
		vi.stubGlobal('React', React);
	});

	it('renders deal decisions with linked evidence counts', () => {
		const { container } = render(
			React.createElement(DealDecisionTrailPanel, {
				decisions: [
					{
						id: 'decision-1',
						decisionType: 'stage_change',
						sourceType: 'manual',
						status: 'accepted',
						label: 'Advance to diligence',
						rationale: 'Partner asked for deeper review',
						decidedAt: '2026-06-09T12:00:00.000Z',
						evidence: [{ id: 'evidence-1', label: 'Partner call', sourceType: 'manual_note' }],
					},
				],
			}),
		);

		expect(screen.getByTestId('deal-decision-trail')).toBeTruthy();
		expect(container.textContent).toContain('Advance to diligence');
		expect(container.textContent).toContain('1 linked evidence source');
	});

	it('keeps an empty decision trail visible', () => {
		const { container } = render(
			React.createElement(DealDecisionTrailPanel, {
				decisions: [],
				knowledgeTrail: [],
			}),
		);

		expect(container.textContent).toContain('No decisions recorded yet.');
	});
});
