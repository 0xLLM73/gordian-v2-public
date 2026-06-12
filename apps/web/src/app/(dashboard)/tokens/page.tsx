import { getTopMentionedTokens, getWatchlist } from '@repo/db';
import { Suspense } from 'react';
import { RemoveWatchlistButton } from '@/components/tokens/remove-watchlist-button';
import { getUserWorkspaceId, requireSession } from '@/lib/workspace';
import { AddToWatchlistForm } from './add-watchlist-form';

export default async function TokensPage() {
	const session = await requireSession();
	const workspaceId = await getUserWorkspaceId(session.user.id);

	return (
		<div>
			<div className="mb-6 flex items-center justify-between">
				<h1 className="text-2xl font-bold text-foreground">Tokens</h1>
			</div>

			{workspaceId ? (
				<div className="space-y-8">
					<section>
						<div className="mb-3 flex items-center justify-between">
							<h2 className="text-lg font-semibold text-gray-800">Watchlist</h2>
							<AddToWatchlistForm />
						</div>
						<Suspense fallback={<TableSkeleton />}>
							<WatchlistTable workspaceId={workspaceId} />
						</Suspense>
					</section>

					<section>
						<h2 className="mb-3 text-lg font-semibold text-gray-800">Top Mentions</h2>
						<Suspense fallback={<TableSkeleton />}>
							<MentionsTable workspaceId={workspaceId} />
						</Suspense>
					</section>
				</div>
			) : (
				<p className="text-sm text-muted-foreground">
					Connect Telegram to start tracking token mentions.
				</p>
			)}
		</div>
	);
}

async function WatchlistTable({ workspaceId }: { workspaceId: string }) {
	const items = await getWatchlist(workspaceId);

	if (items.length === 0) {
		return (
			<div className="rounded-lg border border-border bg-muted p-6 text-center text-sm text-muted-foreground">
				No tokens in watchlist. Add tokens to track their prices.
			</div>
		);
	}

	return (
		<div className="overflow-hidden rounded-lg border border-border">
			<table className="min-w-full divide-y divide-border">
				<thead className="bg-muted">
					<tr>
						<th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
							Token
						</th>
						<th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
							Price
						</th>
						<th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
							24h
						</th>
						<th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
							Mentions
						</th>
						<th className="w-20 px-4 py-3" />
					</tr>
				</thead>
				<tbody className="divide-y divide-border bg-card">
					{items.map((t: Record<string, unknown>) => {
						const change = Number(t.priceChange24h ?? 0);
						const isPositive = change >= 0;
						return (
							<tr key={t.id as string}>
								<td className="px-4 py-3">
									<span className="font-medium text-foreground">{t.symbol as string}</span>
									{t.name ? (
										<span className="ml-2 text-xs text-muted-foreground">{t.name as string}</span>
									) : null}
								</td>
								<td className="px-4 py-3 text-right text-sm text-foreground">
									{t.lastPrice
										? `$${Number(t.lastPrice).toLocaleString(undefined, { maximumFractionDigits: 4 })}`
										: '-'}
								</td>
								<td
									className={`px-4 py-3 text-right text-sm font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}
								>
									{t.priceChange24h ? `${isPositive ? '+' : ''}${change.toFixed(2)}%` : '-'}
								</td>
								<td className="px-4 py-3 text-right text-sm text-muted-foreground">
									{t.mentionCount as number}
								</td>
								<td className="px-4 py-3 text-right">
									<RemoveWatchlistButton symbol={t.symbol as string} />
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

async function MentionsTable({ workspaceId }: { workspaceId: string }) {
	const mentions = await getTopMentionedTokens(workspaceId, 10);

	if (mentions.length === 0) {
		return (
			<div className="rounded-lg border border-border bg-muted p-6 text-center text-sm text-muted-foreground">
				No token mentions detected yet. Mentions appear as conversations are synced.
			</div>
		);
	}

	return (
		<div className="overflow-hidden rounded-lg border border-border">
			<table className="min-w-full divide-y divide-border">
				<thead className="bg-muted">
					<tr>
						<th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
							Token
						</th>
						<th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
							Mentions
						</th>
						<th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
							Latest
						</th>
					</tr>
				</thead>
				<tbody className="divide-y divide-border bg-card">
					{mentions.map((m) => (
						<tr key={m.symbol}>
							<td className="px-4 py-3">
								<span className="font-medium text-foreground">{m.symbol}</span>
								{m.name ? (
									<span className="ml-2 text-xs text-muted-foreground">{m.name}</span>
								) : null}
							</td>
							<td className="px-4 py-3 text-right text-sm text-muted-foreground">{m.count}</td>
							<td className="px-4 py-3 text-right text-xs text-muted-foreground">
								{m.latestMention ? new Date(m.latestMention).toLocaleDateString() : '-'}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function TableSkeleton() {
	return (
		<div className="animate-pulse rounded-lg border border-border bg-muted p-8">
			<div className="space-y-3">
				<div className="h-4 w-48 rounded bg-muted" />
				<div className="h-4 w-36 rounded bg-muted" />
				<div className="h-4 w-40 rounded bg-muted" />
			</div>
		</div>
	);
}
