import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AccountFilter } from './account-filter';

const mockPush = vi.hoisted(() => vi.fn());

vi.stubGlobal('React', React);

vi.mock('next/navigation', () => ({
	useRouter: () => ({ push: mockPush }),
}));

describe('AccountFilter', () => {
	it('shows stable labels instead of raw Telegram account ids', () => {
		render(
			React.createElement(AccountFilter, {
				accounts: [
					{ key: '0', label: 'Telegram account 1' },
					{ key: '1', label: 'Telegram account 2' },
				],
				selectedAccountKey: '0',
			}),
		);

		expect(screen.getByRole('option', { name: 'Telegram account 1' })).toBeTruthy();
		expect(screen.queryByText('123456789')).toBeNull();
	});

	it('routes by account key rather than raw account id', () => {
		render(
			React.createElement(AccountFilter, {
				accounts: [{ key: '0', label: 'Telegram account 1' }],
			}),
		);

		fireEvent.change(screen.getByLabelText('Account'), { target: { value: '0' } });

		expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('account=0'));
		expect(mockPush).not.toHaveBeenCalledWith(expect.stringContaining('123456789'));
	});
});
