import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DealsFilter } from './deals-filter';

const navigationMocks = vi.hoisted(() => ({
	push: vi.fn(),
	searchParams: 'sort=highest_value',
}));

vi.mock('next/navigation', () => ({
	usePathname: () => '/deals',
	useRouter: () => ({ push: navigationMocks.push }),
	useSearchParams: () => new URLSearchParams(navigationMocks.searchParams),
}));

describe('DealsFilter', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal('React', React);
		navigationMocks.searchParams = 'sort=highest_value';
	});

	it('preserves existing sort params when applying a stage filter', () => {
		render(React.createElement(DealsFilter, { workspaceId: 'workspace-1' }));

		fireEvent.click(screen.getByRole('button', { name: 'Diligence' }));

		expect(navigationMocks.push).toHaveBeenCalledWith('/deals?sort=highest_value&stage=diligence');
		expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
	});

	it('removes stage without leaving an empty query string', () => {
		navigationMocks.searchParams = 'stage=lost';
		render(React.createElement(DealsFilter, { workspaceId: 'workspace-1' }));

		fireEvent.click(screen.getByRole('button', { name: 'All' }));

		expect(navigationMocks.push).toHaveBeenCalledWith('/deals');
	});
});
