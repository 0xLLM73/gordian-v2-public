'use client';

import { cn } from '@/lib/utils';

const STEPS = [
	{ key: 'connect', label: 'Connect' },
	{ key: 'verify', label: 'Verify' },
	{ key: 'sync', label: 'Sync' },
	{ key: 'what-matters', label: 'Priorities' },
	{ key: 'calibrate', label: 'Voice' },
	{ key: 'first-look', label: 'Explore' },
] as const;

type StepKey = (typeof STEPS)[number]['key'];

const STEP_ORDER: Record<StepKey, number> = {
	connect: 0,
	verify: 1,
	sync: 2,
	'what-matters': 3,
	calibrate: 4,
	'first-look': 5,
};

export function StepIndicator({ activeStep }: { activeStep: StepKey }) {
	const activeIndex = STEP_ORDER[activeStep] ?? 0;

	return (
		<div className="flex items-center justify-center gap-2">
			{STEPS.map((step, i) => {
				const isCompleted = i < activeIndex;
				const isActive = i === activeIndex;

				return (
					<div key={step.key} className="flex items-center gap-2">
						{i > 0 && (
							<div
								className={cn(
									'h-px w-8 transition-colors duration-300',
									isCompleted ? 'bg-success' : 'bg-border',
								)}
							/>
						)}
						<div className="flex flex-col items-center gap-1">
							<div
								className={cn(
									'flex h-2.5 w-2.5 rounded-full transition-all duration-300',
									isCompleted && 'bg-success',
									isActive && 'bg-primary ring-4 ring-primary/20',
									!isCompleted && !isActive && 'bg-border',
								)}
							/>
							<span
								className={cn(
									'text-[10px] font-medium transition-colors duration-300',
									isActive ? 'text-foreground' : 'text-muted-foreground',
								)}
							>
								{step.label}
							</span>
						</div>
					</div>
				);
			})}
		</div>
	);
}
