'use client';

import { useRouter } from 'next/navigation';
import { useAction } from 'next-safe-action/hooks';
import { useState } from 'react';
import { toast } from 'sonner';
import { updateDealAction } from '@/app/actions/deals';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface EditDealButtonProps {
	dealId: string;
	initialTitle: string;
	initialValue: number;
	initialDealType: string;
	initialNotes: string | null;
}

export function EditDealButton({
	dealId,
	initialTitle,
	initialValue,
	initialDealType,
	initialNotes,
}: EditDealButtonProps) {
	const [open, setOpen] = useState(false);
	const [title, setTitle] = useState(initialTitle);
	const [value, setValue] = useState(String(initialValue / 100));
	const [dealType, setDealType] = useState(initialDealType || 'other');
	const [notes, setNotes] = useState(initialNotes || '');
	const router = useRouter();

	const { execute, isExecuting } = useAction(updateDealAction, {
		onSuccess: () => {
			toast.success('Deal updated');
			setOpen(false);
			router.refresh();
		},
		onError: () => toast.error('Failed to update deal'),
	});

	if (!open) {
		return (
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="max-w-full break-words text-left font-medium text-foreground hover:text-primary"
			>
				{initialTitle}
			</button>
		);
	}

	return (
		<div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
			<div className="space-y-2">
				<Input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
				<div className="flex gap-2">
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
						value={value}
						onChange={(e) => setValue(e.target.value)}
						placeholder="Value (USD)"
						className="w-32"
					/>
				</div>
				<Input
					type="text"
					value={notes}
					onChange={(e) => setNotes(e.target.value)}
					placeholder="Notes (optional)"
				/>
				<div className="flex gap-2">
					<Button
						size="sm"
						onClick={() =>
							execute({
								dealId,
								title,
								dealType: dealType as 'investment' | 'advisory' | 'partnership' | 'token' | 'other',
								value: Math.round(Number(value) * 100) || 0,
								notes: notes || null,
							})
						}
						disabled={isExecuting || !title}
					>
						{isExecuting ? 'Saving...' : 'Save'}
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => {
							setTitle(initialTitle);
							setValue(String(initialValue / 100));
							setDealType(initialDealType || 'other');
							setNotes(initialNotes || '');
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
