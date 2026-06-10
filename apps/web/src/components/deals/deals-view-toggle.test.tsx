import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DealsViewToggle } from './deals-view-toggle';

describe('DealsViewToggle', () => {
	beforeEach(() => {
		vi.stubGlobal('React', React);
	});

	it('switches between list and board views', () => {
		render(
			React.createElement(DealsViewToggle, {
				listView: React.createElement('div', null, 'List content'),
				kanbanView: React.createElement('div', null, 'Board content'),
			}),
		);

		expect(screen.getByText('List content')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Board' }));
		expect(screen.getByText('Board content')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'List' }));
		expect(screen.getByText('List content')).toBeTruthy();
	});

	it('renders multi-node view content without console errors', () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

		render(
			React.createElement(DealsViewToggle, {
				listView: [
					React.createElement('div', { key: 'first' }, 'First list child'),
					React.createElement('div', { key: 'second' }, 'Second list child'),
				],
				kanbanView: React.createElement('div', null, 'Board content'),
			}),
		);

		expect(screen.getByText('First list child')).toBeTruthy();
		expect(screen.getByText('Second list child')).toBeTruthy();
		expect(consoleError).not.toHaveBeenCalled();
		consoleError.mockRestore();
	});
});
