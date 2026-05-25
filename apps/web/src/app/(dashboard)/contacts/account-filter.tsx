'use client';

// Client boundary: needs router.push to update URL search params on selection

import { useRouter } from 'next/navigation';

interface AccountFilterProps {
	accounts: Array<{ key: string; label: string }>;
	selectedAccountKey?: string;
}

export function AccountFilter({ accounts, selectedAccountKey }: AccountFilterProps) {
	const router = useRouter();

	function handleChange(value: string) {
		const url = new URL(window.location.href);
		if (value) {
			url.searchParams.set('account', value);
		} else {
			url.searchParams.delete('account');
		}
		router.push(url.pathname + url.search);
	}

	return (
		<div className="mb-4 flex items-center gap-2">
			<label htmlFor="account-filter" className="text-sm font-medium text-foreground">
				Account
			</label>
			<select
				id="account-filter"
				value={selectedAccountKey ?? ''}
				onChange={(e) => handleChange(e.target.value)}
				className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
			>
				<option value="">All Accounts</option>
				{accounts.map((account) => (
					<option key={account.key} value={account.key}>
						{account.label}
					</option>
				))}
			</select>
		</div>
	);
}
