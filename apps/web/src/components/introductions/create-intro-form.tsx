'use client';
// Needs interactivity: form state, action submission, contact loading

import { listContactsAction } from '@/app/actions/contacts';
import { createIntroductionAction } from '@/app/actions/introductions';
import { ContactCombobox } from '@/components/introductions/contact-combobox';
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

export function CreateIntroForm() {
	const [open, setOpen] = useState(false);
	const [contacts, setContacts] = useState<Contact[]>([]);
	const [introducerId, setIntroducerId] = useState('');
	const [person1Id, setPerson1Id] = useState('');
	const [person2Id, setPerson2Id] = useState('');
	const [context, setContext] = useState<'deal' | 'hiring' | 'knowledge' | 'social' | 'other'>(
		'social',
	);
	const [note, setNote] = useState('');
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

	const { execute: create, isExecuting } = useAction(createIntroductionAction, {
		onSuccess: () => {
			toast.success('Introduction recorded');
			setOpen(false);
			setIntroducerId('');
			setPerson1Id('');
			setPerson2Id('');
			setNote('');
			router.refresh();
		},
		onError: () => toast.error('Failed to create introduction'),
	});

	useEffect(() => {
		if (open && contacts.length === 0) {
			loadContacts({ limit: 500 });
		}
	}, [open, contacts.length, loadContacts]);

	if (!open) {
		return (
			<Button size="sm" onClick={() => setOpen(true)}>
				+ Record Introduction
			</Button>
		);
	}

	return (
		<div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
			<h3 className="mb-3 text-sm font-semibold text-foreground">Record Introduction</h3>
			<div className="space-y-3">
				<div>
					<label
						htmlFor="intro-introducer"
						className="block text-xs font-medium text-muted-foreground"
					>
						Introducer
					</label>
					<div className="mt-1">
						<ContactCombobox
							contacts={contacts}
							value={introducerId}
							onSelect={setIntroducerId}
							placeholder="Select who made the intro..."
						/>
					</div>
				</div>
				<div className="grid grid-cols-2 gap-3">
					<div>
						<label
							htmlFor="intro-person1"
							className="block text-xs font-medium text-muted-foreground"
						>
							Person 1
						</label>
						<div className="mt-1">
							<ContactCombobox
								contacts={contacts}
								value={person1Id}
								onSelect={setPerson1Id}
								placeholder="Select contact..."
							/>
						</div>
					</div>
					<div>
						<label
							htmlFor="intro-person2"
							className="block text-xs font-medium text-muted-foreground"
						>
							Person 2
						</label>
						<div className="mt-1">
							<ContactCombobox
								contacts={contacts}
								value={person2Id}
								onSelect={setPerson2Id}
								placeholder="Select contact..."
							/>
						</div>
					</div>
				</div>
				<div className="flex gap-3">
					<select
						value={context}
						onChange={(e) => setContext(e.target.value as typeof context)}
						className="rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
					>
						<option value="social">Social</option>
						<option value="deal">Deal</option>
						<option value="hiring">Hiring</option>
						<option value="knowledge">Knowledge</option>
						<option value="other">Other</option>
					</select>
					<Input
						type="text"
						placeholder="Note (optional)"
						value={note}
						onChange={(e) => setNote(e.target.value)}
						className="flex-1"
					/>
				</div>
				<div className="flex gap-2">
					<Button
						onClick={() =>
							create({
								introducerContactId: introducerId,
								introducedContactId1: person1Id,
								introducedContactId2: person2Id,
								context: context || undefined,
								note: note || undefined,
							})
						}
						disabled={isExecuting || !introducerId || !person1Id || !person2Id}
					>
						{isExecuting ? 'Saving...' : 'Record'}
					</Button>
					<Button variant="outline" onClick={() => setOpen(false)}>
						Cancel
					</Button>
				</div>
			</div>
		</div>
	);
}
