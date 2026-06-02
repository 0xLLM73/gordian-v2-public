import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactSearch } from './contact-search';

const mockSearchContactsAction = vi.hoisted(() => vi.fn());

vi.stubGlobal('React', React);

vi.mock('@/app/actions/contacts', () => ({
	searchContactsAction: mockSearchContactsAction,
}));

vi.mock('next/link', () => ({
	default: ({
		children,
		href,
		onClick,
	}: {
		children: React.ReactNode;
		href: string;
		onClick?: () => void;
	}) => React.createElement('a', { href, onClick }, children),
}));

describe('ContactSearch', () => {
	beforeEach(() => {
		mockSearchContactsAction.mockReset();
		mockSearchContactsAction.mockResolvedValue({ data: [] });
	});

	it('trims contact search queries before submitting', async () => {
		render(React.createElement(ContactSearch));

		fireEvent.change(screen.getByPlaceholderText('Search contacts...'), {
			target: { value: '  Alice  ' },
		});

		await waitFor(() =>
			expect(mockSearchContactsAction).toHaveBeenCalledWith({
				query: 'Alice',
				field: 'name',
			}),
		);
	});

	it('does not submit whitespace-only contact searches', () => {
		render(React.createElement(ContactSearch));

		fireEvent.change(screen.getByPlaceholderText('Search contacts...'), {
			target: { value: '   ' },
		});

		expect(mockSearchContactsAction).not.toHaveBeenCalled();
	});
});
