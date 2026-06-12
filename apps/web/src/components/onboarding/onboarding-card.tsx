import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function OnboardingCard({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				'w-full max-w-lg rounded-xl border border-border bg-card p-8 shadow-stripe',
				'animate-[fade-slide-up_0.4s_ease-out]',
				className,
			)}
		>
			{children}
		</div>
	);
}
