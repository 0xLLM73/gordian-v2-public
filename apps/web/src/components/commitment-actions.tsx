'use client';

import { snoozeCommitmentAction, updateCommitmentStatusAction } from '@/app/actions/commitments';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDashboardTracking } from '@/hooks/use-dashboard-tracking';
import type { ActNowItemType } from '@repo/shared';
import { useAction } from 'next-safe-action/hooks';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

function getSnoozePresets() {
	const tomorrow = new Date();
	tomorrow.setDate(tomorrow.getDate() + 1);
	tomorrow.setHours(9, 0, 0, 0);

	const nextWeek = new Date();
	nextWeek.setDate(nextWeek.getDate() + 7);
	nextWeek.setHours(9, 0, 0, 0);

	const nextMonth = new Date();
	nextMonth.setMonth(nextMonth.getMonth() + 1);
	nextMonth.setHours(9, 0, 0, 0);

	return [
		{ label: 'Tomorrow', date: tomorrow },
		{ label: 'Next week', date: nextWeek },
		{ label: 'Next month', date: nextMonth },
	] as const;
}

export function CommitmentActions({
	commitmentId,
	status,
	trackingItemType,
}: {
	commitmentId: string;
	status: 'active' | 'draft';
	trackingItemType?: ActNowItemType;
}) {
	const router = useRouter();
	const [snoozeOpen, setSnoozeOpen] = useState(false);
	const { trackActNowClick } = useDashboardTracking();

	const { execute: updateStatus, isExecuting: updating } = useAction(updateCommitmentStatusAction, {
		onSuccess: () => {
			router.refresh();
			toast.success('Commitment updated');
		},
		onError: (err) => {
			toast.error(err.error?.serverError || 'Failed to update commitment');
		},
	});

	const { execute: snooze, isExecuting: snoozing } = useAction(snoozeCommitmentAction, {
		onSuccess: () => {
			setSnoozeOpen(false);
			router.refresh();
			toast.success('Commitment snoozed');
		},
		onError: (err) => {
			toast.error(err.error?.serverError || 'Failed to snooze commitment');
		},
	});

	const busy = updating || snoozing;

	return (
		<div className="flex gap-1">
			{status === 'draft' ? (
				<button
					type="button"
					onClick={() => updateStatus({ commitmentId, status: 'active' })}
					disabled={busy}
					className="rounded px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
					title="Confirm as legitimate"
				>
					Confirm
				</button>
			) : null}

			{status === 'active' ? (
				<>
					<button
						type="button"
						onClick={() => {
							if (trackingItemType) trackActNowClick('complete', trackingItemType, commitmentId);
							updateStatus({ commitmentId, status: 'completed' });
						}}
						disabled={busy}
						className="rounded px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50"
						title="Mark complete"
					>
						Done
					</button>

					<Popover open={snoozeOpen} onOpenChange={setSnoozeOpen}>
						<PopoverTrigger asChild>
							<button
								type="button"
								disabled={busy}
								className="rounded px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
								title="Snooze"
							>
								Snooze
							</button>
						</PopoverTrigger>
						<PopoverContent align="end" className="w-48 p-2">
							<p className="mb-2 text-xs font-medium text-muted-foreground">Snooze until</p>
							<div className="flex flex-col gap-1">
								{getSnoozePresets().map((preset) => (
									<button
										key={preset.label}
										type="button"
										onClick={() => {
											if (trackingItemType)
												trackActNowClick('snooze', trackingItemType, commitmentId);
											snooze({ commitmentId, snoozedUntil: preset.date.toISOString() });
										}}
										disabled={busy}
										className="rounded px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
									>
										{preset.label}
									</button>
								))}
							</div>
						</PopoverContent>
					</Popover>
				</>
			) : null}

			<button
				type="button"
				onClick={() => {
					if (trackingItemType) trackActNowClick('dismiss', trackingItemType, commitmentId);
					updateStatus({ commitmentId, status: 'dismissed' });
				}}
				disabled={busy}
				className="rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
				title="Dismiss"
			>
				Dismiss
			</button>
		</div>
	);
}
