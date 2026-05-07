'use client';
// 'use client' — needs useAction hooks for server action mutations + useRouter for refresh

import {
	activateFollowUpPlanAction,
	cancelFollowUpPlanAction,
	pauseFollowUpPlanAction,
	resumeFollowUpPlanAction,
} from '@/app/actions/follow-up-plans';
import { useAction } from 'next-safe-action/hooks';
import { useRouter } from 'next/navigation';

export function FollowUpPlanActions({
	followUpPlanId,
	status,
}: {
	followUpPlanId: string;
	status: string;
}) {
	const router = useRouter();
	const opts = { onSuccess: () => router.refresh() };

	const { execute: activate, isExecuting: activating } = useAction(
		activateFollowUpPlanAction,
		opts,
	);
	const { execute: pause, isExecuting: pausing } = useAction(pauseFollowUpPlanAction, opts);
	const { execute: resume, isExecuting: resuming } = useAction(resumeFollowUpPlanAction, opts);
	const { execute: cancel, isExecuting: cancelling } = useAction(cancelFollowUpPlanAction, opts);

	const busy = activating || pausing || resuming || cancelling;

	if (status === 'completed' || status === 'cancelled') return null;

	return (
		<div className="flex gap-1">
			{status === 'draft' ? (
				<button
					type="button"
					onClick={() => activate({ followUpPlanId })}
					disabled={busy}
					className="rounded px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50"
				>
					Activate
				</button>
			) : null}
			{status === 'active' ? (
				<button
					type="button"
					onClick={() => pause({ followUpPlanId })}
					disabled={busy}
					className="rounded px-2 py-1 text-xs font-medium text-yellow-700 hover:bg-yellow-50 disabled:opacity-50"
				>
					Pause
				</button>
			) : null}
			{status === 'paused' ? (
				<button
					type="button"
					onClick={() => resume({ followUpPlanId })}
					disabled={busy}
					className="rounded px-2 py-1 text-xs font-medium text-primary hover:bg-blue-50 disabled:opacity-50"
				>
					Resume
				</button>
			) : null}
			<button
				type="button"
				onClick={() => cancel({ followUpPlanId })}
				disabled={busy}
				className="rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
			>
				Cancel
			</button>
		</div>
	);
}
