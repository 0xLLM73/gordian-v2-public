'use client';

import { upsertContactTagAction } from '@/app/actions/contact-tags';
import { useState, useTransition } from 'react';

const RELATIONSHIP_OPTIONS = [
	'friend',
	'colleague',
	'prospect',
	'client',
	'investor',
	'family',
	'mentor',
	'mentee',
	'partner',
	'vendor',
	'other',
] as const;

const PRIORITY_OPTIONS = ['high', 'medium', 'low'] as const;

const STATUS_OPTIONS = ['active', 'nurturing', 'dormant', 'new'] as const;

interface ContactTagEditorProps {
	contactId: string;
	initialData?: {
		relationship?: string | null;
		priority?: string | null;
		status?: string | null;
		customTags?: string[] | null;
		goal?: string | null;
		notes?: string | null;
	} | null;
}

export function ContactTagEditor({ contactId, initialData }: ContactTagEditorProps) {
	const [relationship, setRelationship] = useState(initialData?.relationship ?? '');
	const [priority, setPriority] = useState(initialData?.priority ?? 'medium');
	const [status, setStatus] = useState(initialData?.status ?? 'new');
	const [tagInput, setTagInput] = useState('');
	const [customTags, setCustomTags] = useState<string[]>(initialData?.customTags ?? []);
	const [goal, setGoal] = useState(initialData?.goal ?? '');
	const [notes, setNotes] = useState(initialData?.notes ?? '');
	const [isPending, startTransition] = useTransition();
	const [saved, setSaved] = useState(false);

	function handleAddTag() {
		const trimmed = tagInput.trim();
		if (trimmed && !customTags.includes(trimmed)) {
			setCustomTags([...customTags, trimmed]);
		}
		setTagInput('');
	}

	function handleRemoveTag(tag: string) {
		setCustomTags(customTags.filter((t) => t !== tag));
	}

	function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault();
			handleAddTag();
		}
	}

	function handleSave() {
		setSaved(false);
		startTransition(async () => {
			const result = await upsertContactTagAction({
				contactId,
				relationship: (relationship || undefined) as
					| (typeof RELATIONSHIP_OPTIONS)[number]
					| undefined,
				priority: (priority || undefined) as (typeof PRIORITY_OPTIONS)[number] | undefined,
				status: (status || undefined) as (typeof STATUS_OPTIONS)[number] | undefined,
				customTags: customTags.length > 0 ? customTags : undefined,
				goal: goal || undefined,
				notes: notes || undefined,
			});
			if (result?.data) {
				setSaved(true);
				setTimeout(() => setSaved(false), 2000);
			}
		});
	}

	return (
		<div className="rounded-lg border border-border bg-card p-6">
			<h2 className="mb-4 text-lg font-semibold text-foreground">Tags & Categorization</h2>

			<div className="space-y-4">
				{/* Relationship */}
				<div>
					<label htmlFor="relationship" className="block text-sm font-medium text-foreground">
						Relationship
					</label>
					<select
						id="relationship"
						value={relationship}
						onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setRelationship(e.target.value)}
						className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
					>
						<option value="">Select...</option>
						{RELATIONSHIP_OPTIONS.map((opt) => (
							<option key={opt} value={opt}>
								{opt.charAt(0).toUpperCase() + opt.slice(1)}
							</option>
						))}
					</select>
				</div>

				{/* Priority */}
				<div>
					<span className="block text-sm font-medium text-foreground">Priority</span>
					<div className="mt-1 flex gap-4">
						{PRIORITY_OPTIONS.map((opt) => (
							<label key={opt} className="flex items-center gap-1.5 text-sm text-foreground">
								<input
									type="radio"
									name="priority"
									value={opt}
									checked={priority === opt}
									onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPriority(e.target.value)}
									className="text-primary focus:ring-blue-500"
								/>
								{opt.charAt(0).toUpperCase() + opt.slice(1)}
							</label>
						))}
					</div>
				</div>

				{/* Status */}
				<div>
					<label htmlFor="status" className="block text-sm font-medium text-foreground">
						Status
					</label>
					<select
						id="status"
						value={status}
						onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setStatus(e.target.value)}
						className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
					>
						{STATUS_OPTIONS.map((opt) => (
							<option key={opt} value={opt}>
								{opt.charAt(0).toUpperCase() + opt.slice(1)}
							</option>
						))}
					</select>
				</div>

				{/* Custom Tags */}
				<div>
					<label htmlFor="customTags" className="block text-sm font-medium text-foreground">
						Custom Tags
					</label>
					<div className="mt-1 flex flex-wrap gap-1.5">
						{customTags.map((tag) => (
							<span
								key={tag}
								className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-primary"
							>
								{tag}
								<button
									type="button"
									onClick={() => handleRemoveTag(tag)}
									className="text-blue-500 hover:text-primary"
									aria-label={`Remove tag ${tag}`}
								>
									x
								</button>
							</span>
						))}
					</div>
					<div className="mt-1.5 flex gap-2">
						<input
							id="customTags"
							type="text"
							value={tagInput}
							onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTagInput(e.target.value)}
							onKeyDown={handleKeyDown}
							placeholder="Add a tag..."
							className="block flex-1 rounded-md border border-border px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
						/>
						<button
							type="button"
							onClick={handleAddTag}
							className="rounded-md bg-muted px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
						>
							Add
						</button>
					</div>
				</div>

				{/* Goal */}
				<div>
					<label htmlFor="goal" className="block text-sm font-medium text-foreground">
						Relationship Goal
					</label>
					<textarea
						id="goal"
						value={goal}
						onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setGoal(e.target.value)}
						rows={2}
						placeholder="What do you want from this relationship?"
						className="mt-1 block w-full rounded-md border border-border px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
					/>
				</div>

				{/* Notes */}
				<div>
					<label htmlFor="notes" className="block text-sm font-medium text-foreground">
						Notes
					</label>
					<textarea
						id="notes"
						value={notes}
						onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)}
						rows={3}
						placeholder="Any notes about this contact..."
						className="mt-1 block w-full rounded-md border border-border px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
					/>
				</div>

				{/* Save */}
				<div className="flex items-center gap-3">
					<button
						type="button"
						onClick={handleSave}
						disabled={isPending}
						className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary/90 disabled:opacity-50"
					>
						{isPending ? 'Saving...' : 'Save Tags'}
					</button>
					{saved ? <span className="text-sm text-green-600">Saved</span> : null}
				</div>
			</div>
		</div>
	);
}
