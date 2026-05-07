'use client';

import { removeFromWatchlistAction } from '@/app/actions/tokens';
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

export function RemoveWatchlistButton({ symbol }: { symbol: string }) {
	const router = useRouter();
	const [confirmOpen, setConfirmOpen] = useState(false);
	const { execute, isExecuting } = useAction(removeFromWatchlistAction, {
		onSuccess: () => {
			toast.success(`${symbol} removed from watchlist`);
			router.refresh();
		},
		onError: () => toast.error('Failed to remove token'),
	});

	return (
		<>
			<Button
				variant="ghost"
				size="sm"
				onClick={() => setConfirmOpen(true)}
				disabled={isExecuting}
				className="text-muted-foreground hover:bg-accent hover:text-red-600"
			>
				Remove
			</Button>
			<AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{`Remove ${symbol}?`}</AlertDialogTitle>
						<AlertDialogDescription>
							{`Remove ${symbol} from your watchlist? You can add it back later.`}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							onClick={() => execute({ symbol })}
						>
							Remove
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
