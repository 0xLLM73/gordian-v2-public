export interface FollowUpContactContextSummary {
	summary: string | null;
	generatedAt?: Date | string | null;
	messageCount?: number | null;
	styleVariant?: string | null;
}

export interface FollowUpContactContextMessage {
	id: string;
	text: string | null;
	isOutgoing: boolean;
	sentAt: Date | string;
}

function formatDateTime(value: Date | string | null | undefined) {
	if (!value) return 'No local messages yet';
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return 'Unknown';
	return date.toLocaleString();
}

export function FollowUpContactContext({
	contactName,
	summary,
	messages,
	messageCount,
	lastMessageAt,
}: {
	contactName: string | null;
	summary: FollowUpContactContextSummary | null;
	messages: FollowUpContactContextMessage[];
	messageCount: number;
	lastMessageAt: Date | string | null;
}) {
	return (
		<div className="mb-6 rounded-lg border border-border bg-card p-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<p className="text-xs font-medium uppercase text-muted-foreground">Contact context</p>
					<h2 className="mt-1 text-base font-semibold text-foreground">
						{contactName ?? 'Unknown contact'}
					</h2>
				</div>
				<div className="grid gap-2 text-sm sm:grid-cols-2">
					<div className="rounded-md bg-muted/50 px-3 py-2">
						<p className="text-xs text-muted-foreground">Messages</p>
						<p className="font-medium text-foreground">{messageCount}</p>
					</div>
					<div className="rounded-md bg-muted/50 px-3 py-2">
						<p className="text-xs text-muted-foreground">Last touch</p>
						<p className="font-medium text-foreground">{formatDateTime(lastMessageAt)}</p>
					</div>
				</div>
			</div>

			<div className="mt-4 grid gap-4 lg:grid-cols-2">
				<div className="rounded-md border border-border bg-background p-3">
					<div className="flex items-center justify-between gap-3">
						<p className="text-sm font-medium text-foreground">Latest summary</p>
						{summary?.messageCount ? (
							<span className="text-xs text-muted-foreground">
								{summary.messageCount} summarized messages
							</span>
						) : null}
					</div>
					{summary?.summary ? (
						<p className="mt-2 text-sm text-muted-foreground">{summary.summary}</p>
					) : (
						<p className="mt-2 text-sm text-muted-foreground">
							No local summary available yet. Drafts can still use the plan prompt and manual edits.
						</p>
					)}
				</div>

				<div className="rounded-md border border-border bg-background p-3">
					<p className="text-sm font-medium text-foreground">Recent local messages</p>
					{messages.length === 0 ? (
						<p className="mt-2 text-sm text-muted-foreground">
							No recent imported messages for this contact.
						</p>
					) : (
						<div className="mt-2 space-y-2">
							{messages.map((message) => (
								<div key={message.id} className="rounded-md bg-muted/50 p-2">
									<div className="flex items-center justify-between gap-3">
										<p className="text-xs font-medium text-muted-foreground">
											{message.isOutgoing ? 'You' : 'Contact'}
										</p>
										<p className="text-xs text-muted-foreground">
											{formatDateTime(message.sentAt)}
										</p>
									</div>
									<p className="mt-1 text-sm text-foreground">
										{message.text?.trim() || '[No text content]'}
									</p>
								</div>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
