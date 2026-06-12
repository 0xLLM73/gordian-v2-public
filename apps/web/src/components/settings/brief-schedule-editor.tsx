'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { updateBriefScheduleAction } from '@/app/actions/settings';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
type BriefDay = (typeof DAYS)[number];

const DAY_LABELS: Record<BriefDay, string> = {
	mon: 'Mon',
	tue: 'Tue',
	wed: 'Wed',
	thu: 'Thu',
	fri: 'Fri',
	sat: 'Sat',
	sun: 'Sun',
};

const TIMEZONES = [
	'UTC',
	'America/New_York',
	'America/Chicago',
	'America/Denver',
	'America/Los_Angeles',
	'America/Toronto',
	'Europe/London',
	'Europe/Paris',
	'Europe/Berlin',
	'Asia/Dubai',
	'Asia/Singapore',
	'Asia/Tokyo',
	'Asia/Hong_Kong',
	'Asia/Seoul',
	'Australia/Sydney',
];

interface Props {
	currentTime: number; // hour 0-23
	currentTimezone: string;
	currentDays: BriefDay[];
}

export function BriefScheduleEditor({ currentTime, currentTimezone, currentDays }: Props) {
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
		const form = new FormData(e.currentTarget);

		const timeStr = form.get('timeInput') as string;
		const hour = timeStr ? Number(timeStr.split(':')[0]) : currentTime;

		const timezone = form.get('timezone') as string;
		const briefDays = DAYS.filter((d) => form.get(`day-${d}`) === 'on');
		if (briefDays.length === 0) return;

		startTransition(async () => {
			await updateBriefScheduleAction({ briefTime: hour, timezone, briefDays });
			showSaved();
		});
	}

	const timeValue = `${String(currentTime).padStart(2, '0')}:00`;

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			<div className="grid gap-4 sm:grid-cols-2">
				<div>
					<label htmlFor="timeInput" className="mb-1 block text-sm font-medium text-foreground">
						Send time
					</label>
					<input
						id="timeInput"
						name="timeInput"
						type="time"
						defaultValue={timeValue}
						required
						className="w-full rounded-md border border-border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
					/>
				</div>

				<div>
					<label htmlFor="timezone" className="mb-1 block text-sm font-medium text-foreground">
						Timezone
					</label>
					<select
						id="timezone"
						name="timezone"
						defaultValue={currentTimezone}
						className="w-full rounded-md border border-border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
					>
						{TIMEZONES.map((tz) => (
							<option key={tz} value={tz}>
								{tz}
							</option>
						))}
					</select>
				</div>
			</div>

			<div>
				<p className="mb-2 text-sm font-medium text-foreground">Days</p>
				<div className="flex flex-wrap gap-3">
					{DAYS.map((day) => (
						<label key={day} className="flex cursor-pointer items-center gap-1.5">
							<input
								type="checkbox"
								name={`day-${day}`}
								defaultChecked={currentDays.includes(day)}
								className="h-4 w-4 rounded border-border text-primary focus:ring-blue-500"
							/>
							<span className="text-sm text-foreground">{DAY_LABELS[day]}</span>
						</label>
					))}
				</div>
			</div>

			<div className="flex items-center gap-3">
				<button
					type="submit"
					disabled={isPending}
					className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
				>
					{isPending ? 'Saving...' : 'Save'}
				</button>
				{saved ? <span className="text-sm text-green-600">Saved</span> : null}
			</div>
		</form>
	);
}
