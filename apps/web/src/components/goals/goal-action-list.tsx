'use client';

// Client boundary: manages expand/collapse state, fetches actions on demand, handles complete/skip transitions

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
	completeGoalActionAction,
	listGoalActionsAction,
	skipGoalActionAction,
} from '@/app/actions/goals';
import {
	GOAL_ACTION_STATUS_COLORS,
	GOAL_ACTION_TYPE_COLORS,
	GOAL_DOMAIN_TAG_COLORS,
	GOAL_EFFORT_COLORS,
} from '@/lib/colors';

interface GoalActionItem {
	id: string;
	goalId: string;
	title: string;
	description: string | null;
	contactId: string | null;
	status: string;
	actionType: string;
	domainTag: string;
	effort: string;
	createdAt: Date | string;
	completedAt: Date | string | null;
}

const ACTION_TYPE_LABELS: Record<string, string> = {
	contact_outreach: 'Outreach',
	information_gathering: 'Research',
	document_creation: 'Document',
	meeting_scheduling: 'Meeting',
	decision_making: 'Decision',
};

const EFFORT_ICONS: Record<string, string> = {
	quick: '⚡',
	medium: '⏱',
	deep: '🏔',
};

export function GoalActionList({
	goalId,
	pendingCount,
	contactNames,
}: {
	goalId: string;
	pendingCount: number;
	contactNames: Record<string, string>;
}) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [actions, setActions] = useState<GoalActionItem[] | null>(null);
	const [isPending, startTransition] = useTransition();
	const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

	const load = useCallback(() => {
		setOpen(true);
		if (actions) return;
		startTransition(async () => {
			const result = await listGoalActionsAction({ goalId });
			if (result?.data) {
				setActions(result.data as GoalActionItem[]);
			}
		});
	}, [goalId, actions]);

	const handleComplete = useCallback(
		(actionId: string) => {
			setBusyIds((prev) => new Set(prev).add(actionId));
			setActions((prev) =>
				prev
					? prev.map((a) =>
							a.id === actionId
								? { ...a, status: 'completed', completedAt: new Date().toISOString() }
								: a,
						)
					: prev,
			);
			startTransition(async () => {
				const result = await completeGoalActionAction({ actionId });
				setBusyIds((prev) => {
					const next = new Set(prev);
					next.delete(actionId);
					return next;
				});
				if (result?.data) {
					toast.success('Action completed');
					router.refresh();
				} else {
					toast.error('Failed to complete action');
					setActions(null);
					load();
				}
			});
		},
		[router, load],
	);

	const handleSkip = useCallback(
		(actionId: string) => {
			setBusyIds((prev) => new Set(prev).add(actionId));
			setActions((prev) =>
				prev ? prev.map((a) => (a.id === actionId ? { ...a, status: 'skipped' } : a)) : prev,
			);
			startTransition(async () => {
				const result = await skipGoalActionAction({ actionId });
				setBusyIds((prev) => {
					const next = new Set(prev);
					next.delete(actionId);
					return next;
				});
				if (result?.data) {
					toast.success('Action skipped');
					router.refresh();
				} else {
					toast.error('Failed to skip action');
					setActions(null);
					load();
				}
			});
		},
		[router, load],
	);

	if (pendingCount === 0 && !open) return null;

	const pendingActions =
		actions?.filter((a) => a.status === 'pending' || a.status === 'in_progress') ?? [];
	const doneActions =
		actions?.filter((a) => a.status === 'completed' || a.status === 'skipped') ?? [];

	return (
		<div className="mt-2">
			<button
				type="button"
				onClick={() => (open ? setOpen(false) : load())}
				className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
			>
				<span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">
					{pendingCount}
				</span>
				{open ? 'Hide actions' : `${pendingCount} action${pendingCount !== 1 ? 's' : ''}`}
			</button>

			{open ? (
				<div className="mt-2 space-y-2">
					{isPending && !actions ? (
						<div className="space-y-1.5">
							{[1, 2, 3].map((i) => (
								<div key={i} className="h-16 w-full animate-pulse rounded-md bg-muted" />
							))}
						</div>
					) : actions && actions.length > 0 ? (
						<>
							{pendingActions.length > 0 ? (
								<div className="space-y-2">
									{pendingActions.map((action) => (
										<ActionCard
											key={action.id}
											action={action}
											contactName={action.contactId ? contactNames[action.contactId] : undefined}
											onComplete={handleComplete}
											onSkip={handleSkip}
											busy={busyIds.has(action.id)}
										/>
									))}
								</div>
							) : null}
							{doneActions.length > 0 ? (
								<div className="mt-3">
									<p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
										Completed
									</p>
									<div className="space-y-1">
										{doneActions.map((action) => (
											<div
												key={action.id}
												className="flex items-center justify-between rounded px-2 py-1 text-xs opacity-60"
											>
												<span className="line-through">{action.title}</span>
												<span
													className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${GOAL_ACTION_STATUS_COLORS[action.status] || 'bg-muted text-muted-foreground'}`}
												>
													{action.status}
												</span>
											</div>
										))}
									</div>
								</div>
							) : null}
						</>
					) : (
						<p className="text-xs text-muted-foreground">No actions yet.</p>
					)}
				</div>
			) : null}
		</div>
	);
}

function ActionCard({
	action,
	contactName,
	onComplete,
	onSkip,
	busy,
}: {
	action: GoalActionItem;
	contactName?: string;
	onComplete: (id: string) => void;
	onSkip: (id: string) => void;
	busy: boolean;
}) {
	return (
		<div className="rounded-md border border-border bg-card p-3">
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0 flex-1">
					<p className="text-sm font-medium text-foreground">{action.title}</p>
					{action.description ? (
						<p className="mt-0.5 text-xs text-muted-foreground">{action.description}</p>
					) : null}
				</div>
				<div className="flex shrink-0 gap-1">
					<button
						type="button"
						onClick={() => onComplete(action.id)}
						disabled={busy}
						className="rounded px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50"
					>
						Done
					</button>
					<button
						type="button"
						onClick={() => onSkip(action.id)}
						disabled={busy}
						className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
					>
						Skip
					</button>
				</div>
			</div>

			<div className="mt-2 flex flex-wrap items-center gap-1.5">
				<span
					className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${GOAL_ACTION_TYPE_COLORS[action.actionType] || 'bg-muted text-muted-foreground'}`}
				>
					{ACTION_TYPE_LABELS[action.actionType] || action.actionType}
				</span>
				<span
					className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${GOAL_DOMAIN_TAG_COLORS[action.domainTag] || 'bg-muted text-muted-foreground'}`}
				>
					{action.domainTag}
				</span>
				<span
					className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${GOAL_EFFORT_COLORS[action.effort] || 'bg-muted text-muted-foreground'}`}
				>
					{EFFORT_ICONS[action.effort] || ''} {action.effort}
				</span>
				{action.contactId && contactName ? (
					<Link
						href={`/contacts/${action.contactId}`}
						className="rounded px-1.5 py-0.5 text-[10px] font-medium text-blue-700 hover:bg-blue-50"
					>
						→ {contactName}
					</Link>
				) : null}
			</div>
		</div>
	);
}
