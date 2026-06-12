import { getContactsByIds, getIntroducerLeaderboard } from '@repo/db';
import Link from 'next/link';
import { getWorkspaceEnvelope } from '@/lib/workspace';

interface IntroducerLeaderboardProps {
	workspaceId: string;
}

export async function IntroducerLeaderboard({ workspaceId }: IntroducerLeaderboardProps) {
	const leaderboard = await getIntroducerLeaderboard(workspaceId, 5);
	if (leaderboard.length === 0) return null;

	const envelope = await getWorkspaceEnvelope(workspaceId);
	const contactIds = leaderboard.map((r) => r.introducerContactId);
	const contacts =
		envelope && contactIds.length > 0
			? await getContactsByIds(workspaceId, contactIds, envelope)
			: [];

	const nameMap = new Map<string, string>();
	for (const c of contacts) {
		nameMap.set(
			c.id as string,
			[c.firstName as string, c.lastName as string].filter(Boolean).join(' ') || 'Unknown',
		);
	}

	return (
		<div className="rounded-lg border border-border p-4">
			<h3 className="mb-3 text-sm font-semibold text-foreground">Top Active Introducers</h3>
			<div className="space-y-2">
				{leaderboard.map((entry, i) => (
					<div
						key={entry.introducerContactId}
						className="flex items-center justify-between text-sm"
					>
						<div className="flex items-center gap-2 min-w-0">
							<span className="shrink-0 w-5 text-center text-xs font-medium text-muted-foreground">
								{i + 1}
							</span>
							<Link
								href={`/contacts/${entry.introducerContactId}`}
								className="truncate hover:text-primary transition-colors"
							>
								{nameMap.get(entry.introducerContactId) ??
									`${entry.introducerContactId.slice(0, 8)}...`}
							</Link>
						</div>
						<span className="shrink-0 ml-2 text-xs font-medium text-muted-foreground">
							{entry.count} intro{entry.count !== 1 ? 's' : ''}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}
