import { OnboardingProvider } from '@/components/onboarding/onboarding-provider';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
});
