'use client';

import {
	deleteGoalAction,
	updateGoalProgressAction,
	updateGoalStatusAction,
} from '@/app/actions/goals';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useAction } from 'next-safe-action/hooks';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

export function GoalActions({ goalId, status }: { goalId: string; status: string }) {
	const router = useRouter();
	const [confirmOpen, setConfirmOpen] = useState(false);

	const { execute: increment, isExecuting: incrementing } = useAction(updateGoalProgressAction, {
		onSuccess: () => {
			toast.success('Progress updated');
			router.refresh();
		},
		onError: () => toast.error('Failed to update progress'),
	});

	const { execute: updateStatus, isExecuting: updating } = useAction(updateGoalStatusAction, {
		onSuccess: () => {
			toast.success('Goal updated');
			router.refresh();
		},
		onError: () => toast.error('Failed to update goal'),
	});

	const { execute: remove, isExecuting: removing } = useAction(deleteGoalAction, {
		onSuccess: () => {
			toast.success('Goal deleted');
			router.refresh();
		},
		onError: () => toast.error('Failed to delete goal'),
	});

	const busy = incrementing || updating || removing;

	if (status === 'completed' || status === 'abandoned') {
		return (
			<>
				<div className="flex gap-1">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setConfirmOpen(true)}
						disabled={busy}
						className="text-muted-foreground hover:bg-accent"
					>
						Delete
					</Button>
				</div>
				<AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Delete goal?</AlertDialogTitle>
							<AlertDialogDescription>
								This will permanently remove this goal and cannot be undone.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction
								className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
								onClick={() => remove({ goalId })}
							>
								Delete
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</>
		);
	}

	return (
		<div className="flex gap-1">
			{status === 'active' ? (
				<>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => increment({ goalId, increment: 1 })}
						disabled={busy}
						className="bg-green-50 text-green-700 hover:bg-green-100"
					>
						+1
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => updateStatus({ goalId, status: 'paused' })}
						disabled={busy}
						className="text-yellow-700 hover:bg-yellow-50"
					>
						Pause
					</Button>
				</>
			) : null}
			{status === 'paused' ? (
				<Button
					variant="ghost"
					size="sm"
					onClick={() => updateStatus({ goalId, status: 'active' })}
					disabled={busy}
					className="text-green-700 hover:bg-green-50"
				>
					Resume
				</Button>
			) : null}
			<Button
				variant="ghost"
				size="sm"
				onClick={() => updateStatus({ goalId, status: 'abandoned' })}
				disabled={busy}
				className="text-muted-foreground hover:bg-accent"
			>
				Abandon
			</Button>
		</div>
	);
}
