'use client';

// Client boundary: needs useAction for merge server action + AlertDialog interactivity

import { mergeKnowledgeNodesAction } from '@/app/actions/knowledge';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { KNOWLEDGE_TYPE_COLORS } from '@/lib/colors';
import { useAction } from 'next-safe-action/hooks';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

interface NodePreview {
	id: string;
	displayName: string;
	type: string;
	mentionCount: number | null;
}

export function MergeDialog({
	survivor,
	merged,
}: {
	survivor: NodePreview;
	merged: NodePreview;
}) {
	const router = useRouter();

	const { execute, isExecuting } = useAction(mergeKnowledgeNodesAction, {
		onSuccess: () => {
			toast.success(`Merged "${merged.displayName}" into "${survivor.displayName}"`);
			router.refresh();
		},
		onError: (err) => {
			toast.error(err.error?.serverError ?? 'Merge failed');
		},
	});

	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<button
					type="button"
					className="rounded px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
				>
					Merge
				</button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Merge knowledge nodes?</AlertDialogTitle>
					<AlertDialogDescription>
						This will merge all links and mentions from the merged node into the surviving node. The
						merged node will be deleted. This cannot be undone.
					</AlertDialogDescription>
				</AlertDialogHeader>

				<div className="my-4 grid grid-cols-2 gap-4">
					{/* Survivor (keeping) */}
					<div className="rounded-lg border border-green-200 bg-green-50 p-3">
						<p className="mb-1 text-xs font-semibold text-green-700">Keeping</p>
						<span
							className={`mb-1 inline-block rounded px-2 py-0.5 text-xs font-medium ${KNOWLEDGE_TYPE_COLORS[survivor.type] ?? 'bg-gray-100 text-gray-700'}`}
						>
							{survivor.type}
						</span>
						<p className="text-sm font-medium text-foreground">{survivor.displayName}</p>
						<p className="text-xs text-muted-foreground">{survivor.mentionCount ?? 0} mentions</p>
					</div>

					{/* Merged (deleting) */}
					<div className="rounded-lg border border-red-200 bg-red-50 p-3">
						<p className="mb-1 text-xs font-semibold text-red-700">Deleting</p>
						<span
							className={`mb-1 inline-block rounded px-2 py-0.5 text-xs font-medium ${KNOWLEDGE_TYPE_COLORS[merged.type] ?? 'bg-gray-100 text-gray-700'}`}
						>
							{merged.type}
						</span>
						<p className="text-sm font-medium text-foreground">{merged.displayName}</p>
						<p className="text-xs text-muted-foreground">{merged.mentionCount ?? 0} mentions</p>
					</div>
				</div>

				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						onClick={() => execute({ survivorId: survivor.id, mergedId: merged.id })}
						disabled={isExecuting}
						className="bg-red-600 text-white hover:bg-red-700"
					>
						{isExecuting ? 'Merging...' : 'Confirm Merge'}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
