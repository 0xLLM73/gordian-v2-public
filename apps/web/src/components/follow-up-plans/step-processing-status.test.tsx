import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StepProcessingStatus } from './step-processing-status';

describe('StepProcessingStatus', () => {
	beforeEach(() => {
		vi.stubGlobal('React', React);
	});

	it('shows a retryable blocked state without implying any send happened', () => {
		render(
			<StepProcessingStatus
				status="ready"
				lastProcessingError="local AI unavailable"
				processingLeaseExpiresAt="2026-06-09T13:00:00Z"
				now="2026-06-09T12:00:00Z"
			/>,
		);

		expect(screen.getByText('Draft generation blocked')).toBeTruthy();
		expect(screen.getByText('Last worker error: local AI unavailable')).toBeTruthy();
		expect(screen.getByText(/Retry after/)).toBeTruthy();
		expect(screen.getByText(/The draft was not sent/)).toBeTruthy();
	});

	it('shows active processing leases as in progress', () => {
		render(
			<StepProcessingStatus
				status="ready"
				processingLeaseExpiresAt="2026-06-09T13:00:00Z"
				now="2026-06-09T12:00:00Z"
			/>,
		);

		expect(screen.getByText('Draft generation in progress')).toBeTruthy();
		expect(screen.getByText('No message has been sent.')).toBeTruthy();
	});

	it('stays hidden when there is no worker issue to explain', () => {
		const { container } = render(
			<StepProcessingStatus
				status="ready"
				processingLeaseExpiresAt="2026-06-09T11:00:00Z"
				now="2026-06-09T12:00:00Z"
			/>,
		);

		expect(container.textContent).toBe('');
	});
});
