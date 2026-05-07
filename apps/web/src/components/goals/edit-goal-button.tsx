'use client';

import { updateGoalAction } from '@/app/actions/goals';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAction } from 'next-safe-action/hooks';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

interface EditGoalButtonProps {
	goalId: string;
	initialTitle: string;
	initialDescription: string | null;
	initialType: string;
	initialTargetCount: number;
	initialTargetDate: string | null;
}

export function EditGoalButton({
	goalId,
	initialTitle,
	initialDescription,
	initialType,
	initialTargetCount,
	initialTargetDate,
}: EditGoalButtonProps) {
	const [open, setOpen] = useState(false);
	const [title, setTitle] = useState(initialTitle);
	const [description, setDescription] = useState(initialDescription || '');
	const [type, setType] = useState(initialType || 'business');
	const [targetCount, setTargetCount] = useState(String(initialTargetCount));
	const [targetDate, setTargetDate] = useState(
		initialTargetDate ? initialTargetDate.slice(0, 10) : '',
	);
	const router = useRouter();

	const { execute, isExecuting } = useAction(updateGoalAction, {
		onSuccess: () => {
			toast.success('Goal updated');
			setOpen(false);
			router.refresh();
		},
		onError: () => toast.error('Failed to update goal'),
	});

	if (!open) {
		return (
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="text-left font-medium text-foreground hover:text-primary"
			>
				{initialTitle}
			</button>
		);
	}

	return (
		<div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
			<div className="space-y-2">
				<Input
					type="text"
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					placeholder="Goal title"
				/>
				<Input
					type="text"
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					placeholder="Description (optional)"
				/>
				<div className="flex gap-2">
					<select
						value={type}
						onChange={(e) => setType(e.target.value)}
						className="rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
					>
						<option value="relationship">Relationship</option>
						<option value="business">Business</option>
						<option value="habit">Habit</option>
						<option value="network">Network</option>
					</select>
					<Input
						type="number"
						value={targetCount}
						onChange={(e) => setTargetCount(e.target.value)}
						placeholder="Target"
						min="1"
						className="w-24"
					/>
					<Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
				</div>
				<div className="flex gap-2">
					<Button
						size="sm"
						onClick={() =>
							execute({
								goalId,
								title,
								description: description || null,
								type: type as 'relationship' | 'business' | 'habit' | 'network',
								targetCount: Number(targetCount) || 1,
								targetDate: targetDate ? new Date(targetDate).toISOString() : null,
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
							setDescription(initialDescription || '');
							setType(initialType || 'business');
							setTargetCount(String(initialTargetCount));
							setTargetDate(initialTargetDate ? initialTargetDate.slice(0, 10) : '');
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
