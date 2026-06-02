'use client';

// Client component — needs interactive state for disconnect confirmation + feedback
import { disconnectTelegramAction } from '@/app/actions/settings';
import { RefreshCw, Unlink } from 'lucide-react';
import * as React from 'react';

interface Props {
	isConnected: boolean;
	linkingEnabled?: boolean;
	sendEnabled?: boolean;
	safetyItems?: TelegramSafetyItem[];
}

export interface TelegramSafetyItem {
	label: string;
	status: string;
	tone: 'ok' | 'warn' | 'neutral';
}

export function TelegramConnection({
	isConnected,
	linkingEnabled = false,
	sendEnabled = false,
	safetyItems = [],
}: Props) {
	const [isPending, startTransition] = React.useTransition();
	const [connected, setConnected] = React.useState(isConnected);
	const [confirming, setConfirming] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

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
			<div className="flex flex-wrap items-center gap-3">
				<div className={`h-3 w-3 rounded-full ${connected ? 'bg-green-500' : 'bg-muted'}`} />
				<p className="text-sm text-muted-foreground">{connected ? 'Connected' : 'Not connected'}</p>
				<span
					className={`rounded-full px-2 py-0.5 text-xs font-medium ${
						sendEnabled ? 'bg-red-100 text-red-700' : 'bg-muted text-muted-foreground'
					}`}
				>
					{sendEnabled ? 'Sending enabled' : 'Read-only'}
				</span>
			</div>

			{safetyItems.length > 0 ? (
				<div className="mt-4 grid gap-2 sm:grid-cols-2">
					{safetyItems.map((item) => (
						<div
							key={item.label}
							className="flex min-h-12 items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2"
						>
							<span className="text-sm text-muted-foreground">{item.label}</span>
							<span className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
								<span
									className={`h-2 w-2 shrink-0 rounded-full ${
										item.tone === 'ok'
											? 'bg-green-500'
											: item.tone === 'warn'
												? 'bg-amber-500'
												: 'bg-muted-foreground'
									}`}
								/>
								{item.status}
							</span>
						</div>
					))}
				</div>
			) : null}

			<div className="mt-3 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
				<p>
					{sendEnabled
						? 'Message sending is enabled for this build.'
						: 'Message sending disabled in this build.'}
				</p>
				<p className="mt-2">
					The history import flow is the default path allowed to open the stored MTProto session.
					Legacy sync and backfill jobs stay blocked unless this install explicitly opts back in.
				</p>
				<p className="mt-2">
					Removing the local session deletes Gordian's encrypted Telegram session and local session
					key material. To revoke it from Telegram itself, open Telegram Settings &gt; Devices and
					terminate the Gordian session.
				</p>
				<p className="mt-2">
					Deleting your Gordian account from the danger zone removes the local workspace data stored
					by this app.
				</p>
			</div>

			{connected ? (
				<div className="mt-3">
					{confirming ? (
						<div className="flex flex-wrap items-center gap-3">
							<span className="text-sm text-muted-foreground">Remove local Telegram session?</span>
							<button
								type="button"
								onClick={handleDisconnect}
								disabled={isPending}
								className="inline-flex items-center gap-2 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
							>
								<Unlink className="h-4 w-4" aria-hidden="true" />
								{isPending ? 'Removing...' : 'Confirm'}
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
						<div className="flex flex-wrap items-center gap-3">
							<a
								href="/"
								className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
								title="Open the dashboard history import controls"
							>
								<RefreshCw className="h-4 w-4" aria-hidden="true" />
								Run History Import
							</a>
							<button
								type="button"
								onClick={() => setConfirming(true)}
								className="inline-flex items-center gap-2 rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
							>
								<Unlink className="h-4 w-4" aria-hidden="true" />
								Remove Local Session
							</button>
						</div>
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
