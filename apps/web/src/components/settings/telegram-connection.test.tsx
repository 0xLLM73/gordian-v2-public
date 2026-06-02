import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TelegramConnection } from './telegram-connection';

vi.mock('@/app/actions/settings', () => ({
	disconnectTelegramAction: vi.fn(),
}));

describe('TelegramConnection', () => {
	it('shows connected status without exposing the Telegram account id', () => {
		render(React.createElement(TelegramConnection, { isConnected: true }));

		expect(screen.getByText('Connected')).toBeTruthy();
		expect(screen.queryByText(/Connected \(/)).toBeNull();
	});

	it('shows deployment safety status without requiring account identifiers', () => {
		render(
			React.createElement(TelegramConnection, {
				isConnected: false,
				safetyItems: [
					{ label: 'Message sending', status: 'Disabled', tone: 'ok' },
					{ label: 'Session key custody', status: 'os-keychain', tone: 'ok' },
				],
			}),
		);

		expect(screen.getByText('Message sending')).toBeTruthy();
		expect(screen.getByText('Disabled')).toBeTruthy();
		expect(screen.getByText('Session key custody')).toBeTruthy();
		expect(screen.getByText('os-keychain')).toBeTruthy();
	});
});
