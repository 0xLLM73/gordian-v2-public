import { DEAL_STAGE_COLORS } from '@/lib/colors';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import type { ReactNode } from 'react';

const stageLabels: Record<string, string> = {
	discovery: 'Discovery',
	diligence: 'Diligence',
	negotiation: 'Negotiation',
	committed: 'Committed',
	won: 'Won',
	lost: 'Lost',
};

interface DealRowProps {
	dealId: string;
	titleControl: ReactNode;
	contactName: string;
	dealTypeLabel?: string | null;
	actions: ReactNode;
	value: number;
	stage: string;
	className?: string;
}

export function DealRow({
	dealId,
	titleControl,
	contactName,
	dealTypeLabel,
	actions,
	value,
	stage,
	className,
}: DealRowProps) {
	return (
		<div
			data-testid="deal-row"
			data-deal-id={dealId}
			className={cn('grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center', className)}
		>
			<div className="min-w-0">
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					<div className="min-w-0 max-w-full break-words text-sm font-medium text-foreground">
						{titleControl}
					</div>
					{dealTypeLabel ? (
						<span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
							{dealTypeLabel}
						</span>
					) : null}
				</div>
				<Link
					href={`/deals/${dealId}`}
					className="mt-0.5 block break-words text-sm text-muted-foreground hover:text-primary"
				>
					{contactName}
				</Link>
			</div>

			<div className="flex min-w-0 flex-col gap-2 sm:items-end">
				<div className="flex max-w-full flex-wrap items-center gap-1 sm:justify-end">{actions}</div>
				<div className="flex flex-wrap items-center gap-2 sm:justify-end">
					<span className="whitespace-nowrap text-sm font-medium text-foreground">
						{formatCurrency(value)}
					</span>
					<DealStageBadge stage={stage} />
				</div>
			</div>
		</div>
	);
}

export function DealStageBadge({ stage }: { stage: string }) {
	return (
		<span
			className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${DEAL_STAGE_COLORS[stage] || 'bg-muted text-muted-foreground'}`}
		>
			{stageLabels[stage] || stage}
		</span>
	);
}
