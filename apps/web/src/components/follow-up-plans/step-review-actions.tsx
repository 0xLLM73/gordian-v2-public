'use client';
// 'use client' — needs useState for edit mode + useAction for server action mutations + useRouter for refresh

import {
	approveFollowUpPlanStepAction,
	editAndApproveFollowUpPlanStepAction,
	rejectFollowUpPlanStepAction,
} from '@/app/actions/follow-up-plans';
import { useAction } from 'next-safe-action/hooks';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function StepReviewActions({
	stepId,
	followUpPlanId,
	draftText,
}: {
	stepId: string;
	followUpPlanId: string;
	draftText: string;
}) {
	const router = useRouter();
	const [editing, setEditing] = useState(false);
	const [editedText, setEditedText] = useState(draftText);

	const opts = { onSuccess: () => router.refresh() };

	const { execute: approve, isExecuting: approving } = useAction(
		approveFollowUpPlanStepAction,
		opts,
	);
	const { execute: editAndApprove, isExecuting: editApproving } = useAction(
		editAndApproveFollowUpPlanStepAction,
		opts,
	);
	const { execute: reject, isExecuting: rejecting } = useAction(rejectFollowUpPlanStepAction, opts);

	const busy = approving || editApproving || rejecting;

	if (editing) {
		return (
			<div className="mt-3 space-y-2">
				<textarea
					value={editedText}
					onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEditedText(e.target.value)}
					className="w-full rounded-md border border-border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
					rows={4}
				/>
				<div className="flex gap-2">
					<button
						type="button"
						onClick={() => editAndApprove({ stepId, followUpPlanId, editedText })}
						disabled={busy || !editedText.trim()}
						className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
					>
						{editApproving ? 'Saving...' : 'Save & mark sent'}
					</button>
					<button
						type="button"
						onClick={() => {
							setEditing(false);
							setEditedText(draftText);
						}}
						disabled={busy}
						className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50"
					>
						Cancel
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="mt-3 flex gap-2">
			<button
				type="button"
				onClick={() => approve({ stepId, followUpPlanId })}
				disabled={busy}
				className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
			>
				{approving ? 'Saving...' : 'Approve & mark sent'}
			</button>
			<button
				type="button"
				onClick={() => setEditing(true)}
				disabled={busy}
				className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
			>
				Edit
			</button>
			<button
				type="button"
				onClick={() => reject({ stepId, followUpPlanId })}
				disabled={busy}
				className="rounded-md px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
			>
				{rejecting ? 'Rejecting...' : 'Reject'}
			</button>
		</div>
	);
}
