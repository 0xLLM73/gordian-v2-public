'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { updateNotificationsAction } from '@/app/actions/settings';

interface Props {
	briefEnabled: boolean;
	disabled?: boolean;
	disabledReason?: string;
}

export function NotificationPreferences({ briefEnabled, disabled = false, disabledReason }: Props) {
	const [isPending, startTransition] = useTransition();
	const [saved, setSaved] = useState(false);
	const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(
		() => () => {
			if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
		},
		[],
	);

	function showSaved() {
		setSaved(true);
		if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
		savedTimerRef.current = setTimeout(() => setSaved(false), 2000);
	}

	function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		if (disabled) return;
		const form = new FormData(e.currentTarget);
		const enabled = form.get('briefEnabled') === 'on';
		startTransition(async () => {
			await updateNotificationsAction({ briefEnabled: enabled });
			showSaved();
		});
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			<label
				className={`flex items-center gap-3 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
			>
				<input
					type="checkbox"
					name="briefEnabled"
					defaultChecked={briefEnabled}
					disabled={disabled}
					className="h-4 w-4 rounded border-border text-primary focus:ring-blue-500"
				/>
				<span className="text-sm text-foreground">
					Enable morning brief notifications via Telegram
				</span>
			</label>
			{disabledReason ? (
				<p className="rounded-md border border-dashed border-border bg-muted p-3 text-sm text-muted-foreground">
					{disabledReason}
				</p>
			) : null}

			<div className="flex items-center gap-3">
				<button
					type="submit"
					disabled={isPending || disabled}
					className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
				>
					{isPending ? 'Saving...' : 'Save'}
				</button>
				{saved ? <span className="text-sm text-green-600">Saved</span> : null}
			</div>
		</form>
	);
}
