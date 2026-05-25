import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MorningBriefCard } from './morning-brief-card';

vi.stubGlobal('React', React);

vi.mock('@/app/actions/brief', () => ({
	submitBriefFeedbackAction: vi.fn(),
}));

vi.mock('react-markdown', () => ({
	default: ({ children }: { children: React.ReactNode }) =>
		React.createElement('div', null, children),
}));

vi.mock('sonner', () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn(),
	},
}));

describe('MorningBriefCard', () => {
	it('shows setup guidance when no morning brief exists yet', () => {
		render(React.createElement(MorningBriefCard, { brief: null }));

		expect(screen.getByText('No morning brief generated yet.')).toBeTruthy();
		expect(screen.getByText('Enable the brief schedule in Settings.')).toBeTruthy();
		expect(
			screen.getByText('Sync or import enough conversation data for a useful summary.'),
		).toBeTruthy();
		expect(
			screen.getByText('Keep the local worker running at the scheduled brief time.'),
		).toBeTruthy();
	});
});
