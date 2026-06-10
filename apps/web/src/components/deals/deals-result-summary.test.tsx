import { render } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DealsResultSummary } from './deals-result-summary';

describe('DealsResultSummary', () => {
	beforeEach(() => {
		vi.stubGlobal('React', React);
	});

	it('distinguishes matching filtered count from global pipeline count', () => {
		const { container } = render(
			React.createElement(DealsResultSummary, {
				displayedCount: 2,
				totalMatchingCount: 4,
				totalPipelineCount: 11,
				stage: 'negotiation',
				sort: 'highest_value',
			}),
		);

		expect(container.textContent).toContain('Showing 2 of 4 negotiation deals.');
		expect(container.textContent).toContain('Pipeline total: 11 deals');
		expect(container.textContent).toContain('Sorted by highest value.');
	});
});
