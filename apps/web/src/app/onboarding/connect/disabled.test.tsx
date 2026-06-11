import { OnboardingProvider } from '@/components/onboarding/onboarding-provider';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import ConnectPage from './page';

vi.hoisted(() => {
	process.env.NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED = 'false';
});

vi.stubGlobal('React', React);

vi.mock('next/navigation', () => ({
	useRouter: () => ({
		push: vi.fn(),
		replace: vi.fn(),
	}),
}));

describe('ConnectPage disabled Telegram state', () => {
	it('shows both sample-data and first-owner local setup paths', () => {
		render(React.createElement(OnboardingProvider, null, React.createElement(ConnectPage)));

		expect(screen.getByText('Telegram linking is disabled')).toBeTruthy();
		expect(screen.getByText('pnpm demo:setup')).toBeTruthy();
		expect(screen.getByText('alice@gordian.dev')).toBeTruthy();
		expect(screen.getByText('pnpm bootstrap:local-owner')).toBeTruthy();
		expect(screen.getByText(/without sample accounts/i)).toBeTruthy();
	});
});
