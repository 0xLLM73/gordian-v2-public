'use client';
// Needs interactivity: toggle statuses, adjust threshold, save

import { updatePreferencesAction } from '@/app/actions/preferences';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

type GhostingStatus = 'cooling' | 'dormant';

interface GhostingPreferencesProps {
	currentStatuses: GhostingStatus[];
	currentStaleDays: number;
}

const STATUS_OPTIONS = [
	{
		value: 'cooling',
		label: 'Cooling',
		description: 'Conversations starting to go quiet',
		className: 'bg-yellow-100 text-yellow-700',
	},
	{
		value: 'dormant',
		label: 'Dormant',
		description: 'No contact for an extended period',
		className: 'bg-red-100 text-red-700',
	},
] as const;

export function GhostingPreferences({
	currentStatuses,
	currentStaleDays,
}: GhostingPreferencesProps) {
	const [statuses, setStatuses] = useState<GhostingStatus[]>(currentStatuses);
	const [staleDays, setStaleDays] = useState(currentStaleDays);
	const [isPending, startTransition] = useTransition();

	function toggleStatus(status: GhostingStatus) {
		setStatuses((prev) =>
			prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status],
		);
	}

	function handleSave() {
		startTransition(async () => {
			const result = await updatePreferencesAction({
				ghostingAlertStatuses: statuses,
				ghostingStaleDays: staleDays,
			});
			if (result?.data) {
				toast.success('Ghosting alert preferences saved');
			} else {
				toast.error('Failed to save preferences');
			}
		});
	}

	return (
		<div className="space-y-5">
			<div>
				<span className="block text-sm font-medium text-foreground">Alert triggers</span>
				<p className="mt-1 text-xs text-muted-foreground">
					Which relationship health statuses should surface ghosting alerts?
				</p>
				<div className="mt-2 flex flex-wrap gap-2">
					{STATUS_OPTIONS.map((opt) => (
						<button
							key={opt.value}
							type="button"
							onClick={() => toggleStatus(opt.value)}
							className={cn(
								'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
								statuses.includes(opt.value)
									? opt.className
									: 'bg-muted text-muted-foreground hover:bg-accent',
							)}
						>
							{opt.label}
						</button>
					))}
				</div>
				{statuses.length === 0 && (
					<p className="mt-2 text-xs text-amber-600">
						No statuses selected — ghosting alerts will be disabled.
					</p>
				)}
			</div>

			<div>
				<label htmlFor="staleDays" className="block text-sm font-medium text-foreground">
					Staleness threshold (days)
				</label>
				<p className="mt-1 text-xs text-muted-foreground">
					How many days without contact before a relationship is flagged?
				</p>
				<Input
					id="staleDays"
					type="number"
					min={7}
					max={180}
					value={staleDays}
					onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
						setStaleDays(Math.max(7, Math.min(180, Number(e.target.value))))
					}
					className="mt-2 w-24"
				/>
				<p className="mt-1 text-xs text-muted-foreground">
					{staleDays <= 14
						? "Very aggressive — you'll see lots of alerts"
						: staleDays <= 30
							? 'Standard — good for active networkers'
							: staleDays <= 60
								? 'Relaxed — only flags truly dormant contacts'
								: 'Very relaxed — only the most neglected contacts'}
				</p>
			</div>

			<Button type="button" onClick={handleSave} disabled={isPending}>
				{isPending ? 'Saving...' : 'Save'}
			</Button>
		</div>
	);
}
