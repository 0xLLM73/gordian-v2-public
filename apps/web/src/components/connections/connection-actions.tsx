'use client';

import { updateConnectionStatusAction } from '@/app/actions/connections';
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

export function ConnectionActions({
	connectionId,
	status,
}: {
	connectionId: string;
	status: string;
}) {
	const router = useRouter();
	const [confirmOpen, setConfirmOpen] = useState(false);
	const { execute, isExecuting } = useAction(updateConnectionStatusAction, {
		onSuccess: () => {
			toast.success('Connection updated');
			router.refresh();
		},
		onError: () => toast.error('Failed to update connection'),
	});

	if (status === 'confirmed' || status === 'dismissed') return null;

	return (
		<>
			<div className="flex gap-1">
				<Button
					variant="ghost"
					size="sm"
					onClick={() => execute({ connectionId, status: 'confirmed' })}
					disabled={isExecuting}
					className="text-green-700 hover:bg-green-50"
				>
					Confirm
				</Button>
				<Button
					variant="ghost"
					size="sm"
					onClick={() => setConfirmOpen(true)}
					disabled={isExecuting}
					className="text-muted-foreground hover:bg-accent"
				>
					Dismiss
				</Button>
			</div>
			<AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Dismiss connection?</AlertDialogTitle>
						<AlertDialogDescription>
							This will mark the connection as dismissed. It won't be deleted but will be hidden
							from the active list.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={() => execute({ connectionId, status: 'dismissed' })}>
							Dismiss
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
