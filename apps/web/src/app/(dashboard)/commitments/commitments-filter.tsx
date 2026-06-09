'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
	COMMITMENT_STATUS_FILTERS,
	COMMITMENT_STATUS_LABELS,
	normalizeCommitmentStatusFilter,
} from './status-filter';

export function CommitmentsFilter({ workspaceId: _workspaceId }: { workspaceId: string }) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const currentStatus = normalizeCommitmentStatusFilter(searchParams.get('status') ?? undefined);

	function handleFilter(status: string) {
		const params = new URLSearchParams(searchParams.toString());
		if (status === 'active') {
			params.delete('status');
		} else {
			params.set('status', status);
		}
		router.push(`${pathname}?${params.toString()}`);
	}

	return (
		<div className="flex gap-2">
			{COMMITMENT_STATUS_FILTERS.map((status) => (
				<button
					key={status}
					type="button"
					onClick={() => handleFilter(status)}
					className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
						currentStatus === status
							? 'bg-gray-900 text-white'
							: 'bg-muted text-muted-foreground hover:bg-accent'
					}`}
				>
					{COMMITMENT_STATUS_LABELS[status]}
				</button>
			))}
		</div>
	);
}
