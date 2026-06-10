import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DealRow } from './deal-row';

describe('DealRow', () => {
	beforeEach(() => {
		vi.stubGlobal('React', React);
	});

	it('uses a responsive grid instead of a single non-wrapping row', () => {
		const { container } = render(
			React.createElement(DealRow, {
				dealId: 'deal-1',
				titleControl: React.createElement(
					'button',
					{ type: 'button' },
					'A very long deal title that should be allowed to wrap on small screens',
				),
				contactName: 'A very long contact name that should also wrap',
				dealTypeLabel: 'Investment',
				actions: React.createElement('div', null, 'Advance'),
				value: 2_000_000_000,
				stage: 'negotiation',
			}),
		);

		const row = screen.getByTestId('deal-row');
		expect(row.className).toContain('grid');
		expect(row.className).toContain('sm:grid-cols-[minmax(0,1fr)_auto]');
		expect(row.className).not.toContain('flex items-center justify-between');
		expect(container.querySelector('a[href="/deals/deal-1"]')?.textContent).toContain(
			'A very long contact name',
		);
		expect(container.textContent).toContain('$20,000,000');
		expect(container.textContent).toContain('Negotiation');
	});
});
