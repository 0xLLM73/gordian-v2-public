'use client';

import { triggerSyncAction } from '@/app/actions/sync';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw } from 'lucide-react';
import { useAction } from 'next-safe-action/hooks';
import * as React from 'react';

export function SyncButton({ disabledReason }: { disabledReason?: string }) {
	const [lastSynced, setLastSynced] = React.useState<string | null>(null);
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
				if (!disabledReason) execute({ syncScope: 'contacts_only' });
			}}
			disabled={disabled}
			title={
				disabledReason ??
				'Updates linked Telegram contacts only. Use Telegram history import for messages.'
			}
		>
			{isExecuting ? (
				<>
					<Loader2 className="h-4 w-4 animate-spin" />
					Syncing contacts...
				</>
			) : (
				<>
					<RefreshCw className="h-4 w-4" />
					{disabledReason ? 'Sync disabled' : 'Sync contacts'}
				</>
			)}
			{lastSynced && <span className="text-xs text-muted-foreground">({lastSynced})</span>}
		</Button>
	);
}
