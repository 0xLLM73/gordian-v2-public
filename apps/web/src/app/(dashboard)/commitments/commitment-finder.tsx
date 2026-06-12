'use client';

import { Loader2, Play, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAction } from 'next-safe-action/hooks';
import { useState } from 'react';
import { toast } from 'sonner';
import { findCommitmentsForPeriodAction } from '@/app/actions/commitments';

type PeriodUnit = 'days' | 'weeks' | 'months';

type DryRunResult = {
	status: 'dry_run';
	batchSize: number;
	contactLimit: number;
	wouldProcessContacts: number;
	wouldProcessMessages: number;
	maxAgeDays: number;
	periodValue: number;
	periodUnit: PeriodUnit;
	confirmToken: string;
};

function unitLabel(value: number, unit: PeriodUnit) {
	if (value === 1) return unit.replace(/s$/, '');
	return unit;
}

function numericInputValue(value: number) {
	return Number.isFinite(value) ? String(value) : '';
}

export function CommitmentFinder() {
	const router = useRouter();
	const [periodValue, setPeriodValue] = useState(7);
	const [periodUnit, setPeriodUnit] = useState<PeriodUnit>('days');
	const [contactLimit, setContactLimit] = useState(100);
	const [batchSize, setBatchSize] = useState(200);
	const [estimate, setEstimate] = useState<DryRunResult | null>(null);

	const { executeAsync, isExecuting } = useAction(findCommitmentsForPeriodAction);

	const input = {
		periodValue,
		periodUnit,
		contactLimit,
		batchSize,
	};

	function clearEstimate() {
		setEstimate(null);
	}

	async function estimateRun() {
		clearEstimate();
		const result = await executeAsync(input);
		if (result?.data?.status === 'dry_run') {
			setEstimate(result.data);
			toast.success('Estimate ready');
			return;
		}
		toast.error(result?.serverError ?? 'Failed to estimate commitment search');
	}

	async function queueRun() {
		if (!estimate?.confirmToken) return;
		const result = await executeAsync({ ...input, confirmToken: estimate.confirmToken });
		if (result?.data?.status === 'queued') {
			setEstimate(null);
			router.refresh();
			toast.success(`Queued ${result.data.messagesQueued.toLocaleString()} messages`);
			return;
		}
		toast.error(result?.serverError ?? 'Failed to queue commitment search');
	}

	return (
		<section className="mt-4 rounded-lg border border-border bg-background p-4">
			<div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
				<div>
					<h2 className="text-sm font-semibold text-foreground">Find commitments</h2>
					<div className="mt-3 flex flex-wrap items-end gap-3">
						<label className="grid gap-1 text-xs font-medium text-muted-foreground">
							Last
							<input
								type="number"
								min={1}
								max={365}
								value={numericInputValue(periodValue)}
								onChange={(event) => {
									const next = Number(event.target.value);
									setPeriodValue(Number.isFinite(next) ? next : 1);
									clearEstimate();
								}}
								className="h-9 w-20 rounded-md border border-border bg-background px-2 text-sm text-foreground"
							/>
						</label>
						<label className="grid gap-1 text-xs font-medium text-muted-foreground">
							Period
							<select
								value={periodUnit}
								onChange={(event) => {
									setPeriodUnit(event.target.value as PeriodUnit);
									clearEstimate();
								}}
								className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
							>
								<option value="days">Days</option>
								<option value="weeks">Weeks</option>
								<option value="months">Months</option>
							</select>
						</label>
						<label className="grid gap-1 text-xs font-medium text-muted-foreground">
							Contacts
							<input
								type="number"
								min={1}
								max={100}
								value={numericInputValue(contactLimit)}
								onChange={(event) => {
									const next = Number(event.target.value);
									setContactLimit(Number.isFinite(next) ? next : 1);
									clearEstimate();
								}}
								className="h-9 w-24 rounded-md border border-border bg-background px-2 text-sm text-foreground"
							/>
						</label>
						<label className="grid gap-1 text-xs font-medium text-muted-foreground">
							Messages/contact
							<input
								type="number"
								min={1}
								max={200}
								value={numericInputValue(batchSize)}
								onChange={(event) => {
									const next = Number(event.target.value);
									setBatchSize(Number.isFinite(next) ? next : 1);
									clearEstimate();
								}}
								className="h-9 w-32 rounded-md border border-border bg-background px-2 text-sm text-foreground"
							/>
						</label>
					</div>
				</div>

				<div className="flex flex-wrap gap-2">
					<button
						type="button"
						onClick={estimateRun}
						disabled={isExecuting}
						className="inline-flex h-9 items-center gap-2 rounded-md bg-muted px-3 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
					>
						{isExecuting ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<Search className="size-4" />
						)}
						Estimate
					</button>
					<button
						type="button"
						onClick={queueRun}
						disabled={isExecuting || !estimate}
						className="inline-flex h-9 items-center gap-2 rounded-md bg-gray-900 px-3 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
					>
						{isExecuting ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<Play className="size-4" />
						)}
						Queue run
					</button>
				</div>
			</div>

			{estimate ? (
				<div className="mt-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
					Search will inspect up to{' '}
					<span className="font-medium text-foreground">
						{estimate.wouldProcessMessages.toLocaleString()}
					</span>{' '}
					messages across{' '}
					<span className="font-medium text-foreground">
						{estimate.wouldProcessContacts.toLocaleString()}
					</span>{' '}
					contacts from the last{' '}
					<span className="font-medium text-foreground">
						{estimate.periodValue} {unitLabel(estimate.periodValue, estimate.periodUnit)}
					</span>
					.
				</div>
			) : null}
		</section>
	);
}
