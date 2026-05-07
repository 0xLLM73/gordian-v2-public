'use client';

import { useRouter, useSearchParams } from 'next/navigation';

export function EventFilter({ events }: { events: string[] }) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const currentEvent = searchParams.get('event') ?? '';

	if (events.length === 0) return null;

	return (
		<select
			value={currentEvent}
			onChange={(e) => {
				const params = new URLSearchParams(searchParams.toString());
				params.set('tab', 'connections');
				if (e.target.value) {
					params.set('event', e.target.value);
				} else {
					params.delete('event');
				}
				router.push(`/introductions?${params.toString()}`);
			}}
			className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
		>
			<option value="">All events</option>
			{events.map((event) => (
				<option key={event} value={event}>
					{event}
				</option>
			))}
		</select>
	);
}
