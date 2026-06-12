'use client';

import type { UserPreferencesData } from '@repo/db';
import { useState, useTransition } from 'react';
import { updatePreferencesAction } from '@/app/actions/preferences';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Props {
	initial: UserPreferencesData;
}

const ALL_DAYS = [
	{ value: 'mon', label: 'Mon' },
	{ value: 'tue', label: 'Tue' },
	{ value: 'wed', label: 'Wed' },
	{ value: 'thu', label: 'Thu' },
	{ value: 'fri', label: 'Fri' },
	{ value: 'sat', label: 'Sat' },
	{ value: 'sun', label: 'Sun' },
] as const;

const DIGEST_FOCUS_OPTIONS = [
	{ value: 'balanced', label: 'Balanced' },
	{ value: 'commitments', label: 'Commitments' },
	{ value: 'relationships', label: 'Relationships' },
	{ value: 'deals', label: 'Deals' },
	{ value: 'network', label: 'Network' },
] as const;

const COMMON_TIMEZONES = [
	'UTC',
	'America/New_York',
	'America/Chicago',
	'America/Denver',
	'America/Los_Angeles',
	'America/Anchorage',
	'Pacific/Honolulu',
	'Europe/London',
	'Europe/Paris',
	'Europe/Berlin',
	'Asia/Tokyo',
	'Asia/Shanghai',
	'Asia/Kolkata',
	'Asia/Dubai',
	'Australia/Sydney',
	'Pacific/Auckland',
];

export function PreferencesForm({ initial }: Props) {
	const [prefs, setPrefs] = useState(initial);
	const [isPending, startTransition] = useTransition();
	const [saved, setSaved] = useState(false);

	function handleSave() {
		startTransition(async () => {
			const result = await updatePreferencesAction({
				...prefs,
			});
			if (result?.data) {
				setPrefs(result.data);
				setSaved(true);
				setTimeout(() => setSaved(false), 2000);
			}
		});
	}

	function toggleDay(day: UserPreferencesData['briefDays'][number]) {
		setPrefs((prev) => ({
			...prev,
			briefDays: prev.briefDays.includes(day)
				? prev.briefDays.filter((d) => d !== day)
				: [...prev.briefDays, day],
		}));
	}

	return (
		<div className="space-y-5">
			{/* Timezone */}
			<div>
				<label htmlFor="timezone" className="block text-sm font-medium text-foreground">
					Timezone
				</label>
				<select
					id="timezone"
					value={prefs.timezone}
					onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
						setPrefs((prev) => ({ ...prev, timezone: e.target.value }))
					}
					className="mt-1 block w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
				>
					{COMMON_TIMEZONES.map((tz) => (
						<option key={tz} value={tz}>
							{tz.replace(/_/g, ' ')}
						</option>
					))}
				</select>
			</div>

			{/* Brief Enabled */}
			<div className="flex items-center gap-3">
				<input
					id="briefEnabled"
					type="checkbox"
					checked={prefs.briefEnabled}
					onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
						setPrefs((prev) => ({ ...prev, briefEnabled: e.target.checked }))
					}
					className="h-4 w-4 rounded border-input text-blue-600 focus:ring-blue-500"
				/>
				<label htmlFor="briefEnabled" className="text-sm font-medium text-foreground">
					Enable morning briefs
				</label>
			</div>

			{/* Brief Time */}
			<div>
				<label htmlFor="briefTime" className="block text-sm font-medium text-foreground">
					Brief time (hour, 0-23)
				</label>
				<Input
					id="briefTime"
					type="number"
					min={0}
					max={23}
					value={prefs.briefTime}
					onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
						setPrefs((prev) => ({
							...prev,
							briefTime: Math.max(0, Math.min(23, Number(e.target.value))),
						}))
					}
					className="mt-1 w-24"
				/>
				<p className="mt-1 text-xs text-muted-foreground">
					{prefs.briefTime === 0
						? '12:00 AM'
						: prefs.briefTime <= 12
							? `${prefs.briefTime}:00 ${prefs.briefTime < 12 ? 'AM' : 'PM'}`
							: `${prefs.briefTime - 12}:00 PM`}
				</p>
			</div>

			{/* Brief Days */}
			<div>
				<span className="block text-sm font-medium text-foreground">Brief days</span>
				<div className="mt-2 flex flex-wrap gap-2">
					{ALL_DAYS.map((day) => (
						<button
							key={day.value}
							type="button"
							onClick={() => toggleDay(day.value)}
							className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
								prefs.briefDays.includes(day.value)
									? 'bg-blue-600 text-white'
									: 'bg-muted text-muted-foreground hover:bg-accent'
							}`}
						>
							{day.label}
						</button>
					))}
				</div>
			</div>

			{/* Digest Focus */}
			<div>
				<span className="block text-sm font-medium text-foreground">Digest focus</span>
				<div className="mt-2 flex flex-wrap gap-2">
					{DIGEST_FOCUS_OPTIONS.map((opt) => (
						<button
							key={opt.value}
							type="button"
							onClick={() => setPrefs((prev) => ({ ...prev, digestFocus: opt.value }))}
							className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
								prefs.digestFocus === opt.value
									? 'bg-blue-600 text-white'
									: 'bg-muted text-muted-foreground hover:bg-accent'
							}`}
						>
							{opt.label}
						</button>
					))}
				</div>
			</div>

			{/* Save */}
			<Button type="button" onClick={handleSave} disabled={isPending}>
				{isPending ? 'Saving...' : saved ? 'Saved' : 'Save Preferences'}
			</Button>
		</div>
	);
}
