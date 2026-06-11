import { OnboardingProvider } from '@/components/onboarding/onboarding-provider';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ConnectPage from './page';

vi.hoisted(() => {
	process.env.NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED = 'true';
});

const navigationMocks = vi.hoisted(() => ({
	push: vi.fn(),
	replace: vi.fn(),
}));

vi.stubGlobal('React', React);

vi.mock('next/navigation', () => ({
	useRouter: () => navigationMocks,
}));

function renderConnectPage() {
	return render(React.createElement(OnboardingProvider, null, React.createElement(ConnectPage)));
}

describe('ConnectPage', () => {
	beforeEach(() => {
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
});
