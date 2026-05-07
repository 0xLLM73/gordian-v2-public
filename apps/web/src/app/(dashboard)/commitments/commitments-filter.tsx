'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

const statuses = ['all', 'active', 'draft', 'snoozed', 'completed', 'dismissed'] as const;

export function CommitmentsFilter({ workspaceId: _workspaceId }: { workspaceId: string }) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const currentStatus = searchParams.get('status') || 'all';

	function handleFilter(status: string) {
		const params = new URLSearchParams(searchParams.toString());
		if (status === 'all') {
			params.delete('status');
		} else {
			params.set('status', status);
		}
		router.push(`${pathname}?${params.toString()}`);
	}

	return (
		<div className="flex gap-2">
			{statuses.map((status) => (
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
					{status.charAt(0).toUpperCase() + status.slice(1)}
				</button>
			))}
		</div>
	);
}
