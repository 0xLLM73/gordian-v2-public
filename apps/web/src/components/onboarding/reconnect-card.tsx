'use client';

import { useEffect, useState } from 'react';
import { GuidedActionCard } from '@/components/onboarding/guided-action-card';
import { getContactInitial } from '@/lib/contact-initial';

interface GhostedContact {
	id: string;
	firstName: string;
	lastName: string;
	healthLabel: string;
}

/** Labels considered "ghosted" — contacts needing reconnection */
const GHOSTED_LABELS = new Set(['dormant', 'at_risk', 'fading']);

export function ReconnectCard() {
	const [contacts, setContacts] = useState<GhostedContact[]>([]);
	const [loading, setLoading] = useState(true);
	const [skipped, setSkipped] = useState(false);

	useEffect(() => {
		async function load() {
			try {
				const res = await fetch('/api/onboarding/recent-contacts');
				if (!res.ok) return;
				const data = (await res.json()) as Array<{
					id: string;
					firstName: string;
					lastName: string;
					healthLabel?: string | null;
					recency?: number | null;
				}>;

				const ghosted = data
					.filter((c) => c.healthLabel && GHOSTED_LABELS.has(c.healthLabel))
					.sort((a, b) => (a.recency ?? 0) - (b.recency ?? 0))
					.slice(0, 3)
					.map((c) => ({
						id: c.id,
						firstName: c.firstName,
						lastName: c.lastName,
						healthLabel: c.healthLabel ?? 'dormant',
					}));

				setContacts(ghosted);
			} catch {
				// Non-critical — show empty state
			} finally {
				setLoading(false);
			}
		}
		load();
	}, []);

	if (skipped) return null;

	const labelDisplay: Record<string, string> = {
		dormant: 'Dormant',
		at_risk: 'At risk',
		fading: 'Fading',
	};

	return (
		<GuidedActionCard
			title="Reconnect with contacts"
			description="Contacts that could use some attention"
			accentColor="bg-warning"
			defaultExpanded
			onSkip={() => setSkipped(true)}
		>
			{loading ? (
				<div className="space-y-2">
					{[1, 2, 3].map((i) => (
						<div key={i} className="h-10 animate-pulse rounded bg-muted" />
					))}
				</div>
			) : contacts.length === 0 ? (
				<p className="text-xs text-muted-foreground">
					Great — you're staying in touch with everyone!
				</p>
			) : (
				<div className="space-y-2">
					{contacts.map((c) => {
						const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown';
						return (
							<div
								key={c.id}
								className="flex items-center justify-between rounded-md border border-border px-3 py-2"
							>
								<div className="flex items-center gap-2">
									<div className="flex h-7 w-7 items-center justify-center rounded-full bg-warning/10 text-xs font-bold text-warning">
										{getContactInitial(c.firstName, c.lastName)}
									</div>
									<span className="text-sm font-medium text-foreground">{name}</span>
								</div>
								<span className="text-xs text-muted-foreground">
									{labelDisplay[c.healthLabel] ?? c.healthLabel}
								</span>
							</div>
						);
					})}
				</div>
			)}
		</GuidedActionCard>
	);
}
