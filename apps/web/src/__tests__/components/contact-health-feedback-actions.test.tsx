import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRecordContactHealthFeedbackAction = vi.fn(() =>
	Promise.resolve({ data: { id: 'fb-1' } }),
);
const mockRefresh = vi.fn();
const callMockRecordContactHealthFeedbackAction =
	mockRecordContactHealthFeedbackAction as unknown as (input: unknown) => unknown;

vi.stubGlobal('React', React);

vi.mock('@/app/actions/contact-health-feedback', () => ({
	recordContactHealthFeedbackAction: (input: unknown) =>
		callMockRecordContactHealthFeedbackAction(input),
}));

vi.mock('next/navigation', () => ({
	useRouter: () => ({ refresh: mockRefresh }),
}));

vi.mock('sonner', () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn(),
	},
}));

describe('ContactHealthFeedbackActions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('records structured feedback and refreshes the page', async () => {
		const { ContactHealthFeedbackActions } = await import(
			'@/components/contact-health-feedback-actions'
		);

		render(
			<ContactHealthFeedbackActions
				contactId="550e8400-e29b-41d4-a716-446655440001"
				statusReasonCode="gap_longer_than_usual"
				actions={['mark_low_touch']}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Low-touch' }));

		await waitFor(() => {
			expect(mockRecordContactHealthFeedbackAction).toHaveBeenCalledWith({
				contactId: '550e8400-e29b-41d4-a716-446655440001',
				action: 'mark_low_touch',
				statusReasonCode: 'gap_longer_than_usual',
			});
		});
		expect(mockRefresh).toHaveBeenCalledTimes(1);
		expect(screen.getByText('Marked low-touch')).toBeTruthy();
	});
});
