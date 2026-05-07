import { getUserWorkspaceId, getWorkspaceEnvelope, requireSession } from '@/lib/workspace';
import { getCommitmentsByWorkspace, listContacts } from '@repo/db';

export default async function AnalyticsPanel() {
	try {
		const session = await requireSession();
		const workspaceId = await getUserWorkspaceId(session.user.id);

		if (!workspaceId) {
			return <AnalyticsFallback />;
		}

		const envelope = await getWorkspaceEnvelope(workspaceId);
		if (!envelope) {
			return <AnalyticsFallback />;
		}

		const [contacts, commitments] = await Promise.all([
			listContacts(workspaceId, envelope, { limit: 100 }),
			getCommitmentsByWorkspace(workspaceId, envelope, { limit: 100 }),
		]);

		const contactCount = Array.isArray(contacts) ? contacts.length : 0;
		const commitmentCount = Array.isArray(commitments) ? commitments.length : 0;

		const statusCounts: Record<string, number> = {};
		if (Array.isArray(commitments)) {
			for (const c of commitments) {
				const status = (c as Record<string, unknown>).status as string;
				statusCounts[status] = (statusCounts[status] || 0) + 1;
			}
		}

		return (
			<div>
				<h3 className="mb-4 text-sm font-semibold text-foreground">Analytics</h3>

				<div className="space-y-4">
					<MetricCard label="Contacts" value={contactCount} />
					<MetricCard label="Commitments" value={commitmentCount} />

					{Object.keys(statusCounts).length > 0 && (
						<div className="rounded-lg border border-border bg-card p-4">
							<p className="mb-2 text-xs font-medium text-muted-foreground">By Status</p>
							<div className="space-y-1">
								{Object.entries(statusCounts).map(([status, count]) => (
									<div key={status} className="flex items-center justify-between text-sm">
										<span className="capitalize text-muted-foreground">{status}</span>
										<span className="font-medium text-foreground">{count}</span>
									</div>
								))}
							</div>
						</div>
					)}

					<div className="rounded-lg border border-border bg-card p-4">
						<p className="mb-2 text-xs font-medium text-muted-foreground">Recent Activity</p>
						<p className="text-sm text-muted-foreground">No recent activity</p>
					</div>
				</div>
			</div>
		);
	} catch {
		console.error('[analytics-panel] Failed to load analytics data');
		return <AnalyticsFallback />;
	}
}

function AnalyticsFallback() {
	return (
		<div>
			<h3 className="mb-4 text-sm font-semibold text-foreground">Analytics</h3>
			<div className="space-y-4">
				<MetricCard label="Contacts" value={0} />
				<MetricCard label="Commitments" value={0} />
			</div>
		</div>
	);
}

function MetricCard({ label, value }: { label: string; value: number }) {
	return (
		<div className="rounded-lg border border-border bg-card p-4">
			<p className="text-xs font-medium text-muted-foreground">{label}</p>
			<p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
		</div>
	);
}
