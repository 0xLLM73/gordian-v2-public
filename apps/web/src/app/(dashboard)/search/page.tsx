import { SearchInterface } from '@/components/search/search-interface';
import { getUserWorkspaceId, requireSession } from '@/lib/workspace';

export default async function SearchPage() {
	const session = await requireSession();
	const workspaceId = await getUserWorkspaceId(session.user.id);

	return (
		<div>
			<h1 className="mb-6 text-2xl font-bold text-foreground">Search</h1>
			{workspaceId ? (
				<SearchInterface />
			) : (
				<div className="rounded-lg border border-border bg-muted p-8 text-center text-sm text-muted-foreground">
					Connect Telegram to start searching your contacts and conversations.
				</div>
			)}
		</div>
	);
}
