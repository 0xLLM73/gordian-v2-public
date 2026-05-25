import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncButton } from './sync-button';

const mockExecute = vi.hoisted(() => vi.fn());
const mockUseAction = vi.hoisted(() => vi.fn());

vi.mock('@/app/actions/sync', () => ({
	triggerSyncAction: vi.fn(),
}));

vi.mock('@/components/ui/button', () => ({
	Button: ({
		children,
		...props
	}: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) =>
		React.createElement('button', { type: 'button', ...props }, children),
}));

vi.mock('next-safe-action/hooks', () => ({
	useAction: mockUseAction,
}));

describe('SyncButton', () => {
	beforeEach(() => {
		mockExecute.mockClear();
		mockUseAction.mockReset();
		mockUseAction.mockReturnValue({ execute: mockExecute, isExecuting: false });
	});

	it('labels the default sync as contacts-only and sends the explicit scope', () => {
		render(React.createElement(SyncButton));

		const button = screen.getByRole('button', { name: /sync contacts/i });
		expect(button.getAttribute('title')).toContain('contacts only');

		fireEvent.click(button);

		expect(mockExecute).toHaveBeenCalledWith({ syncScope: 'contacts_only' });
	});

	it('keeps the disabled state generic when Telegram sync is unavailable', () => {
		render(React.createElement(SyncButton, { disabledReason: 'Telegram sync is disabled' }));

		const button = screen.getByRole('button', { name: /sync disabled/i });
		expect((button as HTMLButtonElement).disabled).toBe(true);
		expect(button.getAttribute('title')).toBe('Telegram sync is disabled');
	});
});
