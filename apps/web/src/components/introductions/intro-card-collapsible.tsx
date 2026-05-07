'use client';
// Needs interactivity: click-to-expand progressive disclosure, action buttons

import { INTRO_CONTEXT_COLORS, INTRO_STATUS_COLORS } from '@/lib/colors';
import { cn } from '@/lib/utils';
import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { IntroActions } from './intro-actions';

interface IntroCardCollapsibleProps {
	name: string;
	introduced1Name: string;
	introduced2Name: string;
	introducerId: string;
	introduced1: string;
	introduced2: string;
	confidence: number;
	context: string;
	status: string;
	autoConfirmed: boolean | null;
	reasoning: string | null;
	note: string | null;
	detectedAt: string;
	introductionId: string;
	EditIntroButton: React.ComponentType<{
		introductionId: string;
		initialContext: string;
		initialNote: string | null;
	}>;
}

export function IntroCardCollapsible({
	name,
	introduced1Name,
	introduced2Name,
	introducerId,
	introduced1,
	introduced2,
	confidence,
	context,
	status,
	autoConfirmed,
	reasoning,
	note,
	detectedAt,
	introductionId,
	EditIntroButton,
}: IntroCardCollapsibleProps) {
	const [expanded, setExpanded] = useState(false);

	return (
		<div className="p-4">
			<button
				type="button"
				onClick={() => setExpanded((prev) => !prev)}
				className="flex w-full items-center justify-between text-left"
			>
				<div className="flex items-center gap-2 min-w-0">
					<p className="text-sm font-medium text-foreground truncate">
						{name} introduced {introduced1Name} to {introduced2Name}
					</p>
					{autoConfirmed ? (
						<span className="shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
							AI detected
						</span>
					) : null}
				</div>
				<div className="flex items-center gap-2 ml-3 shrink-0">
					<span className="text-xs text-muted-foreground">{confidence}%</span>
					<span
						className={cn(
							'rounded-full px-2 py-0.5 text-[10px] font-medium',
							INTRO_STATUS_COLORS[status] || 'bg-gray-100 text-gray-500',
						)}
					>
						{status}
					</span>
					<ChevronDown
						className={cn(
							'h-4 w-4 text-muted-foreground transition-transform duration-200',
							expanded && 'rotate-180',
						)}
					/>
				</div>
			</button>

			{expanded ? (
				<div className="mt-3 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
					<div className="flex items-center gap-2 text-sm">
						<Link href={`/contacts/${introducerId}`} className="font-medium hover:text-primary">
							{name}
						</Link>
						<span className="text-muted-foreground">introduced</span>
						<Link href={`/contacts/${introduced1}`} className="font-medium hover:text-primary">
							{introduced1Name}
						</Link>
						<span className="text-muted-foreground">to</span>
						<Link href={`/contacts/${introduced2}`} className="font-medium hover:text-primary">
							{introduced2Name}
						</Link>
					</div>

					<div className="flex items-center gap-2">
						<span
							className={cn(
								'rounded-full px-2 py-0.5 text-[10px] font-medium',
								INTRO_CONTEXT_COLORS[context] || INTRO_CONTEXT_COLORS.other,
							)}
						>
							{context}
						</span>
						<span className="text-xs text-muted-foreground">
							Detected {new Date(detectedAt).toLocaleDateString()}
						</span>
					</div>

					{reasoning ? (
						<p className="text-sm text-muted-foreground rounded bg-muted px-3 py-2">{reasoning}</p>
					) : null}

					{note ? <p className="text-sm text-muted-foreground">{note}</p> : null}

					<div className="flex items-center gap-1 pt-1">
						<EditIntroButton
							introductionId={introductionId}
							initialContext={context}
							initialNote={note}
						/>
						<IntroActions introductionId={introductionId} status={status} />
					</div>
				</div>
			) : null}
		</div>
	);
}
