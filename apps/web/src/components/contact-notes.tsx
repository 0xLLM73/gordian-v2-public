'use client';

import { useAction } from 'next-safe-action/hooks';
import { useState } from 'react';
import { updateContactAction } from '@/app/actions/contacts';

export function ContactNotes({
	contactId,
	initialNotes,
}: {
	contactId: string;
	initialNotes: string | null;
}) {
	const [notes, setNotes] = useState(initialNotes || '');
	const [saved, setSaved] = useState(false);

	const { execute, isExecuting } = useAction(updateContactAction, {
		onSuccess: () => {
			setSaved(true);
			setTimeout(() => setSaved(false), 2000);
		},
	});

	return (
		<div className="rounded-lg border border-border bg-card p-4">
			<h3 className="mb-3 text-sm font-semibold text-foreground">Notes</h3>
			<textarea
				value={notes}
				onChange={(e) => {
					setNotes(e.target.value);
					setSaved(false);
				}}
				placeholder="Add notes about this contact..."
				rows={3}
				className="w-full rounded-md border border-border px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
			/>
			<div className="mt-2 flex items-center gap-2">
				<button
					type="button"
					onClick={() => execute({ contactId, notes: notes.trim() || null })}
					disabled={isExecuting}
					className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50"
				>
					{isExecuting ? 'Saving...' : 'Save'}
				</button>
				{saved ? <span className="text-xs text-green-600">Saved</span> : null}
			</div>
		</div>
	);
}
