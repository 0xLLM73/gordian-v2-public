import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchInterface } from './search-interface';

const mockListGoalsAction = vi.hoisted(() => vi.fn());
const mockListKnowledgeNodesAction = vi.hoisted(() => vi.fn());
const mockSearchAction = vi.hoisted(() => vi.fn());

vi.mock('@/app/actions/goals', () => ({
	listGoalsAction: mockListGoalsAction,
}));

vi.mock('@/app/actions/knowledge', () => ({
	listKnowledgeNodesAction: mockListKnowledgeNodesAction,
}));

vi.mock('@/app/actions/search', () => ({
	searchAction: mockSearchAction,
}));

vi.mock('next/link', () => ({
	default: ({
		children,
		className,
		href,
	}: {
		children: React.ReactNode;
		className?: string;
		href: string;
	}) => React.createElement('a', { href, className }, children),
}));

describe('SearchInterface', () => {
	beforeEach(() => {
		mockSearchAction.mockResolvedValue({
			data: {
				contacts: [],
				memories: [],
				commitments: [],
				deals: [],
			},
		});
		mockListKnowledgeNodesAction.mockResolvedValue({ data: [] });
		mockListGoalsAction.mockResolvedValue({ data: [] });
	});

	it('submits the trimmed query from the search form', async () => {
		render(React.createElement(SearchInterface));

		fireEvent.change(
			screen.getByPlaceholderText('Search contacts, memories, commitments, deals, goals...'),
			{ target: { value: '  project follow up  ' } },
		);
		fireEvent.click(screen.getByRole('button', { name: 'Search' }));

		await waitFor(() =>
			expect(mockSearchAction).toHaveBeenCalledWith({ query: 'project follow up' }),
		);
		expect(mockListKnowledgeNodesAction).toHaveBeenCalledWith({
			query: 'project follow up',
			limit: 20,
			offset: 0,
		});
	});

	it('shows a category-specific empty state when the selected tab has no matches', async () => {
		mockSearchAction.mockResolvedValueOnce({
			data: {
				contacts: [{ id: 'contact-1', firstName: 'Alice', lastName: 'Ng' }],
				memories: [],
				commitments: [],
				deals: [],
			},
		});

		render(React.createElement(SearchInterface));

		fireEvent.change(
			screen.getByPlaceholderText('Search contacts, memories, commitments, deals, goals...'),
			{ target: { value: 'Alice' } },
		);
		fireEvent.click(screen.getByRole('button', { name: 'Search' }));

		await screen.findByText('Alice Ng');
		fireEvent.click(screen.getByRole('button', { name: 'Deals (0)' }));

		expect(screen.getByText('No deals match “Alice”')).toBeTruthy();
		expect(screen.getByText(/Other categories matched/)).toBeTruthy();
	});
});
