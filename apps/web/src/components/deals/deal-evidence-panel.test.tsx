import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DealEvidencePanel } from './deal-evidence-panel';

describe('DealEvidencePanel', () => {
	beforeEach(() => {
		vi.stubGlobal('React', React);
	});

	it('renders empty source evidence guidance', () => {
		const { container } = render(React.createElement(DealEvidencePanel, { evidence: [] }));

		expect(screen.getByTestId('deal-evidence-panel')).toBeTruthy();
		expect(container.textContent).toContain('No source evidence linked yet.');
	});

	it('renders linked evidence labels and summaries', () => {
		const { container } = render(
			React.createElement(DealEvidencePanel, {
				evidence: [
					{
						id: 'evidence-1',
						sourceType: 'deal_artifact',
						sourceId: 'artifact-1',
						label: 'Term sheet',
						summary: 'Signed terms are attached',
					},
				],
			}),
		);

		expect(container.textContent).toContain('deal artifact');
		expect(container.textContent).toContain('Term sheet');
		expect(container.textContent).toContain('Signed terms are attached');
	});
});
