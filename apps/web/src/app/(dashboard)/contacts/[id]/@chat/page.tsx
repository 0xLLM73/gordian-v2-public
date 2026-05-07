import { requireSession } from '@/lib/workspace';

export default async function ChatPanel({ params }: { params: Promise<{ id: string }> }) {
	await requireSession();
	const { id } = await params;

	return (
		<div className="flex h-full flex-col rounded-lg border border-border bg-card">
			<div className="border-b border-border px-4 py-3">
				<h3 className="text-sm font-semibold text-foreground">Messages</h3>
			</div>

			<div className="flex flex-1 items-center justify-center p-4">
				<p className="text-center text-sm text-muted-foreground">
					Message history for contact {id.slice(0, 8)}... will appear here after Telegram sync.
				</p>
			</div>

			<div className="border-t border-border p-3">
				<div className="flex gap-2">
					<input
						type="text"
						placeholder="Messages are read-only from Telegram..."
						disabled
						className="flex-1 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
					/>
				</div>
			</div>
		</div>
	);
}
