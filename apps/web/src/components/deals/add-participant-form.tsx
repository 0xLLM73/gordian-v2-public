'use client';

import { listContactsAction } from '@/app/actions/contacts';
import { addDealParticipantAction, removeDealParticipantAction } from '@/app/actions/deals';
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
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

interface Contact {
	id: string;
	firstName: string | null;
	lastName: string | null;
}

export function AddParticipantForm({ dealId }: { dealId: string }) {
	const [open, setOpen] = useState(false);
	const [contacts, setContacts] = useState<Contact[]>([]);
	const [contactId, setContactId] = useState('');
	const [role, setRole] = useState('other');
	const [notes, setNotes] = useState('');
	const router = useRouter();

	const { execute: loadContacts } = useAction(listContactsAction, {
		onSuccess: (result) => {
			if (result.data) {
				setContacts(
					result.data.map((c: Record<string, unknown>) => ({
						id: c.id as string,
						firstName: (c.firstName as string) || null,
						lastName: (c.lastName as string) || null,
					})),
				);
			}
		},
	});

	const { execute: add, isExecuting } = useAction(addDealParticipantAction, {
		onSuccess: () => {
			toast.success('Participant added');
			setOpen(false);
			setContactId('');
			setRole('other');
			setNotes('');
			router.refresh();
		},
		onError: () => toast.error('Failed to add participant'),
	});

	useEffect(() => {
		if (open && contacts.length === 0) loadContacts({ limit: 100 });
	}, [open, contacts.length, loadContacts]);

	if (!open) {
		return (
			<Button variant="link" size="sm" className="h-auto p-0" onClick={() => setOpen(true)}>
				+ Add
			</Button>
		);
	}

	const contactName = (c: Contact) =>
		[c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown';

	return (
		<div className="mt-3 rounded-md border border-primary/20 bg-primary/5 p-3">
			<div className="space-y-2">
				<select
					value={contactId}
					onChange={(e) => setContactId(e.target.value)}
					className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
				>
					<option value="">Select contact...</option>
					{contacts.map((c) => (
						<option key={c.id} value={c.id}>
							{contactName(c)}
						</option>
					))}
				</select>
				<div className="flex gap-2">
					<select
						value={role}
						onChange={(e) => setRole(e.target.value)}
						className="rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
					>
						<option value="lead">Lead</option>
						<option value="co_investor">Co-investor</option>
						<option value="advisor">Advisor</option>
						<option value="counterparty">Counterparty</option>
						<option value="introducer">Introducer</option>
						<option value="other">Other</option>
					</select>
					<Input
						type="text"
						value={notes}
						onChange={(e) => setNotes(e.target.value)}
						placeholder="Notes (optional)"
						className="flex-1"
					/>
				</div>
				<div className="flex gap-2">
					<Button
						size="sm"
						onClick={() =>
							add({
								dealId,
								contactId,
								role: role as
									| 'lead'
									| 'co_investor'
									| 'advisor'
									| 'counterparty'
									| 'introducer'
									| 'other',
								notes: notes || undefined,
							})
						}
						disabled={isExecuting || !contactId}
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

export function RemoveParticipantButton({ participantId }: { participantId: string }) {
	const [confirmOpen, setConfirmOpen] = useState(false);
	const router = useRouter();
	const { execute, isExecuting } = useAction(removeDealParticipantAction, {
		onSuccess: () => {
			toast.success('Participant removed');
			router.refresh();
		},
		onError: () => toast.error('Failed to remove participant'),
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
						<AlertDialogTitle>Remove participant?</AlertDialogTitle>
						<AlertDialogDescription>Remove this participant from the deal?</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							onClick={() => execute({ participantId })}
						>
							Remove
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
