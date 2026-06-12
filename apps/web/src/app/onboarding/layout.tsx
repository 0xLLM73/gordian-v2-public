'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { OnboardingProvider } from '@/components/onboarding/onboarding-provider';
import { StepIndicator } from '@/components/onboarding/step-indicator';

const STEP_MAP: Record<
	string,
	'connect' | 'verify' | 'permissions' | 'sync' | 'what-matters' | 'calibrate' | 'first-look'
> = {
	'/onboarding': 'connect',
	'/onboarding/connect': 'connect',
	'/onboarding/verify': 'verify',
	'/onboarding/permissions': 'permissions',
	'/onboarding/sync': 'sync',
	'/onboarding/what-matters': 'what-matters',
	'/onboarding/calibrate': 'calibrate',
	'/onboarding/first-look': 'first-look',
};

export default function OnboardingLayout({ children }: { children: ReactNode }) {
	const pathname = usePathname();
	const activeStep = STEP_MAP[pathname] ?? 'connect';

	return (
		<OnboardingProvider>
			<div className="flex min-h-screen flex-col bg-gradient-to-br from-background via-background to-primary/5">
				{/* Header */}
				<header className="flex items-center justify-between px-6 py-4">
					<span className="text-lg font-bold text-foreground tracking-tight">Gordian</span>
					<StepIndicator activeStep={activeStep} />
					<div className="w-16" /> {/* Spacer for balance */}
				</header>

				{/* Content */}
				<main className="flex flex-1 items-center justify-center px-4 pb-12">{children}</main>
			</div>
		</OnboardingProvider>
	);
}
