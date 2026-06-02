import { getUserWorkspaceId, requireSession } from '@/lib/workspace';
import { getDashboardAnalyticsStats } from '@repo/db';

export default async function AnalyticsPanel() {
	try {
		const session = await requireSession();
		const workspaceId = await getUserWorkspaceId(session.user.id);

		if (!workspaceId) {
			return <AnalyticsFallback />;
		}

		const stats = await getDashboardAnalyticsStats(workspaceId);

		return (
			<div>
				<h3 className="mb-4 text-sm font-semibold text-foreground">Analytics</h3>

				<div className="space-y-4">
					<MetricCard label="Contacts" value={stats.contactCount} />
					<MetricCard label="Commitments" value={stats.commitmentCount} />

					{Object.keys(stats.commitmentStatusCounts).length > 0 && (
						<div className="rounded-lg border border-border bg-card p-4">
							<p className="mb-2 text-xs font-medium text-muted-foreground">By Status</p>
							<div className="space-y-1">
								{Object.entries(stats.commitmentStatusCounts).map(([status, count]) => (
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
