import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DealsSort } from './deals-sort';

const navigationMocks = vi.hoisted(() => ({
	push: vi.fn(),
	searchParams: 'stage=won',
}));

vi.mock('next/navigation', () => ({
	usePathname: () => '/deals',
	useRouter: () => ({ push: navigationMocks.push }),
	useSearchParams: () => new URLSearchParams(navigationMocks.searchParams),
}));

describe('DealsSort', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal('React', React);
		navigationMocks.searchParams = 'stage=won';
	});

	it('preserves the stage filter when changing sort', () => {
		render(React.createElement(DealsSort));

		fireEvent.change(screen.getByLabelText('Sort deals'), {
			target: { value: 'highest_value' },
		});

		expect(navigationMocks.push).toHaveBeenCalledWith('/deals?stage=won&sort=highest_value');
	});

	it('removes default sort without leaving an empty query string', () => {
		navigationMocks.searchParams = 'sort=highest_value';
		render(React.createElement(DealsSort));

		fireEvent.change(screen.getByLabelText('Sort deals'), {
			target: { value: 'last_activity' },
		});

		expect(navigationMocks.push).toHaveBeenCalledWith('/deals');
	});
});
