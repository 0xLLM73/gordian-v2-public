'use client';

// 'use client' — needs useState for edit mode + useAction for server action mutations + useRouter for refresh

import { useRouter } from 'next/navigation';
import { useAction } from 'next-safe-action/hooks';
import { useState } from 'react';
import {
	approveFollowUpPlanStepAction,
	editAndApproveFollowUpPlanStepAction,
	recordFollowUpPlanStepCopyAction,
	recordFollowUpPlanTelegramOpenAction,
	regenerateFollowUpPlanStepAction,
	rejectFollowUpPlanStepAction,
} from '@/app/actions/follow-up-plans';
import { StepRescheduleAction } from '@/components/follow-up-plans/step-reschedule-action';

export function StepReviewActions({
	stepId,
	followUpPlanId,
	draftText,
	telegramUrl,
}: {
	stepId: string;
	followUpPlanId: string;
	draftText: string;
	telegramUrl?: string | null;
}) {
	const router = useRouter();
	const [editing, setEditing] = useState(false);
	const [editedText, setEditedText] = useState(draftText);
	const [copyMessage, setCopyMessage] = useState<string | null>(null);
	const [confirmingRegenerate, setConfirmingRegenerate] = useState(false);
	const [confirmingManualSend, setConfirmingManualSend] = useState(false);
	const [confirmingEditedManualSend, setConfirmingEditedManualSend] = useState(false);
	const [confirmingSkip, setConfirmingSkip] = useState(false);
	const [skipReason, setSkipReason] = useState('');

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
	const { execute: regenerate, isExecuting: regenerating } = useAction(
		regenerateFollowUpPlanStepAction,
		opts,
	);
	const { execute: recordCopy, isExecuting: recordingCopy } = useAction(
		recordFollowUpPlanStepCopyAction,
		opts,
	);
	const { execute: recordTelegramOpen, isExecuting: openingTelegram } = useAction(
		recordFollowUpPlanTelegramOpenAction,
		opts,
	);

	const busy =
		approving || editApproving || rejecting || regenerating || recordingCopy || openingTelegram;
	const activeDraftText = editing ? editedText : draftText;

	async function copyDraft() {
		setCopyMessage(null);
		try {
			await navigator.clipboard.writeText(activeDraftText);
			recordCopy({ stepId, followUpPlanId });
			setCopyMessage('Draft copied. Send it manually, then mark it sent here.');
		} catch {
			setCopyMessage('Clipboard blocked. Select and copy the draft text manually.');
		}
	}

	function openTelegramDestination() {
		recordTelegramOpen({ stepId, followUpPlanId });
		if (telegramUrl) {
			window.open(telegramUrl, '_blank', 'noopener,noreferrer');
			setCopyMessage('Telegram opened. Send the draft manually, then mark it sent here.');
		} else {
			setCopyMessage('Open Telegram manually, then mark the draft sent here.');
		}
	}

	function confirmManualSend() {
		setConfirmingManualSend(false);
		approve({ stepId, followUpPlanId });
	}

	function confirmEditedManualSend() {
		setConfirmingEditedManualSend(false);
		editAndApprove({ stepId, followUpPlanId, editedText });
	}

	function confirmSkip() {
		const reason = skipReason.trim();
		setConfirmingSkip(false);
		setSkipReason('');
		reject({
			stepId,
			followUpPlanId,
			...(reason ? { skipReason: reason } : {}),
		});
	}

	function queueRegenerate() {
		setCopyMessage('Regeneration queued. Nothing was sent.');
		setConfirmingRegenerate(false);
		regenerate({ stepId, followUpPlanId });
	}

	if (editing) {
		return (
			<div className="mt-3 space-y-2">
				<p className="text-xs text-muted-foreground">
					Edit the local draft before sending it yourself. Saving here records manual completion
					only after you confirm it was sent.
				</p>
				<textarea
					value={editedText}
					onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEditedText(e.target.value)}
					className="w-full rounded-md border border-border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
					rows={4}
				/>
				{copyMessage ? <p className="text-xs text-muted-foreground">{copyMessage}</p> : null}
				<div className="flex flex-wrap gap-2">
					<button
						type="button"
						onClick={copyDraft}
						disabled={busy || !editedText.trim()}
						className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
					>
						{recordingCopy ? 'Recording...' : 'Copy edited draft'}
					</button>
					<button
						type="button"
						onClick={openTelegramDestination}
						disabled={busy}
						className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
					>
						{openingTelegram ? 'Recording...' : 'Open Telegram'}
					</button>
					<button
						type="button"
						onClick={() => setConfirmingEditedManualSend(true)}
						disabled={busy || !editedText.trim()}
						className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
					>
						{editApproving ? 'Saving...' : 'Mark manually sent'}
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
					{confirmingEditedManualSend ? (
						<div className="flex flex-wrap items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-900">
							<span>
								This records that you manually sent the edited draft and schedules the next step.
							</span>
							<button
								type="button"
								onClick={confirmEditedManualSend}
								disabled={busy || !editedText.trim()}
								className="rounded-md bg-green-700 px-2 py-1 font-medium text-white disabled:opacity-50"
							>
								Confirm sent
							</button>
							<button
								type="button"
								onClick={() => setConfirmingEditedManualSend(false)}
								disabled={busy}
								className="rounded-md px-2 py-1 font-medium text-green-900 hover:bg-green-100 disabled:opacity-50"
							>
								Keep editing
							</button>
						</div>
					) : null}
				</div>
			</div>
		);
	}

	return (
		<div className="mt-3 space-y-2">
			<p className="text-xs text-muted-foreground">
				Review this local draft, copy it, send it yourself, then confirm manual sending to advance
				the plan.
			</p>
			{copyMessage ? <p className="text-xs text-muted-foreground">{copyMessage}</p> : null}
			<div className="flex flex-wrap gap-2">
				<button
					type="button"
					onClick={copyDraft}
					disabled={busy}
					className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
				>
					{recordingCopy ? 'Recording...' : 'Copy draft'}
				</button>
				<button
					type="button"
					onClick={openTelegramDestination}
					disabled={busy}
					className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
				>
					{openingTelegram ? 'Recording...' : 'Open Telegram'}
				</button>
				<button
					type="button"
					onClick={() => setConfirmingManualSend(true)}
					disabled={busy}
					className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
				>
					{approving ? 'Saving...' : 'Mark manually sent'}
				</button>
				{confirmingManualSend ? (
					<div className="flex flex-wrap items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-900">
						<span>This records that you manually sent the draft and schedules the next step.</span>
						<button
							type="button"
							onClick={confirmManualSend}
							disabled={busy}
							className="rounded-md bg-green-700 px-2 py-1 font-medium text-white disabled:opacity-50"
						>
							Confirm sent
						</button>
						<button
							type="button"
							onClick={() => setConfirmingManualSend(false)}
							disabled={busy}
							className="rounded-md px-2 py-1 font-medium text-green-900 hover:bg-green-100 disabled:opacity-50"
						>
							Cancel
						</button>
					</div>
				) : null}
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
					onClick={() => setConfirmingRegenerate(true)}
					disabled={busy}
					className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
				>
					{regenerating ? 'Queueing...' : 'Regenerate'}
				</button>
				{confirmingRegenerate ? (
					<div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
						<span>Current draft stays in history. Nothing is sent.</span>
						<button
							type="button"
							onClick={queueRegenerate}
							disabled={busy}
							className="rounded-md bg-amber-900 px-2 py-1 font-medium text-white disabled:opacity-50"
						>
							Confirm regenerate
						</button>
						<button
							type="button"
							onClick={() => setConfirmingRegenerate(false)}
							disabled={busy}
							className="rounded-md px-2 py-1 font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
						>
							Cancel
						</button>
					</div>
				) : null}
				<button
					type="button"
					onClick={() => setConfirmingSkip(true)}
					disabled={busy}
					className="rounded-md px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
				>
					{rejecting ? 'Skipping...' : 'Skip step'}
				</button>
				{confirmingSkip ? (
					<div className="flex w-full flex-col gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
						<span>Skip this draft and move the plan forward without sending anything.</span>
						<input
							type="text"
							value={skipReason}
							onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSkipReason(e.target.value)}
							placeholder="Optional skip reason"
							className="rounded-md border border-red-200 bg-white px-2 py-1 text-sm text-foreground focus:border-red-400 focus:outline-none"
						/>
						<div className="flex flex-wrap gap-2">
							<button
								type="button"
								onClick={confirmSkip}
								disabled={busy}
								className="rounded-md bg-red-700 px-2 py-1 font-medium text-white disabled:opacity-50"
							>
								Confirm skip
							</button>
							<button
								type="button"
								onClick={() => {
									setConfirmingSkip(false);
									setSkipReason('');
								}}
								disabled={busy}
								className="rounded-md px-2 py-1 font-medium text-red-900 hover:bg-red-100 disabled:opacity-50"
							>
								Cancel
							</button>
						</div>
					</div>
				) : null}
				<StepRescheduleAction stepId={stepId} followUpPlanId={followUpPlanId} disabled={busy} />
			</div>
		</div>
	);
}
