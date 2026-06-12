'use client';

import { useAction } from 'next-safe-action/hooks';
import { useCallback, useEffect, useState } from 'react';
import { getAuditLogsAction } from '@/app/actions/audit-log';

const ACTOR_TYPES = ['user', 'system', 'ai'] as const;
const ACTIONS = [
	'create',
	'update',
	'delete',
	'login',
	'sync',
	'generate',
	'evaluate',
	'send',
] as const;
const RESOURCE_TYPES = [
	'contact',
	'commitment',
	'deal',
	'introduction',
	'goal',
	'summary',
	'digest',
	'brief',
	'cadence',
	'calendar',
	'feature_flag',
	'preference',
	'decision',
	'message',
] as const;

const PAGE_SIZE = 50;

interface Filters {
	actorType?: (typeof ACTOR_TYPES)[number];
	action?: (typeof ACTIONS)[number];
	resourceType?: (typeof RESOURCE_TYPES)[number];
	limit: number;
	offset: number;
}

function formatActor(actorType: string, actorId: string): string {
	if (actorType === 'system') {
		const labels: Record<string, string> = {
			'sync-worker': 'Sync Worker',
			'calendar-sync': 'Calendar Sync',
			'cadence-processor': 'Cadence Processor',
			'health-scoring': 'Health Scoring',
		};
		return labels[actorId] ?? actorId;
	}
	if (actorType === 'ai') return 'AI (Claude)';
	return 'You';
}

function formatAction(action: string): string {
	const labels: Record<string, string> = {
		create: 'Created',
		update: 'Updated',
		delete: 'Deleted',
		login: 'Logged in',
		sync: 'Synced',
		generate: 'Generated',
		evaluate: 'Evaluated',
		send: 'Sent',
	};
	return labels[action] ?? action;
}

function formatResourceType(type: string): string {
	return type
		.split('_')
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ');
}

function formatTimestamp(ts: string | Date): string {
	const d = typeof ts === 'string' ? new Date(ts) : ts;
	return d.toLocaleString(undefined, {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}

const actorTypeBadge: Record<string, string> = {
	user: 'bg-blue-100 text-blue-700',
	system: 'bg-muted text-foreground',
	ai: 'bg-purple-100 text-purple-700',
};

export default function AuditLogPage() {
	const [filters, setFilters] = useState<Filters>({
		limit: PAGE_SIZE,
		offset: 0,
	});

	const { execute, result, isPending } = useAction(getAuditLogsAction);

	const loadLogs = useCallback(() => {
		const input: Record<string, unknown> = {
			limit: filters.limit,
			offset: filters.offset,
		};
		if (filters.actorType) input.actorType = filters.actorType;
		if (filters.action) input.action = filters.action;
		if (filters.resourceType) input.resourceType = filters.resourceType;
		execute(input as Parameters<typeof execute>[0]);
	}, [filters, execute]);

	useEffect(() => {
		loadLogs();
	}, [loadLogs]);

	const logs = result?.data?.logs ?? [];
	const total = result?.data?.total ?? 0;
	const currentPage = Math.floor(filters.offset / PAGE_SIZE) + 1;
	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

	function updateFilter(key: keyof Filters, value: string) {
		setFilters((prev) => ({
			...prev,
			[key]: value || undefined,
			offset: 0,
		}));
	}

	return (
		<div>
			<h1 className="mb-6 text-2xl font-bold text-foreground">Audit Log</h1>

			{/* Filter bar */}
			<div className="mb-4 flex flex-wrap items-center gap-3">
				<select
					className="rounded-md border border-border px-3 py-1.5 text-sm"
					value={filters.actorType ?? ''}
					onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
						updateFilter('actorType', e.target.value)
					}
				>
					<option value="">All actors</option>
					{ACTOR_TYPES.map((t) => (
						<option key={t} value={t}>
							{t.charAt(0).toUpperCase() + t.slice(1)}
						</option>
					))}
				</select>

				<select
					className="rounded-md border border-border px-3 py-1.5 text-sm"
					value={filters.action ?? ''}
					onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
						updateFilter('action', e.target.value)
					}
				>
					<option value="">All actions</option>
					{ACTIONS.map((a) => (
						<option key={a} value={a}>
							{formatAction(a)}
						</option>
					))}
				</select>

				<select
					className="rounded-md border border-border px-3 py-1.5 text-sm"
					value={filters.resourceType ?? ''}
					onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
						updateFilter('resourceType', e.target.value)
					}
				>
					<option value="">All resources</option>
					{RESOURCE_TYPES.map((r) => (
						<option key={r} value={r}>
							{formatResourceType(r)}
						</option>
					))}
				</select>

				<button
					type="button"
					className="rounded-md bg-muted px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
					onClick={() =>
						setFilters({
							limit: PAGE_SIZE,
							offset: 0,
						})
					}
				>
					Reset
				</button>
			</div>

			{/* Table */}
			<div className="overflow-hidden rounded-lg border border-border bg-card">
				<table className="min-w-full divide-y divide-border">
					<thead className="bg-muted">
						<tr>
							<th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">
								Time
							</th>
							<th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">
								Actor
							</th>
							<th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">
								Action
							</th>
							<th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">
								Resource
							</th>
							<th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">
								Resource ID
							</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-border">
						{isPending && logs.length === 0 ? (
							<tr>
								<td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
									Loading...
								</td>
							</tr>
						) : logs.length === 0 ? (
							<tr>
								<td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
									No audit log entries found.
								</td>
							</tr>
						) : (
							logs.map((log: Record<string, unknown>) => {
								const id = log.id as string;
								const actorType = log.actorType as string;
								const actorId = log.actorId as string;
								const action = log.action as string;
								const resourceType = log.resourceType as string;
								const resourceId = log.resourceId as string | null;
								const createdAt = log.createdAt as string;
								const correlationId = log.correlationId as string | null;

								return (
									<tr key={id} className="hover:bg-muted">
										<td className="whitespace-nowrap px-4 py-3 text-sm text-muted-foreground">
											{formatTimestamp(createdAt)}
										</td>
										<td className="whitespace-nowrap px-4 py-3 text-sm">
											<span
												className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${actorTypeBadge[actorType] ?? 'bg-muted text-foreground'}`}
											>
												{formatActor(actorType, actorId)}
											</span>
										</td>
										<td className="whitespace-nowrap px-4 py-3 text-sm text-foreground">
											{formatAction(action)}
										</td>
										<td className="whitespace-nowrap px-4 py-3 text-sm text-foreground">
											{formatResourceType(resourceType)}
										</td>
										<td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
											{resourceId ? resourceId.slice(0, 8) : '-'}
											{correlationId ? (
												<span
													className="ml-2 text-gray-300"
													title={`Correlation: ${correlationId}`}
												>
													*
												</span>
											) : null}
										</td>
									</tr>
								);
							})
						)}
					</tbody>
				</table>
			</div>

			{/* Pagination */}
			<div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
				<p>
					{total > 0
						? `Showing ${filters.offset + 1}-${Math.min(filters.offset + PAGE_SIZE, total)} of ${total}`
						: 'No entries'}
				</p>
				<div className="flex items-center gap-2">
					<button
						type="button"
						disabled={currentPage <= 1}
						className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
						onClick={() =>
							setFilters((prev) => ({
								...prev,
								offset: Math.max(0, prev.offset - PAGE_SIZE),
							}))
						}
					>
						Previous
					</button>
					<span>
						Page {currentPage} of {totalPages}
					</span>
					<button
						type="button"
						disabled={currentPage >= totalPages}
						className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
						onClick={() =>
							setFilters((prev) => ({
								...prev,
								offset: prev.offset + PAGE_SIZE,
							}))
						}
					>
						Next
					</button>
				</div>
			</div>
		</div>
	);
}
