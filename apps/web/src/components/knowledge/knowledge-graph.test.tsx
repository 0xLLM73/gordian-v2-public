import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeGraph } from './knowledge-graph';

const mockGetGraphDataAction = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());

vi.stubGlobal('React', React);
vi.stubGlobal(
	'ResizeObserver',
	class {
		observe() {}
		disconnect() {}
	},
);

vi.mock('@/app/actions/knowledge', () => ({
	getGraphDataAction: mockGetGraphDataAction,
}));

vi.mock('next/dynamic', () => ({
	default: () => (props: { graphData: { nodes: unknown[]; links: unknown[] } }) =>
		React.createElement(
			'div',
			{ 'data-testid': 'force-graph' },
			`${props.graphData.nodes.length} nodes, ${props.graphData.links.length} links`,
		),
}));

vi.mock('next/navigation', () => ({
	useRouter: () => ({ push: mockPush }),
}));

describe('KnowledgeGraph', () => {
	beforeEach(() => {
		mockGetGraphDataAction.mockReset();
		mockPush.mockReset();
	});

	it('summarizes connected and isolated graph nodes', async () => {
		mockGetGraphDataAction.mockResolvedValue({
			data: {
				nodes: [
					{
						id: 'node-1',
						name: 'helium',
						displayName: 'Helium',
						type: 'project',
						mentionCount: 4,
					},
					{
						id: 'node-2',
						name: 'depin',
						displayName: 'DePIN',
						type: 'sector',
						mentionCount: 2,
					},
					{
						id: 'node-3',
						name: 'akash',
						displayName: 'Akash',
						type: 'project',
						mentionCount: 1,
					},
				],
				links: [
					{
						sourceNodeId: 'node-1',
						targetNodeId: 'node-2',
						linkType: 'related_to',
						weight: 0.8,
					},
				],
			},
		});

		render(React.createElement(KnowledgeGraph));

		await waitFor(() => {
			expect(screen.getByText('Nodes')).toBeTruthy();
		});
		expect(screen.getByText('Relationships')).toBeTruthy();
		expect(screen.getByText('Connected nodes')).toBeTruthy();
		expect(screen.getByText('Needs relationships')).toBeTruthy();
		expect(screen.getAllByText('3')).toHaveLength(1);
		expect(screen.getAllByText('1')).toHaveLength(2);
		expect(screen.getByText(/Click a node to open its topic/i)).toBeTruthy();
		expect(screen.getByTestId('force-graph').textContent).toBe('3 nodes, 1 links');
	});

	it('guides relationship building when nodes have no links', async () => {
		mockGetGraphDataAction.mockResolvedValue({
			data: {
				nodes: [
					{
						id: 'node-1',
						name: 'helium',
						displayName: 'Helium',
						type: 'project',
						mentionCount: 4,
					},
				],
				links: [],
			},
		});

		render(React.createElement(KnowledgeGraph));

		await waitFor(() => {
			expect(screen.getByText(/No confirmed relationships are stored yet/i)).toBeTruthy();
		});
		expect(screen.getByText('No confirmed relationships yet')).toBeTruthy();
		expect(
			screen.getByText(/embedding matches, co-mentions, and weak\/stale signals/i),
		).toBeTruthy();
		expect(screen.getByTestId('force-graph').textContent).toBe('1 nodes, 0 links');
	});

	it('shows a retryable error state when graph loading fails', async () => {
		mockGetGraphDataAction
			.mockRejectedValueOnce(new Error('network failed'))
			.mockResolvedValueOnce({
				data: {
					nodes: [
						{
							id: 'node-1',
							name: 'helium',
							displayName: 'Helium',
							type: 'project',
							mentionCount: 4,
						},
					],
					links: [],
				},
			});

		render(React.createElement(KnowledgeGraph));

		await waitFor(() => {
			expect(screen.getByText('Unable to load knowledge graph')).toBeTruthy();
		});
		fireEvent.click(screen.getByRole('button', { name: 'Retry graph' }));

		await waitFor(() => {
			expect(screen.getByTestId('force-graph').textContent).toBe('1 nodes, 0 links');
		});
		expect(mockGetGraphDataAction).toHaveBeenCalledTimes(2);
	});
});
