import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DealsEmptyState } from './deals-empty-state';

describe('DealsEmptyState', () => {
	beforeEach(() => {
		vi.stubGlobal('React', React);
	});

	it('shows true empty-pipeline copy when no deals exist', () => {
		const { container } = render(React.createElement(DealsEmptyState));

		expect(screen.getByText('No deals yet.')).toBeTruthy();
		expect(container.textContent).toContain('Click "New Deal" to create one.');
		expect(container.querySelector('a[href="/deals"]')).toBeNull();
	});

	it('shows filtered-empty copy and a clear-filter action when total deals exist', () => {
		const { container } = render(
			React.createElement(DealsEmptyState, {
				stage: 'lost',
				totalDeals: 4,
			}),
		);

		expect(screen.getByText('No lost deals match this filter.')).toBeTruthy();
		expect(container.textContent).toContain('Your pipeline still has 4 deals.');
		expect(container.querySelector('a[href="/deals"]')?.textContent).toBe('Clear filter');
	});

	it('distinguishes unavailable workspace encryption from an empty pipeline', () => {
		const { container } = render(
			React.createElement(DealsEmptyState, {
				reason: 'envelope_unavailable',
			}),
		);

		expect(container.textContent).toContain(
			'Deals are locked until workspace encryption is available.',
		);
		expect(container.textContent).not.toContain('No deals yet.');
	});
});
