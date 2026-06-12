import type { getFollowUpPlanWorkerHealth } from '@repo/db';
import type {
	FollowUpPlanReadiness,
	FollowUpPlanReadinessTone,
} from '@/lib/follow-up-plans-readiness-types';

type FollowUpPlanWorkerHealth = Awaited<ReturnType<typeof getFollowUpPlanWorkerHealth>>;

function readinessValueClass(status: FollowUpPlanReadinessTone) {
	if (status === 'ready') return 'text-emerald-700';
	if (status === 'warning') return 'text-amber-700';
	if (status === 'blocked') return 'text-red-700';
	return 'text-muted-foreground';
}

export function FollowUpStatusStrip({
	reviewCount,
	overdueCount,
	blockedCount,
	activeCount,
	workerHealth,
	readiness,
}: {
	reviewCount: number;
	overdueCount: number;
	blockedCount: number;
	activeCount: number;
	workerHealth: FollowUpPlanWorkerHealth;
	readiness: FollowUpPlanReadiness;
}) {
	const workerValue = {
		running: workerHealth.label,
		stale: 'Stopped',
		unknown: 'No heartbeat',
		error: 'Error',
	}[workerHealth.status];
	const workerValueClass = {
		running: 'text-emerald-700',
		stale: 'text-amber-700',
		unknown: 'text-muted-foreground',
		error: 'text-red-700',
	}[workerHealth.status];
	const items = [
		{
			label: 'Worker',
			value: workerValue,
			detail: workerHealth.detail,
			valueClass: workerValueClass,
		},
		{
			label: readiness.localAi.label,
			value: readiness.localAi.value,
			detail: readiness.localAi.detail,
			valueClass: readinessValueClass(readiness.localAi.status),
		},
		{
			label: readiness.telegram.label,
			value: readiness.telegram.value,
			detail: readiness.telegram.detail,
			valueClass: readinessValueClass(readiness.telegram.status),
		},
		{
			label: readiness.notifications.label,
			value: readiness.notifications.value,
			detail: readiness.notifications.detail,
			valueClass: readinessValueClass(readiness.notifications.status),
		},
		{ label: 'Needs review', value: String(reviewCount), detail: 'Local drafts waiting' },
		{ label: 'Overdue', value: String(overdueCount), detail: 'Due ready steps' },
		{
			label: 'Blocked',
			value: String(blockedCount),
			detail: 'Retryable local generation issues',
			valueClass: blockedCount > 0 ? 'text-red-700' : undefined,
		},
		{ label: 'Active', value: String(activeCount), detail: 'Running plans' },
		{ label: 'Sending', value: 'Manual', detail: 'No automatic sends' },
	];

	return (
		<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
			{items.map((item) => (
				<div key={item.label} className="rounded-lg border border-border bg-card p-4">
					<p className="text-xs font-medium uppercase text-muted-foreground">{item.label}</p>
					<p className={`mt-1 text-lg font-semibold ${item.valueClass ?? 'text-foreground'}`}>
						{item.value}
					</p>
					<p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
				</div>
			))}
		</div>
	);
}
