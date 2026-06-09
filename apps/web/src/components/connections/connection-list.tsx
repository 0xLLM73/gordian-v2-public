import { ConnectionActions } from '@/components/connections/connection-actions';
import { CONNECTION_STATUS_COLORS } from '@/lib/colors';
import { getWorkspaceEnvelope } from '@/lib/workspace';
import { getContactsByIds, listConnections } from '@repo/db';
import Link from 'next/link';

export async function ConnectionList({
	workspaceId,
	event,
}: { workspaceId: string; event?: string }) {
	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) {
		return <p className="text-sm text-muted-foreground">Workspace not found.</p>;
	}
	const connectionsList = await listConnections(workspaceId, { event, limit: 50 }, envelope);

	if (!connectionsList || connectionsList.length === 0) {
		return (
			<div className="mt-4 rounded-lg border border-border bg-muted p-8 text-center">
				<p className="text-sm text-muted-foreground">
					No new connections detected yet. Use Find new connections to scan recent contact-linked
					messages for first-meeting signals.
				</p>
			</div>
		);
	}

	const contactIds = new Set<string>();
	for (const conn of connectionsList) {
		if (conn.contactId) contactIds.add(conn.contactId);
	}

	const contactMap = new Map<string, string>();
	if (contactIds.size > 0) {
		const envelope = await getWorkspaceEnvelope(workspaceId);
		if (envelope) {
			const contacts = await getContactsByIds(workspaceId, [...contactIds], envelope);
			for (const c of contacts) {
				contactMap.set(
					c.id as string,
					[c.firstName as string, c.lastName as string].filter(Boolean).join(' ') || 'Unknown',
				);
			}
		}
	}

	return (
		<div className="mt-4 divide-y divide-border rounded-lg border border-border">
			{connectionsList.map((conn) => (
				<ConnectionCard key={conn.id} connection={conn} contactMap={contactMap} />
			))}
		</div>
	);
}

function ConnectionCard({
	connection,
	contactMap,
}: {
	connection: Record<string, unknown>;
	contactMap: Map<string, string>;
}) {
	const status = connection.status as string;
	const confidence = Math.round((connection.confidence as number) * 100);
	const contactId = connection.contactId as string;
	const event = connection.event as string | null;
	const context = connection.context as string | null;

	const getName = (cid: string) => contactMap.get(cid) || `${cid?.slice(0, 8)}...`;

	return (
		<div className="p-4">
			<div className="flex items-center justify-between">
				<div>
					<p className="font-medium text-foreground">
						{'Met '}
						<Link href={`/contacts/${contactId}`} className="hover:text-primary">
							{getName(contactId)}
						</Link>
					</p>
					<div className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
						<span>Confidence: {confidence}%</span>
						{context ? (
							<>
								<span>·</span>
								<span>{context}</span>
							</>
						) : null}
					</div>
				</div>
				<div className="flex items-center gap-2">
					<ConnectionActions connectionId={connection.id as string} status={status} />
					{event ? (
						<span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
							{event}
						</span>
					) : null}
					<span
						className={`rounded-full px-2 py-0.5 text-xs font-medium ${CONNECTION_STATUS_COLORS[status] || CONNECTION_STATUS_COLORS.detected}`}
					>
						{status}
					</span>
				</div>
			</div>
			{connection.note ? (
				<p className="mt-1 text-sm text-muted-foreground">{connection.note as string}</p>
			) : null}
			<p className="mt-1 text-xs text-muted-foreground">
				Detected: {new Date(connection.detectedAt as string).toLocaleDateString()}
			</p>
		</div>
	);
}
