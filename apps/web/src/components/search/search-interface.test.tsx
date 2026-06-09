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

	it('shows search provenance when semantic metadata is returned', async () => {
		mockSearchAction.mockResolvedValueOnce({
			data: {
				contacts: [],
				memories: [
					{
						id: 'memory-1',
						content: 'Alice mentioned the seed round',
						category: 'note',
						rrf_score: 0.72,
					},
				],
				commitments: [],
				deals: [],
				meta: {
					queryLength: 32,
					embedding: {
						enabled: true,
						used: true,
						providerMode: 'local',
						providerLabel: 'Nomic local embeddings',
						model: 'nomic-embed-text',
						dimensions: 512,
						queryMasked: true,
					},
					sources: {
						contacts: 'Encrypted exact/name search',
						memories: 'Hybrid semantic + text search',
						commitments: 'Semantic vector + encrypted-text fallback',
						deals: 'Encrypted exact title search',
						knowledge: 'Evidence-backed knowledge search runs separately',
						goals: 'Title search runs separately',
					},
				},
			},
		});

		render(React.createElement(SearchInterface));

		fireEvent.change(
			screen.getByPlaceholderText('Search contacts, memories, commitments, deals, goals...'),
			{ target: { value: 'seed round follow up with Alice' } },
		);
		fireEvent.click(screen.getByRole('button', { name: 'Search' }));

		await screen.findByText('Nomic local embeddings, 512d');
		expect(screen.getByText('Query masked before embeddings')).toBeTruthy();
		expect(
			screen.getByText(/Commitments: Semantic vector \+ encrypted-text fallback/),
		).toBeTruthy();
	});
});
