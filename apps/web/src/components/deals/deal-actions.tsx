'use client';

import { deleteDealAction, updateDealAction } from '@/app/actions/deals';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useAction } from 'next-safe-action/hooks';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

const STAGE_ORDER = ['discovery', 'diligence', 'negotiation', 'committed', 'won'];

type DealStage = 'discovery' | 'diligence' | 'negotiation' | 'committed' | 'won' | 'lost';

function getNextStage(current: string): string | null {
	const idx = STAGE_ORDER.indexOf(current);
	if (idx === -1 || idx >= STAGE_ORDER.length - 1) return null;
	return STAGE_ORDER[idx + 1];
}

const NEXT_LABELS: Record<string, string> = {
	discovery: 'Diligence',
	diligence: 'Negotiation',
	negotiation: 'Committed',
	committed: 'Won',
};

interface DealActionsProps {
	dealId: string;
	stage: string;
	stageHistory?: Array<{ stage: string; timestamp: string }>;
}

function getLastActiveStage(
	history: Array<{ stage: string; timestamp: string }> | undefined,
): string {
	if (!history || history.length === 0) return 'discovery';
	for (let i = history.length - 1; i >= 0; i--) {
		if (history[i].stage !== 'won' && history[i].stage !== 'lost') {
			return history[i].stage;
		}
	}
	return 'discovery';
}

export function DealActions({ dealId, stage, stageHistory }: DealActionsProps) {
	const router = useRouter();
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [noteDialogOpen, setNoteDialogOpen] = useState(false);
	const [pendingStage, setPendingStage] = useState<DealStage | null>(null);
	const [stageNote, setStageNote] = useState('');
	const { execute, isExecuting } = useAction(updateDealAction, {
		onSuccess: () => {
			toast.success(
				pendingStage === getLastActiveStage(stageHistory) ? 'Deal reopened' : 'Deal updated',
			);
			router.refresh();
		},
		onError: () => toast.error('Failed to update deal'),
	});
	const { execute: remove, isExecuting: removing } = useAction(deleteDealAction, {
		onSuccess: () => {
			toast.success('Deal deleted');
			router.refresh();
		},
		onError: () => toast.error('Failed to delete deal'),
	});

	const busy = isExecuting || removing;

	function requestStageChange(newStage: DealStage) {
		setPendingStage(newStage);
		setStageNote('');
		setNoteDialogOpen(true);
	}

	function confirmStageChange() {
		if (!pendingStage) return;
		execute({
			dealId,
			stage: pendingStage,
			stageNote: stageNote.trim() || undefined,
		});
		setNoteDialogOpen(false);
		setPendingStage(null);
		setStageNote('');
	}

	function skipNote() {
		if (!pendingStage) return;
		execute({ dealId, stage: pendingStage });
		setNoteDialogOpen(false);
		setPendingStage(null);
		setStageNote('');
	}

	const noteDialog = (
		<Dialog open={noteDialogOpen} onOpenChange={setNoteDialogOpen}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Add a note (optional)</DialogTitle>
					<DialogDescription>Record why you're changing this deal's stage.</DialogDescription>
				</DialogHeader>
				<Textarea
					placeholder="e.g. Moving to diligence after positive first call"
					value={stageNote}
					onChange={(e) => setStageNote(e.target.value)}
					maxLength={500}
					rows={3}
				/>
				<DialogFooter className="gap-2 sm:gap-0">
					<Button variant="ghost" size="sm" onClick={skipNote} disabled={busy}>
						Skip
					</Button>
					<Button size="sm" onClick={confirmStageChange} disabled={busy}>
						Confirm
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);

	if (stage === 'won' || stage === 'lost') {
		const reopenStage = getLastActiveStage(stageHistory) as DealStage;
		return (
			<>
				<div className="flex flex-wrap gap-1">
					<Button
						variant="outline"
						size="sm"
						onClick={() => requestStageChange(reopenStage)}
						disabled={busy}
						className="text-muted-foreground"
					>
						Reopen
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setConfirmOpen(true)}
						disabled={busy}
						className="text-muted-foreground hover:bg-accent"
					>
						Delete
					</Button>
				</div>
				<AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Delete deal?</AlertDialogTitle>
							<AlertDialogDescription>
								This will permanently remove this deal and cannot be undone.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction
								className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
								onClick={() => remove({ dealId })}
							>
								Delete
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
				{noteDialog}
			</>
		);
	}

	const nextStage = getNextStage(stage);

	return (
		<>
			<div className="flex flex-wrap gap-1">
				{nextStage ? (
					<Button
						variant="ghost"
						size="sm"
						onClick={() => requestStageChange(nextStage as DealStage)}
						disabled={busy}
						className="text-blue-700 hover:bg-blue-50"
					>
						{NEXT_LABELS[stage] || 'Advance'}
					</Button>
				) : null}
				{stage !== 'committed' ? (
					<Button
						variant="ghost"
						size="sm"
						onClick={() => requestStageChange('won')}
						disabled={busy}
						className="text-green-700 hover:bg-green-50"
					>
						Won
					</Button>
				) : null}
				<Button
					variant="ghost"
					size="sm"
					onClick={() => requestStageChange('lost')}
					disabled={busy}
					className="text-red-600 hover:bg-red-50"
				>
					Lost
				</Button>
			</div>
			{noteDialog}
		</>
	);
}
