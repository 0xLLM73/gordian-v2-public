'use client';

import { Check, Copy, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';
import {
	executeCommitmentAction,
	executeDealCreateAction,
	executeDealStageAction,
	executeGoalCreateAction,
	executeTelegramSendAction,
} from '@/app/actions/chat-actions';
import { ActionCard, type ActionProposal } from './action-card';

const TOOL_FRIENDLY_NAMES: Record<string, string> = {
	search_contacts: 'Contacts',
	get_commitments: 'Commitments',
	get_deals: 'Deals',
	get_contact_health: 'Health',
	search_memories: 'Memories',
	search_knowledge: 'Knowledge',
	search_precedents: 'Precedents',
	create_commitment: 'Create',
	create_deal: 'New Deal',
	create_goal: 'New Goal',
	update_deal_stage: 'Update',
	draft_message: 'Draft',
};

interface ChatMessageProps {
	message: {
		role: string;
		content: string;
		toolsUsed?: string[];
		timestamp: Date;
		isError?: boolean;
		proposals?: ActionProposal[];
	};
	onRetry?: () => void;
}

export function ChatMessage({ message, onRetry }: ChatMessageProps) {
	const isUser = message.role === 'user';
	const isError = message.isError === true;
	const isAssistant = !isUser && !isError;
	const [copied, setCopied] = useState(false);
	const router = useRouter();

	const handleCopy = () => {
		navigator.clipboard.writeText(message.content).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		});
	};

	const handleConfirmProposal = useCallback(
		(proposal: ActionProposal) => async () => {
			const d = proposal.data;
			if (proposal.action === 'create_commitment') {
				await executeCommitmentAction({
					contactId: d.contactId as string,
					title: d.title as string,
					commitmentType: d.commitmentType as
						| 'promise'
						| 'task'
						| 'meeting'
						| 'financial'
						| 'follow_up',
					assignee: d.assignee as 'user' | 'contact',
					dueDate: (d.dueDate as string) ?? null,
				});
			} else if (proposal.action === 'create_deal') {
				await executeDealCreateAction({
					contactId: d.contactId as string,
					title: d.title as string,
					dealType: d.dealType as 'investment' | 'advisory' | 'partnership' | 'token' | 'other',
					value: d.value ? (d.value as number) : undefined,
				});
			} else if (proposal.action === 'create_goal') {
				await executeGoalCreateAction({
					type: d.type as 'relationship' | 'business' | 'habit' | 'network',
					title: d.title as string,
					targetCount: d.targetCount as number,
					targetDate: d.targetDate ? (d.targetDate as string) : undefined,
					contactId: d.contactId ? (d.contactId as string) : undefined,
				});
			} else if (proposal.action === 'update_deal_stage') {
				await executeDealStageAction({
					dealId: d.dealId as string,
					newStage: d.newStage as
						| 'discovery'
						| 'diligence'
						| 'negotiation'
						| 'committed'
						| 'won'
						| 'lost',
				});
			} else if (proposal.action === 'draft_message') {
				const result = await executeTelegramSendAction({
					contactId: d.contactId as string,
					draftText: d.draftText as string,
					contactName: d.contactName as string,
				});
				if (result?.data?.success) {
					toast.success(`Message sent to ${result.data.contactName}`);
				} else {
					const errMsg = result?.serverError ?? 'Failed to send message';
					toast.error(errMsg);
					throw new Error(errMsg);
				}
			}
			router.refresh();
		},
		[router],
	);

	return (
		<div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
			<div className={isUser ? 'max-w-[80%]' : 'w-full'}>
				<div
					className={`relative rounded-lg px-4 py-2 text-sm ${isAssistant ? 'group' : ''} ${
						isError
							? 'bg-destructive/10 text-destructive'
							: isUser
								? 'bg-primary text-white'
								: 'bg-muted text-foreground'
					}`}
				>
					{isAssistant ? (
						<button
							type="button"
							onClick={handleCopy}
							className="absolute right-1 top-1 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted-foreground/20"
							aria-label="Copy message"
						>
							{copied ? (
								<Check className="h-3.5 w-3.5 text-muted-foreground" />
							) : (
								<Copy className="h-3.5 w-3.5 text-muted-foreground" />
							)}
						</button>
					) : null}
					{isError ? (
						<div className="flex items-start gap-2">
							<TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
							<div>
								<p className="whitespace-pre-wrap">{message.content}</p>
								{onRetry ? (
									<button
										type="button"
										onClick={onRetry}
										className="mt-1 text-xs font-medium underline hover:no-underline"
									>
										Retry
									</button>
								) : null}
							</div>
						</div>
					) : isUser ? (
						<p className="whitespace-pre-wrap">{message.content}</p>
					) : (
						<div className="prose prose-sm max-w-none prose-neutral dark:prose-invert [&_table]:text-xs [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1 [&_table]:w-full">
							<ReactMarkdown>{message.content}</ReactMarkdown>
						</div>
					)}
					{message.toolsUsed && message.toolsUsed.length > 0 ? (
						<div className="mt-2 flex flex-wrap gap-1 border-t border-border/50 pt-1.5">
							{[...new Set(message.toolsUsed)].map((tool) => (
								<span
									key={tool}
									className="rounded-full bg-background px-2 py-0.5 text-[10px] text-muted-foreground"
								>
									{TOOL_FRIENDLY_NAMES[tool] ?? tool}
								</span>
							))}
						</div>
					) : null}
				</div>
				{message.proposals && message.proposals.length > 0 ? (
					<div className="mt-1">
						{message.proposals.map((proposal, idx) => (
							<ActionCard
								key={`${proposal.action}-${idx}`}
								proposal={proposal}
								onConfirm={handleConfirmProposal(proposal)}
								onCancel={() => {}}
							/>
						))}
					</div>
				) : null}
				<span
					className={`mt-0.5 block text-xs text-muted-foreground/60 ${isUser ? 'text-right' : 'text-left'}`}
				>
					{message.timestamp.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
				</span>
			</div>
		</div>
	);
}
