import { DEAL_STAGE_BG_COLORS } from '@/lib/colors';
import { formatCurrency } from '@/lib/format';
import { DEAL_STAGE_LABELS } from './filter-options';

export interface DealStageCount {
	stage: string;
	count: number;
	totalValue: number;
}

export function DealsPipelineSummary({ counts }: { counts: DealStageCount[] }) {
	if (counts.length === 0) return null;

	const totalDeals = counts.reduce((sum, c) => sum + c.count, 0);
	const totalValue = counts.reduce((sum, c) => sum + c.totalValue, 0);

	return (
		<div
			data-testid="deals-pipeline-summary"
			className="mb-6 rounded-lg border border-border bg-card p-4"
		>
			<div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
				<span className="text-sm font-medium text-foreground">
					Pipeline total: {totalDeals} deal{totalDeals !== 1 ? 's' : ''}
				</span>
				<span className="text-sm font-medium text-foreground">{formatCurrency(totalValue)}</span>
			</div>
			<div className="flex flex-wrap gap-x-3 gap-y-2" aria-label="Pipeline stage totals">
				{counts.map((entry) => (
					<div key={entry.stage} className="flex items-center gap-1.5">
						<span
							className={`inline-block h-2 w-2 rounded-full ${DEAL_STAGE_BG_COLORS[entry.stage] || 'bg-muted-foreground'}`}
						/>
						<span className="text-xs text-muted-foreground">
							{DEAL_STAGE_LABELS[entry.stage as keyof typeof DEAL_STAGE_LABELS] ?? entry.stage} (
							{entry.count})
						</span>
					</div>
				))}
			</div>
		</div>
	);
}
