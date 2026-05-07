'use client';

import { ContactBubble } from '@/components/onboarding/contact-bubble';
import { GhostingAlertCard } from '@/components/onboarding/ghosting-alert-card';
import type { ContactInsight, StaleContact } from '@/hooks/use-onboarding-sync';
import { cn } from '@/lib/utils';

interface RecentContact {
	id: string;
	firstName: string;
	lastName: string;
}

const STAGE_TEXT: Record<string, string> = {
	connecting: 'Connecting to Telegram securely',
	contacts: 'Reading your contact list',
	messages: 'Analyzing message history',
	stale_contacts: 'Computing relationship patterns',
	complete: 'Sync complete!',
};

interface LiveSyncFeedProps {
	contacts: number;
	messages: number;
	stage: string;
	isComplete: boolean;
	recentContacts: RecentContact[];
	feedEvents: ContactInsight[];
	staleContacts: StaleContact[];
}

function formatDaysAgo(isoDate: string): number {
	return Math.floor((Date.now() - new Date(isoDate).getTime()) / 86400000);
}

export function LiveSyncFeed({
	contacts,
	messages,
	stage,
	isComplete,
	recentContacts,
	feedEvents,
	staleContacts,
}: LiveSyncFeedProps) {
	return (
		<div className="space-y-6">
			{/* Stage text */}
			<p className="text-sm font-medium text-foreground">
				{STAGE_TEXT[stage] ?? stage}
				{!isComplete && <span className="animate-pulse">...</span>}
			</p>

			{/* Counter bar */}
			<div className="flex gap-8">
				<div>
					<span className="text-3xl font-bold tabular-nums text-foreground">{contacts}</span>
					<span className="ml-1.5 text-sm text-muted-foreground">contacts</span>
				</div>
				<div>
					<span className="text-3xl font-bold tabular-nums text-foreground">{messages}</span>
					<span className="ml-1.5 text-sm text-muted-foreground">messages</span>
				</div>
			</div>

			{/* Sync feed narrative — per-contact insights as they arrive */}
			{feedEvents.length > 0 && (
				<div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-muted/20 p-3 space-y-1.5">
					{feedEvents.map((event, i) => {
						const daysAgo = formatDaysAgo(event.lastMessageAt);
						const key = `${event.name}-${i}`;
						return (
							<p
								key={key}
								className="text-sm text-muted-foreground animate-in fade-in slide-in-from-bottom-1 duration-300"
							>
								<span className="font-medium text-foreground">{event.name}</span>
								{' — '}
								{daysAgo === 0
									? 'last message today'
									: `last message ${daysAgo} day${daysAgo !== 1 ? 's' : ''} ago`}
							</p>
						);
					})}
				</div>
			)}

			{/* Ghosting alert — drops after build-up */}
			{staleContacts.length > 0 && <GhostingAlertCard staleContacts={staleContacts} />}

			{/* Contact bubbles */}
			{recentContacts.length > 0 && (
				<div
					className={cn(
						'flex flex-wrap gap-3 rounded-lg border border-border bg-muted/30 p-4',
						'min-h-[100px]',
					)}
				>
					{recentContacts.map((contact, i) => (
						<ContactBubble
							key={contact.id}
							firstName={contact.firstName}
							lastName={contact.lastName}
							index={i}
						/>
					))}
				</div>
			)}
		</div>
	);
}
