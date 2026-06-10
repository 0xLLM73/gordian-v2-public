import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DealsPipelineSummary } from './deals-pipeline-summary';

describe('DealsPipelineSummary', () => {
	beforeEach(() => {
		vi.stubGlobal('React', React);
	});

	it('labels the global pipeline total separately from filtered results', () => {
		const { container } = render(
			React.createElement(DealsPipelineSummary, {
				counts: [
					{ stage: 'discovery', count: 2, totalValue: 500_000 },
					{ stage: 'won', count: 1, totalValue: 750_000 },
				],
			}),
		);

		expect(screen.getByTestId('deals-pipeline-summary')).toBeTruthy();
		expect(container.textContent).toContain('Pipeline total: 3 deals');
		expect(container.textContent).toContain('$12,500');
		expect(container.textContent).toContain('Discovery (2)');
		expect(container.textContent).toContain('Won (1)');
	});
});
