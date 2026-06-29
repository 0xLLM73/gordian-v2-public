import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingProvider } from '@/components/onboarding/onboarding-provider';
import ConnectPage from './page';

vi.hoisted(() => {
	process.env.NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED = 'true';
});

const navigationMocks = vi.hoisted(() => ({
	push: vi.fn(),
	replace: vi.fn(),
}));
const mockFetch = vi.hoisted(() => vi.fn());

vi.stubGlobal('React', React);
vi.stubGlobal('fetch', mockFetch);

vi.mock('next/navigation', () => ({
	useRouter: () => navigationMocks,
}));

function renderConnectPage() {
	return render(React.createElement(OnboardingProvider, null, React.createElement(ConnectPage)));
}

describe('ConnectPage', () => {
	beforeEach(() => {
		mockFetch.mockReset();
		navigationMocks.push.mockReset();
		navigationMocks.replace.mockReset();
		sessionStorage.clear();
	});

	it('explains Telegram session custody separately from workspace data encryption', () => {
		renderConnectPage();

		expect(screen.getByText('Two local encryption keys')).toBeTruthy();
		expect(screen.getByText('Telegram MTProto session key')).toBeTruthy();
		expect(screen.getByText('Workspace data key')).toBeTruthy();
		expect(screen.getByText(/the unwrap key stays in Keychain/i)).toBeTruthy();
		expect(screen.getByText(/revoking Telegram access does not decrypt or erase/i)).toBeTruthy();
	});

	it('requires explicit Telegram session consent before enabling verification code requests', () => {
		renderConnectPage();

		const sendButton = screen.getByRole('button', {
			name: 'Send Verification Code',
		}) as HTMLButtonElement;
		expect(sendButton.disabled).toBe(true);

		fireEvent.change(screen.getByLabelText('Phone Number'), {
			target: { value: '+15555550123' },
		});
		expect(sendButton.disabled).toBe(true);

		fireEvent.click(
			screen.getByLabelText(
				/I understand Gordian will create a local Telegram session, and I know I must revoke it/i,
			),
		);
		expect(sendButton.disabled).toBe(false);
	});

	it('persists Telegram code delivery metadata before moving to verification', async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: () =>
				Promise.resolve({
					success: true,
					delivery: { method: 'sms', codeLength: 6, expiresInSeconds: 90 },
				}),
		});
		renderConnectPage();

		fireEvent.change(screen.getByLabelText('Phone Number'), {
			target: { value: '+1 555 555 0123' },
		});
		fireEvent.click(
			screen.getByLabelText(
				/I understand Gordian will create a local Telegram session, and I know I must revoke it/i,
			),
		);
		fireEvent.click(screen.getByRole('button', { name: 'Send Verification Code' }));

		await waitFor(() => {
			expect(navigationMocks.push).toHaveBeenCalledWith('/onboarding/verify');
		});
		await waitFor(() => {
			const saved = JSON.parse(String(sessionStorage.getItem('gordian-onboarding'))) as {
				normalizedPhone: string;
				telegramCodeDelivery: { method: string; codeLength: number; expiresInSeconds: number };
			};
			expect(saved.normalizedPhone).toBe('+15555550123');
			expect(saved.telegramCodeDelivery).toMatchObject({
				method: 'sms',
				codeLength: 6,
				expiresInSeconds: 90,
			});
		});
		expect(sessionStorage.getItem('gordian-onboarding')).not.toContain('phoneCodeHash');
	});
});
