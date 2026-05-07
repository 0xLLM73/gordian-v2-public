'use client';

import { triggerSyncAction } from '@/app/actions/sync';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw } from 'lucide-react';
import { useAction } from 'next-safe-action/hooks';
import { useState } from 'react';

export function SyncButton({ disabledReason }: { disabledReason?: string }) {
	const [lastSynced, setLastSynced] = useState<string | null>(null);
	const { execute, isExecuting } = useAction(triggerSyncAction, {
		onSuccess: () => {
			setLastSynced(new Date().toLocaleTimeString());
		},
	});
	const disabled = isExecuting || Boolean(disabledReason);

	return (
		<Button
			variant="outline"
			size="sm"
			onClick={() => {
				if (!disabledReason) execute({});
			}}
			disabled={disabled}
			title={disabledReason}
		>
			{isExecuting ? (
				<>
					<Loader2 className="h-4 w-4 animate-spin" />
					Syncing...
				</>
			) : (
				<>
					<RefreshCw className="h-4 w-4" />
					{disabledReason ? 'Sync disabled' : 'Sync Now'}
				</>
			)}
			{lastSynced && <span className="text-xs text-muted-foreground">({lastSynced})</span>}
		</Button>
	);
}
