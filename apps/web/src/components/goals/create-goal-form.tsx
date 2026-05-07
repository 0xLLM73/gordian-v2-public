'use client';

import { listContactsAction } from '@/app/actions/contacts';
import { createGoalAction } from '@/app/actions/goals';
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

export function CreateGoalForm() {
	const [open, setOpen] = useState(false);
	const [contacts, setContacts] = useState<Contact[]>([]);
	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');
	const [type, setType] = useState<'relationship' | 'business' | 'habit' | 'network' | 'strategic'>(
		'business',
	);
	const [targetCount, setTargetCount] = useState('5');
	const [targetDate, setTargetDate] = useState('');
	const [contactId, setContactId] = useState('');
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

	const { execute, isExecuting } = useAction(createGoalAction, {
		onSuccess: () => {
			toast.success('Goal created');
			setOpen(false);
			setTitle('');
			setDescription('');
			setTargetCount('5');
			setTargetDate('');
			setContactId('');
			router.refresh();
		},
		onError: () => toast.error('Failed to create goal'),
	});

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
				New Goal
			</Button>
		);
	}

	return (
		<div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
			<h3 className="mb-3 text-sm font-semibold text-foreground">New Goal</h3>
			<div className="space-y-3">
				<Input
					type="text"
					placeholder="Goal title"
					value={title}
					onChange={(e) => setTitle(e.target.value)}
				/>
				<Input
					type="text"
					placeholder="Description (optional)"
					value={description}
					onChange={(e) => setDescription(e.target.value)}
				/>
				<select
					value={contactId}
					onChange={(e) => setContactId(e.target.value)}
					className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
				>
					<option value="">No contact (optional)</option>
					{contacts.map((c) => (
						<option key={c.id} value={c.id}>
							{[c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown'}
						</option>
					))}
				</select>
				<div className="flex gap-3">
					<select
						value={type}
						onChange={(e) => setType(e.target.value as typeof type)}
						className="rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
					>
						<option value="business">Business</option>
						<option value="relationship">Relationship</option>
						<option value="habit">Habit</option>
						<option value="network">Network</option>
						<option value="strategic">Strategic</option>
					</select>
					<Input
						type="number"
						placeholder="Target count"
						value={targetCount}
						onChange={(e) => setTargetCount(e.target.value)}
						min="1"
						className="w-28"
					/>
					<Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
				</div>
				<div className="flex gap-2">
					<Button
						onClick={() =>
							execute({
								title,
								type,
								description: description || undefined,
								targetCount: Number(targetCount) || 5,
								targetDate: targetDate ? new Date(targetDate).toISOString() : undefined,
								contactId: contactId || undefined,
							})
						}
						disabled={isExecuting || !title}
					>
						{isExecuting ? 'Creating...' : 'Create Goal'}
					</Button>
					<Button variant="outline" onClick={() => setOpen(false)}>
						Cancel
					</Button>
				</div>
			</div>
		</div>
	);
}
