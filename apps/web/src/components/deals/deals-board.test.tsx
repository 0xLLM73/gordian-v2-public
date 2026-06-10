import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({
	updateAction: vi.fn(() => Promise.resolve({ data: {} })),
	execute: vi.fn(),
	refresh: vi.fn(),
	confirmCandidateAction: vi.fn(),
	dismissCandidateAction: vi.fn(),
}));

vi.mock('@/app/actions/deals', () => ({
	updateDealAction: actionMocks.updateAction,
}));

vi.mock('@/app/actions/deal-candidates', () => ({
	confirmCandidateAction: actionMocks.confirmCandidateAction,
	dismissCandidateAction: actionMocks.dismissCandidateAction,
}));

vi.mock('next/navigation', () => ({
	useRouter: () => ({ refresh: actionMocks.refresh }),
}));

vi.mock('next-safe-action/hooks', () => ({
	useAction: vi.fn(() => ({ execute: actionMocks.execute, isExecuting: false })),
}));

vi.mock('sonner', () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn(),
	},
}));

describe('DealsKanban', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal('React', React);
	});

	it('renders board cards with stable deal ids and mobile-stacking classes', async () => {
		const { DealsKanban } = await import('./deals-kanban');

		const { container } = render(
			React.createElement(DealsKanban, {
				deals: [
					{
						id: 'deal-1',
						title: 'Diligence Deal',
						stage: 'diligence',
						value: 100_000,
						dealType: 'investment',
						contactFirstName: 'Ari',
						contactLastName: 'Lee',
						stageHistory: [{ stage: 'diligence', timestamp: '2026-06-01T00:00:00.000Z' }],
					},
					{
						id: 'deal-2',
						title: 'Won Deal',
						stage: 'won',
						value: 200_000,
						dealType: 'advisory',
						contactFirstName: 'Morgan',
						contactLastName: 'Stone',
						stageHistory: [{ stage: 'won', timestamp: '2026-06-01T00:00:00.000Z' }],
					},
				],
				ghostCandidates: [
					{
						id: 'candidate-1',
						dealTitleGuess: 'Candidate Deal',
						dealTypeGuess: 'investment',
						contactId: 'contact-1',
						contactName: 'Riley Chen',
						confidence: 0.72,
						signals: [],
						createdAt: '2026-06-09T00:00:00.000Z',
					},
				],
			}),
		);

		const board = screen.getByTestId('deals-board');
		expect(board.className).toContain('grid');
		expect(board.className).toContain('md:flex');
		expect(
			container.querySelector('[data-testid="deal-board-card"][data-deal-id="deal-1"]'),
		).toBeTruthy();
		expect(
			container.querySelector('[data-testid="deal-board-card"][data-deal-id="deal-2"]'),
		).toBeTruthy();
		expect(screen.getAllByRole('link', { name: 'Open' })).toHaveLength(2);
		expect(container.textContent).toContain('Unconfirmed candidates');
		expect(screen.getByLabelText('Move stage for Diligence Deal')).toBeTruthy();
	});
});
