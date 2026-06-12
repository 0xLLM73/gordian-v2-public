import Link from 'next/link';
import type { ReactNode } from 'react';
import { DealStageBadge } from '@/components/deals/deal-row';
import { formatCurrency } from '@/lib/format';

interface DealDetailHeaderProps {
	title: string;
	contactId: string;
	contactName: string;
	dealTypeLabel: string;
	createdAtLabel: string;
	actions: ReactNode;
	value: number;
	stage: string;
}

export function DealDetailHeader({
	title,
	contactId,
	contactName,
	dealTypeLabel,
	createdAtLabel,
	actions,
	value,
	stage,
}: DealDetailHeaderProps) {
	return (
		<header
			data-testid="deal-detail-header"
			className="mb-6 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start"
		>
			<div className="min-w-0">
				<h1 className="break-words text-2xl font-bold text-foreground">{title}</h1>
				<p className="mt-1 flex flex-wrap gap-x-1 gap-y-1 text-sm text-muted-foreground">
					<Link
						href={`/contacts/${contactId}`}
						className="break-words text-primary hover:text-primary"
					>
						{contactName}
					</Link>
					<span>/</span>
					<span>{dealTypeLabel}</span>
					<span>/</span>
					<span>Created {createdAtLabel}</span>
				</p>
			</div>

			<div className="flex min-w-0 flex-col gap-2 md:items-end">
				<div className="flex max-w-full flex-wrap items-center gap-1 md:justify-end">{actions}</div>
				<div className="flex flex-wrap items-center gap-2 md:justify-end">
					<span className="whitespace-nowrap text-lg font-semibold text-foreground">
						{formatCurrency(value)}
					</span>
					<DealStageBadge stage={stage} />
				</div>
			</div>
		</header>
	);
}
