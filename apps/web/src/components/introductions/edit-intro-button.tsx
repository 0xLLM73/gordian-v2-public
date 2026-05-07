'use client';

import { updateIntroductionAction } from '@/app/actions/introductions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAction } from 'next-safe-action/hooks';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

interface EditIntroButtonProps {
	introductionId: string;
	initialContext: string;
	initialNote: string | null;
}

export function EditIntroButton({
	introductionId,
	initialContext,
	initialNote,
}: EditIntroButtonProps) {
	const [open, setOpen] = useState(false);
	const [context, setContext] = useState(initialContext || 'other');
	const [note, setNote] = useState(initialNote || '');
	const router = useRouter();

	const { execute, isExecuting } = useAction(updateIntroductionAction, {
		onSuccess: () => {
			toast.success('Introduction updated');
			setOpen(false);
			router.refresh();
		},
		onError: () => toast.error('Failed to update introduction'),
	});

	if (!open) {
		return (
			<Button
				variant="ghost"
				size="sm"
				onClick={() => setOpen(true)}
				className="text-muted-foreground hover:text-primary"
			>
				Edit
			</Button>
		);
	}

	return (
		<div className="mt-2 rounded-md border border-primary/20 bg-primary/5 p-3">
			<div className="space-y-2">
				<div className="flex gap-2">
					<select
						value={context}
						onChange={(e) => setContext(e.target.value)}
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
						value={note}
						onChange={(e) => setNote(e.target.value)}
						placeholder="Note (optional)"
						className="flex-1"
					/>
				</div>
				<div className="flex gap-2">
					<Button
						size="sm"
						onClick={() =>
							execute({
								introductionId,
								context: context as 'deal' | 'hiring' | 'knowledge' | 'social' | 'other',
								note: note || null,
							})
						}
						disabled={isExecuting}
					>
						{isExecuting ? 'Saving...' : 'Save'}
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => {
							setContext(initialContext || 'other');
							setNote(initialNote || '');
							setOpen(false);
						}}
					>
						Cancel
					</Button>
				</div>
			</div>
		</div>
	);
}
