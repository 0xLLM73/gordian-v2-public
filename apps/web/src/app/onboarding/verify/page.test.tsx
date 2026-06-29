import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingProvider } from '@/components/onboarding/onboarding-provider';
import VerifyPage from './page';

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

function renderVerifyPage() {
	return render(React.createElement(OnboardingProvider, null, React.createElement(VerifyPage)));
}

describe('VerifyPage', () => {
	beforeEach(() => {
		mockFetch.mockReset();
		navigationMocks.push.mockReset();
		navigationMocks.replace.mockReset();
		sessionStorage.clear();
		sessionStorage.setItem(
			'gordian-onboarding',
			JSON.stringify({
				phone: '+1 555 123 4567',
				normalizedPhone: '+15551234567',
				telegramCodeDelivery: {
					method: 'app',
					codeLength: 5,
					expiresInSeconds: 120,
					sentAt: Date.now(),
				},
				consentAcknowledged: true,
				workspaceId: null,
				syncScope: 'private_chats',
				enableAiProcessing: false,
			}),
		);
	});

	it('explains why Telegram can show a login even when Gordian refuses an already-linked account', async () => {
		mockFetch.mockResolvedValue({
			ok: false,
			status: 409,
			json: () => Promise.resolve({ error: 'Telegram account is already linked to another user.' }),
		});

		const { container } = renderVerifyPage();

		await screen.findByRole('heading', { name: 'Enter verification code' });
		expect(screen.getByText('What this code does')).toBeTruthy();

		const inputs = container.querySelectorAll('input[inputmode="numeric"]');
		expect(inputs).toHaveLength(5);
		['1', '2', '3', '4', '5'].forEach((digit, index) => {
			fireEvent.change(inputs[index], { target: { value: digit } });
		});

		await waitFor(() => {
			expect(screen.getByText('Telegram login was not attached')).toBeTruthy();
		});
		expect(screen.getByText(/Telegram accepted the verification code/i)).toBeTruthy();
		expect(screen.getByText(/revoke the new session from Telegram Settings/i)).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Back to phone number' }).getAttribute('href')).toBe(
			'/onboarding/connect',
		);
	});

	it('shows Telegram delivery metadata and renders the expected code length', async () => {
		sessionStorage.setItem(
			'gordian-onboarding',
			JSON.stringify({
				phone: '+1 555 123 4567',
				normalizedPhone: '+15551234567',
				telegramCodeDelivery: {
					method: 'sms',
					codeLength: 6,
					expiresInSeconds: 90,
					sentAt: Date.now(),
					nextMethod: 'call',
				},
				consentAcknowledged: true,
				workspaceId: null,
				syncScope: 'private_chats',
				enableAiProcessing: false,
			}),
		);

		const { container } = renderVerifyPage();

		await screen.findByRole('heading', { name: 'Enter verification code' });
		expect(screen.getByText('Delivery method: SMS')).toBeTruthy();
		expect(screen.getByText(/6-digit code by SMS/i)).toBeTruthy();
		expect(screen.getByText(/Code expires in/i)).toBeTruthy();
		expect(container.querySelectorAll('input[inputmode="numeric"]')).toHaveLength(6);
	});

	it('keeps the Telegram 2FA transition after a valid login code', async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			status: 200,
			json: () => Promise.resolve({ requires2FA: true }),
		});

		const { container } = renderVerifyPage();

		await screen.findByRole('heading', { name: 'Enter verification code' });
		const inputs = container.querySelectorAll('input[inputmode="numeric"]');
		['1', '2', '3', '4', '5'].forEach((digit, index) => {
			fireEvent.change(inputs[index], { target: { value: digit } });
		});

		await screen.findByRole('heading', { name: 'Two-factor authentication' });
		expect(screen.getByPlaceholderText('Cloud password')).toBeTruthy();
		expect(mockFetch).toHaveBeenCalledWith(
			'/api/auth/telegram/verify-code',
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({
					phone: '+15551234567',
					code: '12345',
					password: undefined,
				}),
			}),
		);
	});

	it('keeps the user on 2FA when the Telegram cloud password is wrong', async () => {
		mockFetch
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: () => Promise.resolve({ requires2FA: true }),
			})
			.mockResolvedValueOnce({
				ok: false,
				status: 400,
				json: () => Promise.resolve({ error: 'Invalid 2FA password' }),
			});

		const { container } = renderVerifyPage();

		await screen.findByRole('heading', { name: 'Enter verification code' });
		const inputs = container.querySelectorAll('input[inputmode="numeric"]');
		['1', '2', '3', '4', '5'].forEach((digit, index) => {
			fireEvent.change(inputs[index], { target: { value: digit } });
		});

		await screen.findByRole('heading', { name: 'Two-factor authentication' });
		fireEvent.change(screen.getByPlaceholderText('Cloud password'), {
			target: { value: 'wrong-password' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Submit Password' }));

		await screen.findByText('Invalid 2FA password');
		expect(screen.getByRole('heading', { name: 'Two-factor authentication' })).toBeTruthy();
	});

	it('resends a code and refreshes delivery state without exposing the phone code hash', async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			status: 200,
			json: () =>
				Promise.resolve({
					success: true,
					delivery: { method: 'sms', codeLength: 6, expiresInSeconds: 60 },
				}),
		});

		const { container } = renderVerifyPage();

		await screen.findByRole('heading', { name: 'Enter verification code' });
		fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));

		await waitFor(() => {
			expect(screen.getByText('Delivery method: SMS')).toBeTruthy();
		});
		expect(container.querySelectorAll('input[inputmode="numeric"]')).toHaveLength(6);
		const resendCall = mockFetch.mock.calls.find(([url]) => url === '/api/auth/telegram/send-code');
		expect(resendCall).toBeTruthy();
		const resendPayload = JSON.parse(String(resendCall?.[1]?.body)) as {
			phone: string;
			consentVersion: number;
		};
		expect(resendPayload.phone).toBe('+15551234567');
		expect(resendPayload.consentVersion).toBeGreaterThan(0);
		expect(sessionStorage.getItem('gordian-onboarding')).not.toContain('phoneCodeHash');
	});

	it('turns an expired code into a resend path instead of a dead verify form', async () => {
		sessionStorage.setItem(
			'gordian-onboarding',
			JSON.stringify({
				phone: '+1 555 123 4567',
				normalizedPhone: '+15551234567',
				telegramCodeDelivery: {
					method: 'app',
					codeLength: 5,
					expiresInSeconds: 1,
					sentAt: Date.now() - 5000,
				},
				consentAcknowledged: true,
				workspaceId: null,
				syncScope: 'private_chats',
				enableAiProcessing: false,
			}),
		);

		const { container } = renderVerifyPage();

		await screen.findByText('This login code has expired.');
		expect(screen.getByRole('button', { name: 'Send new code' })).toBeTruthy();
		for (const input of Array.from(container.querySelectorAll('input[inputmode="numeric"]'))) {
			expect((input as HTMLInputElement).disabled).toBe(true);
		}
	});
});
