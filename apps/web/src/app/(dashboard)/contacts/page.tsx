import {
	getAccessibleContacts,
	getHealthScore,
	getLastMessageDate,
	getMessageCount,
	getUserTelegramAccountIds,
} from '@repo/db';
import Link from 'next/link';
import { Suspense } from 'react';
import { HEALTH_BADGE_COLORS } from '@/lib/colors';
import { getContactInitial } from '@/lib/contact-initial';
import { formatRelativeDate } from '@/lib/format';
import { getUserWorkspaceId, getWorkspaceEnvelope, requireSession } from '@/lib/workspace';
import { AccountFilter } from './account-filter';
import { AddContactButton } from './add-contact-modal';
import { ContactSearch } from './contact-search';

export default async function ContactsPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const session = await requireSession();
	const workspaceId = await getUserWorkspaceId(session.user.id);
	const params = await searchParams;
	const accountParam = typeof params.account === 'string' ? params.account : undefined;
	const accountIds = workspaceId ? await getUserTelegramAccountIds(session.user.id) : [];
	const selectedAccount = resolveSelectedAccount(accountParam, accountIds);

	return (
		<div>
			<div className="mb-6 flex items-center justify-between">
				<h1 className="text-2xl font-bold text-foreground">Contacts</h1>
				{workspaceId ? <AddContactButton /> : null}
			</div>

			{workspaceId ? <ContactSearch /> : null}

			{workspaceId ? (
				<Suspense fallback={null}>
					<AccountFilterSection accounts={accountIds} selectedAccountKey={selectedAccount?.key} />
				</Suspense>
			) : null}

			<Suspense fallback={<ContactListSkeleton />}>
				{workspaceId ? (
					<ContactList
						workspaceId={workspaceId}
						userId={session.user.id}
						sourceAccountId={selectedAccount?.id}
					/>
				) : (
					<div className="mt-4 rounded-lg border border-border bg-muted p-8 text-center text-sm text-muted-foreground">
						No contacts yet. Contacts will appear here after Telegram sync.
					</div>
				)}
			</Suspense>
		</div>
	);
}

function resolveSelectedAccount(accountParam: string | undefined, accountIds: string[]) {
	if (!accountParam) return undefined;

	const selectedIndex = Number.parseInt(accountParam, 10);
	if (
		Number.isInteger(selectedIndex) &&
		String(selectedIndex) === accountParam &&
		selectedIndex >= 0 &&
		selectedIndex < accountIds.length
	) {
		return { id: accountIds[selectedIndex], key: accountParam };
	}

	const legacyIndex = accountIds.indexOf(accountParam);
	if (legacyIndex >= 0) {
		return { id: accountParam, key: String(legacyIndex) };
	}

	return undefined;
}

async function AccountFilterSection({
	accounts,
	selectedAccountKey,
}: {
	accounts: string[];
	selectedAccountKey?: string;
}) {
	if (accounts.length === 0) return null;
	return (
		<AccountFilter
			accounts={accounts.map((_, index) => ({
				key: String(index),
				label: `Telegram account ${index + 1}`,
			}))}
			selectedAccountKey={selectedAccountKey}
		/>
	);
}

async function ContactList({
	workspaceId,
	userId,
	sourceAccountId,
}: {
	workspaceId: string;
	userId: string;
	sourceAccountId?: string;
}) {
	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) {
		return (
			<div className="mt-4 rounded-lg border border-border bg-muted p-8 text-center text-sm text-muted-foreground">
				No contacts yet. Contacts will appear here after Telegram sync.
			</div>
		);
	}

	const allContacts = await getAccessibleContacts(workspaceId, userId, envelope, { limit: 50 });

	// Apply sourceAccountId filter client-side (getAccessibleContacts doesn't support it directly)
	const contacts = sourceAccountId
		? allContacts.filter((c: Record<string, unknown>) => c.sourceAccountId === sourceAccountId)
		: allContacts;

	if (!contacts || contacts.length === 0) {
		return (
			<div className="mt-4 rounded-lg border border-border bg-muted p-8 text-center text-sm text-muted-foreground">
				{sourceAccountId
					? 'No contacts found for this account.'
					: 'No contacts yet. Contacts will appear here after Telegram sync.'}
			</div>
		);
	}

	// Batch fetch message counts, last message dates, and health scores in parallel
	const contactIds = contacts.map((c: Record<string, unknown>) => c.id as string);
	const [messageCounts, lastMessageDates, healthScores] = await Promise.all([
		Promise.all(contactIds.map((id) => getMessageCount(workspaceId, id))),
		Promise.all(contactIds.map((id) => getLastMessageDate(workspaceId, id))),
		Promise.all(contactIds.map((id) => getHealthScore(workspaceId, id))),
	]);

	return (
		<div className="mt-4 divide-y divide-border rounded-lg border border-border">
			{contacts.map((contact: Record<string, unknown>, i: number) => {
				const msgCount = messageCounts[i] ?? 0;
				const lastDate = lastMessageDates[i] ?? null;
				const health = healthScores[i] ?? null;

				return (
					<Link
						key={contact.id as string}
						href={`/contacts/${contact.id}`}
						className="flex items-center gap-4 p-4 transition-colors hover:bg-accent"
					>
						<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-medium text-primary">
							{getContactInitial(contact.firstName, contact.lastName)}
						</div>
						<div className="min-w-0 flex-1">
							<div className="flex items-center gap-2">
								<p className="truncate font-medium text-foreground">
									{[contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Unknown'}
								</p>
								{health ? (
									<HealthBadge
										label={health.label as string}
										composite={health.composite as number}
									/>
								) : null}
							</div>
							<p className="mt-0.5 truncate text-xs text-muted-foreground">
								{contact.sourceAccountId ? (
									<span className="mr-1.5 inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
										Telegram account
									</span>
								) : null}
								<span>
									{msgCount === 0 ? 'No messages' : `${msgCount} msg${msgCount === 1 ? '' : 's'}`}
								</span>
								{lastDate ? (
									<span className="ml-1.5 text-muted-foreground">
										&middot; Last: {formatRelativeDate(lastDate)}
									</span>
								) : null}
							</p>
						</div>
					</Link>
				);
			})}
		</div>
	);
}

function HealthBadge({ label, composite }: { label: string; composite: number }) {
	const colorClass = HEALTH_BADGE_COLORS[label] ?? 'bg-muted text-muted-foreground';
	const pct = Math.round(composite * 100);
	return (
		<span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${colorClass}`}>
			{pct}%
		</span>
	);
}

function ContactListSkeleton() {
	return (
		<div className="mt-4 divide-y divide-border rounded-lg border border-border">
			{[1, 2, 3, 4, 5].map((i) => (
				<div key={i} className="flex animate-pulse items-center gap-4 p-4">
					<div className="h-10 w-10 rounded-full bg-muted" />
					<div className="flex-1">
						<div className="h-4 w-32 rounded bg-muted" />
						<div className="mt-2 h-3 w-48 rounded bg-muted" />
					</div>
				</div>
			))}
		</div>
	);
}
