'use client';

// Needs interactivity: remind/dismiss buttons, acted state, viewport tracking

import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { trackEventAction } from '@/app/actions/analytics';
import { ghostingDismissAction, ghostingRemindAction } from '@/app/actions/ghosting';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDashboardTracking } from '@/hooks/use-dashboard-tracking';
import { HEALTH_BADGE_COLORS } from '@/lib/colors';
import { cn } from '@/lib/utils';

export interface GhostingContact {
	id: string;
	firstName: string | null;
	lastName: string | null;
	lastMessageAt: string | null;
	messageCount: number;
	healthLabel: string | null;
}

interface GhostingAlertCardProps {
	contacts: GhostingContact[];
}

function formatDaysAgo(isoDate: string): number {
	return Math.floor((Date.now() - new Date(isoDate).getTime()) / 86400000);
}

function formatTimeSince(isoDate: string): string {
	const days = formatDaysAgo(isoDate);
	if (days < 7) return `${days} day${days !== 1 ? 's' : ''}`;
	const weeks = Math.floor(days / 7);
	if (weeks < 5) return `${weeks} week${weeks !== 1 ? 's' : ''}`;
	const months = Math.floor(days / 30);
	return `${months} month${months !== 1 ? 's' : ''}`;
}

function ContactRow({ contact }: { contact: GhostingContact }) {
	const [action, setAction] = useState<'remind' | 'dismiss' | null>(null);
	const [isPending, startTransition] = useTransition();
	const rowRef = useRef<HTMLDivElement>(null);
	const viewedRef = useRef(false);
	const ignoredTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
	const { trackWatchExpand, trackGhostingAlertAction } = useDashboardTracking();

	const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Unknown';
	const timeSince = contact.lastMessageAt ? formatTimeSince(contact.lastMessageAt) : null;
	const healthLabel = contact.healthLabel ?? 'dormant';
	const badgeClass = HEALTH_BADGE_COLORS[healthLabel] ?? 'bg-gray-100 text-gray-600';

	// Passive dismissal: viewport tracking
	useEffect(() => {
		if (!rowRef.current || action) return;

		viewedRef.current = false;

		const observer = new IntersectionObserver(
			(entries) => {
				const entry = entries[0];
				if (entry?.isIntersecting && !viewedRef.current) {
					viewedRef.current = true;
					trackEventAction({
						event: 'ghosting_alert.card_viewed',
						properties: { contactId: contact.id },
					}).catch(() => {});

					ignoredTimerRef.current = setTimeout(() => {
						trackEventAction({
							event: 'ghosting_alert.card_ignored',
							properties: { contactId: contact.id },
						}).catch(() => {});
					}, 10_000);
				}
			},
			{ threshold: 0.5 },
		);

		observer.observe(rowRef.current);

		return () => {
			observer.disconnect();
			if (ignoredTimerRef.current) clearTimeout(ignoredTimerRef.current);
		};
	}, [contact.id, action]);

	function handleRemind() {
		if (ignoredTimerRef.current) clearTimeout(ignoredTimerRef.current);
		trackWatchExpand('ghosting_alert', contact.id);
		trackGhostingAlertAction('remind', contact.id);
		startTransition(async () => {
			setAction('remind');
			trackEventAction({
				event: 'ghosting_alert.acted',
				properties: { action: 'remind', contactId: contact.id },
			}).catch(() => {});
			try {
				await ghostingRemindAction({ contactId: contact.id });
				toast.success('Reminder set');
			} catch {
				toast.error('Failed to set reminder');
			}
		});
	}

	function handleDismiss() {
		if (ignoredTimerRef.current) clearTimeout(ignoredTimerRef.current);
		trackWatchExpand('ghosting_alert', contact.id);
		trackGhostingAlertAction('dismiss', contact.id);
		startTransition(async () => {
			setAction('dismiss');
			trackEventAction({
				event: 'ghosting_alert.acted',
				properties: { action: 'dismiss', contactId: contact.id },
			}).catch(() => {});
			try {
				await ghostingDismissAction({ contactId: contact.id });
				toast.success('Alert dismissed');
			} catch {
				toast.error('Failed to dismiss alert');
			}
		});
	}

	return (
		<div
			ref={rowRef}
			className={cn(
				'flex items-center justify-between rounded-md border border-border px-3 py-2.5 transition-all duration-300',
				action && 'opacity-60',
			)}
		>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<p className="text-sm font-medium text-foreground truncate">{name}</p>
					<Badge variant="secondary" className={cn('text-[10px] px-1.5 py-0', badgeClass)}>
						{healthLabel === 'at_risk' ? 'at risk' : healthLabel}
					</Badge>
				</div>
				<p className="mt-0.5 text-xs text-muted-foreground">
					{timeSince ? (
						<>
							Haven&apos;t heard from {contact.firstName || 'them'} in {timeSince}
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
						disabled={isPending}
						onClick={handleRemind}
						className="flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-medium bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors disabled:opacity-50"
					>
						<svg
							aria-hidden="true"
							className="h-3 w-3"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							strokeWidth={2}
						>
							<path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" />
							<circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={2} fill="none" />
						</svg>
						Remind me
					</button>
					<button
						type="button"
						disabled={isPending}
						onClick={handleDismiss}
						className="rounded px-2.5 py-1.5 text-xs font-medium bg-muted text-muted-foreground hover:bg-accent transition-colors disabled:opacity-50"
					>
						Not important
					</button>
				</div>
			) : (
				<span className="text-xs text-muted-foreground ml-3 shrink-0 animate-in fade-in duration-200">
					{action === 'remind' ? 'Reminder set' : 'Dismissed'}
				</span>
			)}
		</div>
	);
}

export function GhostingAlertCard({ contacts }: GhostingAlertCardProps) {
	if (contacts.length === 0) return null;

	return (
		<Card>
			<CardHeader className="pb-3">
				<CardTitle className="text-base font-semibold">
					People you may be losing touch with
				</CardTitle>
				<p className="text-xs text-muted-foreground">
					Contacts whose conversations have gone quiet — a quick check-in goes a long way.
				</p>
			</CardHeader>
			<CardContent className="space-y-2">
				{contacts.map((contact) => (
					<ContactRow key={contact.id} contact={contact} />
				))}
			</CardContent>
		</Card>
	);
}
