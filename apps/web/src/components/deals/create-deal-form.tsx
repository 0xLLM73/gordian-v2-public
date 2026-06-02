'use client';

import { listContactsAction } from '@/app/actions/contacts';
import { createDealAction } from '@/app/actions/deals';
import { ContactCombobox } from '@/components/introductions/contact-combobox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAction } from 'next-safe-action/hooks';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

interface Contact {
	id: string;
	firstName: string | null;
	lastName: string | null;
}

export function CreateDealForm() {
	const [open, setOpen] = useState(false);
	const [contacts, setContacts] = useState<Contact[]>([]);
	const [title, setTitle] = useState('');
	const [contactId, setContactId] = useState('');
	const [dealType, setDealType] = useState('investment');
	const [value, setValue] = useState('');
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

	const { execute: create, isExecuting } = useAction(createDealAction, {
		onSuccess: () => {
			setOpen(false);
			setTitle('');
			setContactId('');
			setValue('');
			setNotes('');
			router.refresh();
		},
	});
	const trimmedTitle = title.trim();
	const trimmedNotes = notes.trim();

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		if (params.get('new') === '1') setOpen(true);
	}, []);

	useEffect(() => {
		if (open && contacts.length === 0) {
			loadContacts({ limit: 100 });
		}
	}, [open, contacts.length, loadContacts]);

	if (!open) {
		return (
			<Button size="sm" onClick={() => setOpen(true)}>
				New Deal
			</Button>
		);
	}

	return (
		<div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
			<h3 className="mb-3 text-sm font-semibold text-foreground">New Deal</h3>
			<div className="space-y-3">
				<Input
					type="text"
					placeholder="Deal title"
					value={title}
					onChange={(e) => setTitle(e.target.value)}
				/>
				<ContactCombobox
					contacts={contacts}
					value={contactId}
					onSelect={setContactId}
					placeholder="Select contact..."
				/>
				<div className="flex gap-3">
					<select
						value={dealType}
						onChange={(e) => setDealType(e.target.value)}
						className="rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
					>
						<option value="investment">Investment</option>
						<option value="advisory">Advisory</option>
						<option value="partnership">Partnership</option>
						<option value="token">Token</option>
						<option value="other">Other</option>
					</select>
					<Input
						type="number"
						placeholder="Value (USD)"
						value={value}
						onChange={(e) => setValue(e.target.value)}
						className="w-32"
					/>
				</div>
				<Textarea
					placeholder="Notes (optional)"
					value={notes}
					onChange={(e) => setNotes(e.target.value)}
					rows={2}
				/>
				<div className="flex gap-2">
					<Button
						onClick={() =>
							create({
								title: trimmedTitle,
								contactId,
								dealType: dealType as 'investment' | 'advisory' | 'partnership' | 'token' | 'other',
								value: Math.round(Number(value) * 100) || 0,
								notes: trimmedNotes || undefined,
							})
						}
						disabled={isExecuting || !trimmedTitle || !contactId}
					>
						{isExecuting ? 'Creating...' : 'Create Deal'}
					</Button>
					<Button variant="outline" onClick={() => setOpen(false)}>
						Cancel
					</Button>
				</div>
			</div>
		</div>
	);
}
