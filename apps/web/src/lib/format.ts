export function formatCurrency(cents: number): string {
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		minimumFractionDigits: 0,
		maximumFractionDigits: 0,
	}).format(cents / 100);
}

export function formatRelativeDate(date: Date | string): string {
	const d = typeof date === 'string' ? new Date(date) : date;
	const diffMs = Date.now() - d.getTime();
	const diffMin = Math.floor(diffMs / 60_000);
	const diffHr = Math.floor(diffMin / 60);
	const diffDay = Math.floor(diffHr / 24);

	if (diffDay >= 30)
		return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	if (diffDay >= 2) return `${diffDay}d ago`;
	if (diffDay === 1) return 'yesterday';
	if (diffHr >= 1) return `${diffHr}h ago`;
	if (diffMin >= 1) return `${diffMin}m ago`;
	return 'just now';
}
