'use client';

// Client component — needs interactive state for disconnect confirmation + feedback
import { disconnectTelegramAction } from '@/app/actions/settings';
import { useState, useTransition } from 'react';

interface Props {
	isConnected: boolean;
	accountId?: string;
	linkingEnabled?: boolean;
}

export function TelegramConnection({ isConnected, accountId, linkingEnabled = false }: Props) {
	const [isPending, startTransition] = useTransition();
	const [connected, setConnected] = useState(isConnected);
	const [confirming, setConfirming] = useState(false);
	const [error, setError] = useState<string | null>(null);

	function handleDisconnect() {
		setError(null);
		startTransition(async () => {
			const result = await disconnectTelegramAction({});
			if (result?.data?.disconnected) {
				setConnected(false);
				setConfirming(false);
			} else {
				setError('Failed to disconnect. Please try again.');
				setConfirming(false);
			}
		});
	}

	return (
		<div>
			<div className="flex items-center gap-3">
				<div className={`h-3 w-3 rounded-full ${connected ? 'bg-green-500' : 'bg-muted'}`} />
				<p className="text-sm text-muted-foreground">
					{connected ? `Connected${accountId ? ` (${accountId})` : ''}` : 'Not connected'}
				</p>
			</div>

			{connected ? (
				<div className="mt-3">
					{confirming ? (
						<div className="flex items-center gap-3">
							<span className="text-sm text-muted-foreground">Disconnect Telegram?</span>
							<button
								type="button"
								onClick={handleDisconnect}
								disabled={isPending}
								className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
							>
								{isPending ? 'Disconnecting...' : 'Confirm'}
							</button>
							<button
								type="button"
								onClick={() => setConfirming(false)}
								disabled={isPending}
								className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
							>
								Cancel
							</button>
						</div>
					) : (
						<button
							type="button"
							onClick={() => setConfirming(true)}
							className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
						>
							Disconnect Telegram
						</button>
					)}
					{error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
				</div>
			) : linkingEnabled ? (
				<a
					href="/onboarding/connect"
					className="mt-3 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
				>
					Connect Telegram
				</a>
			) : (
				<p className="mt-3 text-sm text-muted-foreground">
					Telegram linking is disabled for this deployment.
				</p>
			)}
		</div>
	);
}
