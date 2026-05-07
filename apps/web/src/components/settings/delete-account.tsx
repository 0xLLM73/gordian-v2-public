'use client';
// Needs interactivity: AlertDialog, type-to-confirm input, async action, redirect

import { deleteAccountAction } from '@/app/actions/settings';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

export function DeleteAccount() {
	const [confirmText, setConfirmText] = useState('');
	const [isPending, startTransition] = useTransition();
	const [open, setOpen] = useState(false);
	const router = useRouter();

	const isConfirmed = confirmText === 'DELETE';

	function handleDelete() {
		startTransition(async () => {
			const result = await deleteAccountAction({ confirmation: 'DELETE' });
			if (result?.data?.deleted) {
				await authClient.signOut();
				router.push('/');
			}
		});
	}

	return (
		<AlertDialog open={open} onOpenChange={setOpen}>
			<AlertDialogTrigger asChild>
				<Button variant="destructive">Delete Account</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete your account?</AlertDialogTitle>
					<AlertDialogDescription className="space-y-2">
						<span className="block">
							This will permanently delete all your data including messages, contacts, commitments,
							deals, and encryption keys. This action cannot be undone.
						</span>
						<span className="block font-medium text-foreground">Type DELETE to confirm.</span>
					</AlertDialogDescription>
				</AlertDialogHeader>
				<Input
					value={confirmText}
					onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirmText(e.target.value)}
					placeholder="Type DELETE"
					className="font-mono"
					disabled={isPending}
				/>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isPending} onClick={() => setConfirmText('')}>
						Cancel
					</AlertDialogCancel>
					<AlertDialogAction
						disabled={!isConfirmed || isPending}
						onClick={handleDelete}
						className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
					>
						{isPending ? 'Deleting...' : 'Delete Everything'}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
