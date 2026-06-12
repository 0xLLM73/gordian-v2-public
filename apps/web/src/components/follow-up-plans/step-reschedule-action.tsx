'use client';

import { useRouter } from 'next/navigation';
import { useAction } from 'next-safe-action/hooks';
import { useState } from 'react';
import { rescheduleFollowUpPlanStepAction } from '@/app/actions/follow-up-plans';

const MAX_RESCHEDULE_HOURS = 24 * 365;

export function StepRescheduleAction({
	stepId,
	followUpPlanId,
	disabled = false,
	label = 'Reschedule',
}: {
	stepId: string;
	followUpPlanId: string;
	disabled?: boolean;
	label?: string;
}) {
	const router = useRouter();
	const [message, setMessage] = useState<string | null>(null);
	const { execute, isExecuting } = useAction(rescheduleFollowUpPlanStepAction, {
		onSuccess: () => router.refresh(),
	});

	function reschedule() {
		setMessage(null);
		const rawHours = window.prompt('Reschedule this follow-up how many hours from now?', '24');
		if (rawHours === null) return;

		const hours = Number(rawHours.trim());
		if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_RESCHEDULE_HOURS) {
			setMessage(`Enter a number of hours between 1 and ${MAX_RESCHEDULE_HOURS}.`);
			return;
		}

		const reason = window.prompt('Optional reason for rescheduling:', '')?.trim();
		execute({
			stepId,
			followUpPlanId,
			scheduledAt: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString(),
			...(reason ? { reason } : {}),
		});
		setMessage('Rescheduled. Nothing was sent.');
	}

	return (
		<div className="space-y-1">
			<button
				type="button"
				onClick={reschedule}
				disabled={disabled || isExecuting}
				className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
			>
				{isExecuting ? 'Rescheduling...' : label}
			</button>
			{message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
		</div>
	);
}
