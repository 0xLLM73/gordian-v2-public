'use client';

import { updateDealAction } from '@/app/actions/deals';
import { cn } from '@/lib/utils';
import type { DealStage } from '@repo/shared';
import { useAction } from 'next-safe-action/hooks';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import { DEAL_STAGE_FILTERS, DEAL_STAGE_LABELS } from './filter-options';

const DEAL_STAGES = DEAL_STAGE_FILTERS.filter((stage) => stage !== 'all') as DealStage[];

interface DealStageMoveMenuProps {
	dealId: string;
	currentStage: string;
	label?: string;
	className?: string;
}

export function DealStageMoveMenu({
	dealId,
	currentStage,
	label = 'Move deal stage',
	className,
}: DealStageMoveMenuProps) {
	const router = useRouter();
	const inputId = useId();
	const [selectedStage, setSelectedStage] = useState(currentStage);
	const [status, setStatus] = useState('');
	const { execute, isExecuting } = useAction(updateDealAction, {
		onSuccess: () => {
			setStatus('Stage updated');
			router.refresh();
		},
		onError: () => {
			setSelectedStage(currentStage);
			setStatus('Stage update failed');
		},
	});

	useEffect(() => {
		setSelectedStage(currentStage);
	}, [currentStage]);

	function handleChange(nextStage: string) {
		setSelectedStage(nextStage);
		setStatus('');
		if (nextStage === currentStage) return;
		execute({ dealId, stage: nextStage as DealStage });
	}

	return (
		<div className={cn('inline-flex max-w-full items-center', className)}>
			<label htmlFor={inputId} className="sr-only">
				{label}
			</label>
			<select
				id={inputId}
				aria-label={label}
				value={selectedStage}
				disabled={isExecuting}
				onChange={(event) => handleChange(event.target.value)}
				className="max-w-full rounded-md border border-input bg-background px-2 py-1 text-xs text-muted-foreground ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50"
			>
				{DEAL_STAGES.map((stage) => (
					<option key={stage} value={stage}>
						Move: {DEAL_STAGE_LABELS[stage]}
					</option>
				))}
			</select>
			{status ? (
				<output className="sr-only" aria-live="polite">
					{status}
				</output>
			) : null}
		</div>
	);
}
