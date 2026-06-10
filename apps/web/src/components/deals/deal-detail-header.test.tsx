import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DealDetailHeader } from './deal-detail-header';

describe('DealDetailHeader', () => {
	beforeEach(() => {
		vi.stubGlobal('React', React);
	});

	it('keeps title, metadata, actions, value, and stage in a responsive layout', () => {
		const { container } = render(
			React.createElement(DealDetailHeader, {
				title: 'A very long deal title that should wrap instead of pushing the header wide',
				contactId: 'contact-1',
				contactName: 'A very long contact name',
				dealTypeLabel: 'Partnership',
				createdAtLabel: '2d ago',
				actions: React.createElement('div', null, 'Won'),
				value: 2_000_000_000,
				stage: 'committed',
			}),
		);

		const header = screen.getByTestId('deal-detail-header');
		expect(header.className).toContain('grid');
		expect(header.className).toContain('md:grid-cols-[minmax(0,1fr)_auto]');
		expect(header.className).not.toContain('flex items-center justify-between');
		expect(screen.getByRole('heading', { name: /very long deal title/i })).toBeTruthy();
		expect(container.querySelector('a[href="/contacts/contact-1"]')?.textContent).toContain(
			'A very long contact name',
		);
		expect(container.textContent).toContain('$20,000,000');
		expect(container.textContent).toContain('Committed');
	});
});
