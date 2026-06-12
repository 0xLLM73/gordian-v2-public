'use client';

import { useState } from 'react';
import { trackEventAction } from '@/app/actions/analytics';
import { ghostingDismissAction, ghostingRemindAction } from '@/app/actions/ghosting';
import type { StaleContact } from '@/hooks/use-onboarding-sync';
import { cn } from '@/lib/utils';

interface GhostingAlertCardProps {
	staleContacts: StaleContact[];
}

function deriveFrequency(messageCount: number, lastMessageAt: string | null): string | null {
	if (!lastMessageAt || messageCount < 2) return null;
	const firstSeen = new Date(lastMessageAt);
	const monthsSpan = Math.max(1, (Date.now() - firstSeen.getTime()) / (30 * 86400000));
	const msgsPerMonth = messageCount / monthsSpan;
	if (msgsPerMonth >= 4) return 'used to message weekly';
	if (msgsPerMonth >= 1) return 'used to message monthly';
	return null;
}

function formatDaysAgo(isoDate: string): number {
	return Math.floor((Date.now() - new Date(isoDate).getTime()) / 86400000);
}

export function GhostingAlertCard({ staleContacts }: GhostingAlertCardProps) {
	const [acted, setActed] = useState<Record<string, 'remind' | 'dismiss'>>({});

	const handleRemind = async (contact: StaleContact) => {
		setActed((prev) => ({ ...prev, [contact.id]: 'remind' }));
		trackEventAction({
			event: 'ghosting_alert.acted',
			properties: { action: 'remind' },
		});
		ghostingRemindAction({ contactId: contact.id }).catch(() => {});
	};

	const handleDismiss = async (contact: StaleContact) => {
		setActed((prev) => ({ ...prev, [contact.id]: 'dismiss' }));
		trackEventAction({
			event: 'ghosting_alert.acted',
			properties: { action: 'dismiss' },
		});
		ghostingDismissAction({ contactId: contact.id }).catch(() => {});
	};

	return (
		<div className="rounded-xl border-2 border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/20 p-4 space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-500">
			<p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
				People you may be losing touch with
			</p>
			{staleContacts.map((contact) => {
				const daysAgo = contact.lastMessageAt ? formatDaysAgo(contact.lastMessageAt) : null;
				const frequency = deriveFrequency(contact.messageCount, contact.lastMessageAt);
				const action = acted[contact.id];

				return (
					<div
						key={contact.id}
						className={cn(
							'flex items-center justify-between rounded-lg bg-white/60 dark:bg-white/5 px-3 py-2',
							action && 'opacity-60',
						)}
					>
						<div className="min-w-0 flex-1">
							<p className="text-sm font-medium text-foreground truncate">
								{contact.firstName} {contact.lastName}
							</p>
							<p className="text-xs text-muted-foreground">
								{daysAgo !== null ? (
									<>
										{daysAgo} day{daysAgo !== 1 ? 's' : ''} ago
										{frequency && <> — {frequency}</>}
									</>
								) : (
									'No recent messages'
								)}
							</p>
						</div>
						{!action ? (
							<div className="flex gap-2 ml-3 shrink-0">
								<button
									type="button"
									onClick={() => handleRemind(contact)}
									className="text-xs font-medium text-amber-700 dark:text-amber-300 hover:underline"
								>
									Remind me
								</button>
								<button
									type="button"
									onClick={() => handleDismiss(contact)}
									className="text-xs text-muted-foreground hover:underline"
								>
									Not important
								</button>
							</div>
						) : (
							<span className="text-xs text-muted-foreground ml-3 shrink-0">
								{action === 'remind' ? 'Reminder set' : 'Dismissed'}
							</span>
						)}
					</div>
				);
			})}
		</div>
	);
}
