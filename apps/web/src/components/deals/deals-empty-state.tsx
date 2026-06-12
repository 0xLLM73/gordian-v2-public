import Link from 'next/link';
import { DEAL_STAGE_LABELS } from '@/components/deals/filter-options';

type DealsEmptyStateReason = 'workspace_unavailable' | 'envelope_unavailable' | 'empty_pipeline';

interface DealsEmptyStateProps {
	reason?: DealsEmptyStateReason;
	stage?: string;
	totalDeals?: number;
}

export function DealsEmptyState({
	reason = 'empty_pipeline',
	stage,
	totalDeals = 0,
}: DealsEmptyStateProps) {
	const isFilteredEmpty = Boolean(stage && stage !== 'all' && totalDeals > 0);
	const stageLabel = stage
		? (DEAL_STAGE_LABELS[stage as keyof typeof DEAL_STAGE_LABELS] ?? stage)
		: '';

	if (isFilteredEmpty) {
		return (
			<div
				data-testid="deals-empty-state"
				className="mt-4 rounded-lg border border-border bg-muted p-8 text-center text-sm text-muted-foreground"
			>
				<p className="font-medium text-foreground">
					No {stageLabel.toLowerCase()} deals match this filter.
				</p>
				<p className="mt-1">
					Your pipeline still has {totalDeals} deal{totalDeals !== 1 ? 's' : ''}. Clear the filter
					to return to the full list.
				</p>
				<Link href="/deals" className="mt-3 inline-flex text-sm font-medium text-primary">
					Clear filter
				</Link>
			</div>
		);
	}

	const copy =
		reason === 'workspace_unavailable'
			? {
					title: 'Deals workspace unavailable.',
					body: 'Create or select a workspace before tracking deal context.',
				}
			: reason === 'envelope_unavailable'
				? {
						title: 'Deals are locked until workspace encryption is available.',
						body: 'Reconnect the workspace key, then return here to view and create deals.',
					}
				: {
						title: 'No deals yet.',
						body: 'Click "New Deal" to create one. Gordian will build its decision context over time.',
					};

	return (
		<div
			data-testid="deals-empty-state"
			className="mt-4 rounded-lg border border-border bg-muted p-8 text-center text-sm text-muted-foreground"
		>
			<p className="font-medium text-foreground">{copy.title}</p>
			<p className="mt-1">{copy.body}</p>
		</div>
	);
}
