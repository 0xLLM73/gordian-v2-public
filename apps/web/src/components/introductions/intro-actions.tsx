'use client';

import { updateIntroStatusAction } from '@/app/actions/introductions';
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
import { Archive, Check, X } from 'lucide-react';
import { useAction } from 'next-safe-action/hooks';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

const NEXT_STATUS: Record<string, string> = {
	triage: 'active',
	active: 'archive',
};

const NEXT_LABELS: Record<string, string> = {
	triage: 'Approve',
	active: 'Complete',
};

export function IntroActions({
	introductionId,
	status,
}: {
	introductionId: string;
	status: string;
}) {
	const router = useRouter();
	const [confirmOpen, setConfirmOpen] = useState(false);
	const { execute, isExecuting } = useAction(updateIntroStatusAction, {
		onSuccess: () => {
			toast.success('Introduction updated');
			router.refresh();
		},
		onError: () => toast.error('Failed to update introduction'),
	});

	if (status === 'archive') return null;

	const nextStatus = NEXT_STATUS[status];
	const nextResolution = status === 'active' ? 'completed' : undefined;

	return (
		<>
			<div className="flex gap-1">
				{nextStatus ? (
					<Button
						variant="ghost"
						size="sm"
						onClick={() =>
							execute({
								introductionId,
								status: nextStatus as 'triage' | 'active' | 'archive',
								resolution: nextResolution,
							})
						}
						disabled={isExecuting}
						className="text-blue-700 hover:bg-blue-50"
					>
						{status === 'triage' ? (
							<Check className="h-3.5 w-3.5" />
						) : (
							<Archive className="h-3.5 w-3.5" />
						)}
						{NEXT_LABELS[status] || 'Advance'}
					</Button>
				) : null}
				<Button
					variant="ghost"
					size="sm"
					onClick={() => setConfirmOpen(true)}
					disabled={isExecuting}
					className="text-muted-foreground hover:bg-accent"
				>
					<X className="h-3.5 w-3.5" />
					Dismiss
				</Button>
			</div>
			<AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Dismiss introduction?</AlertDialogTitle>
						<AlertDialogDescription>
							This will mark the introduction as dismissed. It won't be deleted but will be hidden
							from the active list.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() =>
								execute({ introductionId, status: 'archive', resolution: 'dismissed' })
							}
						>
							Dismiss
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
