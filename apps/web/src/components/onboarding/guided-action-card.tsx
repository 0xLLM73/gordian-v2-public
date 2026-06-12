'use client';

import { type ReactNode, useState } from 'react';
import { cn } from '@/lib/utils';

interface GuidedActionCardProps {
	title: string;
	description: string;
	accentColor: string;
	children: ReactNode;
	defaultExpanded?: boolean;
	onSkip?: () => void;
}

export function GuidedActionCard({
	title,
	description,
	accentColor,
	children,
	defaultExpanded = false,
	onSkip,
}: GuidedActionCardProps) {
	const [expanded, setExpanded] = useState(defaultExpanded);

	return (
		<div
			className={cn(
				'rounded-lg border border-border bg-card overflow-hidden transition-all shadow-stripe-sm',
				'animate-[fade-slide-up_0.3s_ease-out]',
			)}
		>
			<div className="flex">
				<div className={cn('w-1 shrink-0', accentColor)} />
				<div className="flex-1 p-4">
					<button
						type="button"
						onClick={() => setExpanded(!expanded)}
						className="flex w-full items-center justify-between text-left"
					>
						<div>
							<h3 className="text-sm font-semibold text-foreground">{title}</h3>
							<p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
						</div>
						<svg
							aria-hidden="true"
							className={cn(
								'ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
								expanded && 'rotate-180',
							)}
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							strokeWidth={2}
						>
							<path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
						</svg>
					</button>

					{expanded && (
						<div className="mt-3 animate-[fade-slide-up_0.2s_ease-out]">
							{children}
							{onSkip && (
								<button
									type="button"
									onClick={onSkip}
									className="mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
								>
									Skip this
								</button>
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
