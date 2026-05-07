'use client';

import {
	deleteFeatureFlagAction,
	listFeatureFlagsAction,
	toggleFeatureFlagAction,
} from '@/app/actions/feature-flags';
import { useEffect, useState, useTransition } from 'react';

interface Flag {
	id: string;
	key: string;
	enabled: boolean;
	workspaceId: string | null;
	updatedAt: Date;
	updatedBy: string | null;
}

export function FeatureFlagsSection(_: { workspaceId: string }) {
	const [flags, setFlags] = useState<Flag[]>([]);
	const [isPending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		loadFlags();
	}, []);

	async function loadFlags() {
		const result = await listFeatureFlagsAction({});
		if (result?.data) {
			setFlags(result.data as Flag[]);
		}
	}

	function handleToggle(key: string, currentEnabled: boolean) {
		setError(null);
		startTransition(async () => {
			const result = await toggleFeatureFlagAction({ key, enabled: !currentEnabled });
			if (result?.serverError) {
				setError(result.serverError);
				return;
			}
			await loadFlags();
		});
	}

	function handleDelete(key: string) {
		setError(null);
		startTransition(async () => {
			const result = await deleteFeatureFlagAction({ key });
			if (result?.serverError) {
				setError(result.serverError);
				return;
			}
			await loadFlags();
		});
	}

	if (flags.length === 0 && !isPending) {
		return <p className="text-sm text-muted-foreground">No feature flags configured.</p>;
	}

	return (
		<div>
			{error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
			<div className="divide-y divide-border">
				{flags.map((flag) => (
					<div key={flag.id} className="flex items-center justify-between py-3">
						<div className="min-w-0 flex-1">
							<p className="text-sm font-medium text-foreground">{flag.key}</p>
							<p className="text-xs text-muted-foreground">
								{flag.workspaceId ? 'Workspace override' : 'Global default'}
							</p>
						</div>
						<div className="ml-4 flex items-center gap-3">
							<button
								type="button"
								disabled={isPending}
								onClick={() => handleToggle(flag.key, flag.enabled)}
								className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
									flag.enabled ? 'bg-primary' : 'bg-muted'
								} ${isPending ? 'opacity-50' : ''}`}
								aria-label={`Toggle ${flag.key}`}
							>
								<span
									className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
										flag.enabled ? 'translate-x-5' : 'translate-x-0'
									}`}
								/>
							</button>
							{flag.workspaceId ? (
								<button
									type="button"
									disabled={isPending}
									onClick={() => handleDelete(flag.key)}
									className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
									aria-label={`Delete ${flag.key}`}
								>
									Remove
								</button>
							) : null}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
