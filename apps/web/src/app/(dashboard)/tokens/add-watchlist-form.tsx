'use client';

import { addToWatchlistAction } from '@/app/actions/tokens';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function AddToWatchlistForm() {
	const router = useRouter();
	const [isOpen, setIsOpen] = useState(false);
	const [symbol, setSymbol] = useState('');
	const [pending, setPending] = useState(false);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!symbol.trim()) return;

		setPending(true);
		try {
			await addToWatchlistAction({ symbol: symbol.trim().toUpperCase() });
			setSymbol('');
			setIsOpen(false);
			router.refresh();
		} catch {
			// Ignore
		} finally {
			setPending(false);
		}
	}

	if (!isOpen) {
		return (
			<button
				type="button"
				onClick={() => setIsOpen(true)}
				className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90"
			>
				+ Add Token
			</button>
		);
	}

	return (
		<form onSubmit={handleSubmit} className="flex items-center gap-2">
			<input
				type="text"
				value={symbol}
				onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSymbol(e.target.value)}
				placeholder="BTC, ETH, SOL..."
				className="w-28 rounded-md border border-border px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
			/>
			<button
				type="submit"
				disabled={pending}
				className="rounded-md bg-primary px-3 py-1 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
			>
				Add
			</button>
			<button
				type="button"
				onClick={() => setIsOpen(false)}
				className="text-xs text-muted-foreground hover:text-foreground"
			>
				Cancel
			</button>
		</form>
	);
}
