import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingProvider } from '@/components/onboarding/onboarding-provider';
import PermissionsPage from './page';

const navigationMocks = vi.hoisted(() => ({
	push: vi.fn(),
	replace: vi.fn(),
}));
const mockSaveConsentAction = vi.hoisted(() => vi.fn());
const mockFetch = vi.hoisted(() => vi.fn());

vi.stubGlobal('React', React);
vi.stubGlobal('fetch', mockFetch);

vi.mock('next/navigation', () => ({
	useRouter: () => navigationMocks,
}));

vi.mock('@/app/actions/calibration', () => ({
	saveConsentAction: mockSaveConsentAction,
}));

function renderPermissionsPage() {
	return render(
		React.createElement(OnboardingProvider, null, React.createElement(PermissionsPage)),
	);
}

describe('PermissionsPage', () => {
	beforeEach(() => {
		mockFetch.mockReset();
		mockSaveConsentAction.mockReset();
		navigationMocks.push.mockReset();
		navigationMocks.replace.mockReset();
		sessionStorage.clear();
	});

	it('saves durable consent before sending import-only users to the dashboard import', async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			status: 200,
			json: () =>
				Promise.resolve({
					workspaceId: '550e8400-e29b-41d4-a716-446655440000',
					hasCurrentTelegramConsent: false,
					consent: null,
					telegramImportOnlyMode: true,
					telegramAccounts: [{ key: '0', label: 'Telegram account 1' }],
					runtimeSafety: {
						aiAvailable: true,
						aiDescription: 'AI analysis can use configured local models without vendor AI egress.',
						items: [
							{
								label: 'Telegram import unlock',
								status: 'Strict Touch ID requested',
								detail:
									'Each import run reads the saved MTProto session key through macOS Keychain user presence.',
								tone: 'ok',
							},
						],
					},
				}),
		});
		mockSaveConsentAction.mockResolvedValue({ data: { saved: true } });

		renderPermissionsPage();

		await screen.findByRole('heading', { name: 'Choose permissions' });
		expect(screen.getByText('Strict Touch ID requested')).toBeTruthy();

		fireEvent.click(screen.getByLabelText(/allow ai analysis for imported messages/i));
		fireEvent.click(screen.getByRole('button', { name: 'Save and open dashboard import' }));

		await waitFor(() => {
			expect(mockSaveConsentAction).toHaveBeenCalledWith({
				consentDataProcessing: true,
				consentAiAnalysis: true,
				consentTelegramAccess: true,
				consentVersion: 2,
			});
		});
		expect(navigationMocks.push).toHaveBeenCalledWith('/');
	});

	it('redirects users without a linked Telegram account back to connect', async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			status: 200,
			json: () =>
				Promise.resolve({
					workspaceId: '550e8400-e29b-41d4-a716-446655440000',
					hasCurrentTelegramConsent: false,
					consent: null,
					telegramImportOnlyMode: true,
					telegramAccounts: [],
					runtimeSafety: {
						aiAvailable: false,
						aiDescription:
							'AI analysis is not configured, so imported messages will not be sent to AI providers.',
						items: [],
					},
				}),
		});

		renderPermissionsPage();

		await waitFor(() => {
			expect(navigationMocks.replace).toHaveBeenCalledWith('/onboarding/connect');
		});
		expect(mockSaveConsentAction).not.toHaveBeenCalled();
	});
});
