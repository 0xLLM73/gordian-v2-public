'use client';

import { addDealArtifactAction, removeDealArtifactAction } from '@/app/actions/deals';
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
import { Input } from '@/components/ui/input';
import { useAction } from 'next-safe-action/hooks';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

export function AddArtifactForm({ dealId }: { dealId: string }) {
	const [open, setOpen] = useState(false);
	const [title, setTitle] = useState('');
	const [artifactType, setArtifactType] = useState('other');
	const [url, setUrl] = useState('');
	const router = useRouter();

	const { execute: add, isExecuting } = useAction(addDealArtifactAction, {
		onSuccess: () => {
			toast.success('Artifact added');
			setOpen(false);
			setTitle('');
			setArtifactType('other');
			setUrl('');
			router.refresh();
		},
		onError: () => toast.error('Failed to add artifact'),
	});

	if (!open) {
		return (
			<Button variant="link" size="sm" className="h-auto p-0" onClick={() => setOpen(true)}>
				+ Add
			</Button>
		);
	}

	return (
		<div className="mt-3 rounded-md border border-primary/20 bg-primary/5 p-3">
			<div className="space-y-2">
				<Input
					type="text"
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					aria-label="Artifact title"
					placeholder="Artifact title"
				/>
				<div className="flex gap-2">
					<select
						value={artifactType}
						onChange={(e) => setArtifactType(e.target.value)}
						aria-label="Artifact type"
						className="rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
					>
						<option value="term_sheet">Term Sheet</option>
						<option value="saft">SAFT</option>
						<option value="token_warrant">Token Warrant</option>
						<option value="cap_table">Cap Table</option>
						<option value="contract">Contract</option>
						<option value="presentation">Presentation</option>
						<option value="note">Note</option>
						<option value="other">Other</option>
					</select>
					<Input
						type="url"
						value={url}
						onChange={(e) => setUrl(e.target.value)}
						aria-label="Artifact URL"
						placeholder="URL (optional)"
						className="flex-1"
					/>
				</div>
				<div className="flex gap-2">
					<Button
						size="sm"
						onClick={() =>
							add({
								dealId,
								title,
								artifactType: artifactType as
									| 'term_sheet'
									| 'saft'
									| 'token_warrant'
									| 'cap_table'
									| 'contract'
									| 'presentation'
									| 'note'
									| 'other',
								url: url || undefined,
							})
						}
						disabled={isExecuting || !title}
					>
						{isExecuting ? 'Adding...' : 'Add'}
					</Button>
					<Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
						Cancel
					</Button>
				</div>
			</div>
		</div>
	);
}

export function RemoveArtifactButton({ artifactId }: { artifactId: string }) {
	const [confirmOpen, setConfirmOpen] = useState(false);
	const router = useRouter();
	const { execute, isExecuting } = useAction(removeDealArtifactAction, {
		onSuccess: () => {
			toast.success('Artifact removed');
			router.refresh();
		},
		onError: () => toast.error('Failed to remove artifact'),
	});

	return (
		<>
			<Button
				variant="ghost"
				size="sm"
				onClick={() => setConfirmOpen(true)}
				disabled={isExecuting}
				className="text-xs text-gray-400 hover:text-red-600"
			>
				Remove
			</Button>
			<AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove artifact?</AlertDialogTitle>
						<AlertDialogDescription>Remove this artifact from the deal?</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							onClick={() => execute({ artifactId })}
						>
							Remove
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
