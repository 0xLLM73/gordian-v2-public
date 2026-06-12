import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDealsHref, DealsActiveFilters } from './deals-active-filters';

describe('DealsActiveFilters', () => {
	beforeEach(() => {
		vi.stubGlobal('React', React);
	});

	it('builds canonical deal links without empty query strings', () => {
		expect(buildDealsHref()).toBe('/deals');
		expect(buildDealsHref({ stage: 'won' })).toBe('/deals?stage=won');
		expect(buildDealsHref({ sort: 'highest_value' })).toBe('/deals?sort=highest_value');
		expect(buildDealsHref({ stage: 'lost', sort: 'newest' })).toBe('/deals?stage=lost&sort=newest');
	});

	it('shows clearable chips for active stage and non-default sort', () => {
		const { container } = render(
			React.createElement(DealsActiveFilters, {
				stage: 'diligence',
				sort: 'highest_value',
			}),
		);

		expect(screen.getByTestId('deals-active-filters')).toBeTruthy();
		expect(container.textContent).toContain('Stage: Diligence');
		expect(container.textContent).toContain('Sort: Highest value');
		expect(container.querySelector('a[href="/deals?sort=highest_value"]')?.textContent).toContain(
			'Stage: Diligence',
		);
		expect(container.querySelector('a[href="/deals"]')?.textContent).toBe('Clear all');
	});
});
