'use client';

import { useEffect, useState, useTransition } from 'react';
import { getMessagesByContactAction } from '@/app/actions/messages';

interface Message {
	id: string;
	text: string | null;
	isOutgoing: boolean;
	sentAt: string;
}

interface Props {
	contactId: string;
}

const PAGE_SIZE = 50;

export function MessageHistory({ contactId }: Props) {
	const [messages, setMessages] = useState<Message[]>([]);
	const [offset, setOffset] = useState(0);
	const [hasMore, setHasMore] = useState(true);
	const [isPending, startTransition] = useTransition();
	const [loaded, setLoaded] = useState(false);

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset and reload on contactId change
	useEffect(() => {
		setMessages([]);
		setOffset(0);
		setHasMore(true);
		setLoaded(false);
		fetchMessages(0, true);
	}, [contactId]);

	function fetchMessages(pageOffset: number, isReset = false) {
		startTransition(async () => {
			const result = await getMessagesByContactAction({
				contactId,
				limit: PAGE_SIZE,
				offset: pageOffset,
			});
			if (result?.data) {
				const newMessages = result.data as unknown as Message[];
				setMessages((prev) => (isReset ? newMessages : [...prev, ...newMessages]));
				if (newMessages.length < PAGE_SIZE) setHasMore(false);
				setOffset(pageOffset + newMessages.length);
			}
			setLoaded(true);
		});
	}

	function loadMore() {
		fetchMessages(offset);
	}

	if (!loaded) {
		return (
			<div className="space-y-2">
				{[1, 2, 3].map((i) => (
					<div key={i} className="animate-pulse rounded-lg border border-border bg-card p-3">
						<div className="h-4 w-48 rounded bg-muted" />
						<div className="mt-2 h-3 w-32 rounded bg-muted" />
					</div>
				))}
			</div>
		);
	}

	if (messages.length === 0) {
		return (
			<div className="rounded-lg border border-border bg-muted p-8 text-center">
				<p className="text-sm text-muted-foreground">No messages synced yet.</p>
				<p className="mt-1 text-xs text-muted-foreground">
					Messages will appear after Telegram sync runs.
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-2">
			{messages.map((msg) => (
				<div
					key={msg.id}
					className={`rounded-lg p-3 ${msg.isOutgoing ? 'ml-8 bg-blue-50' : 'mr-8 bg-muted'}`}
				>
					<div className="flex items-center justify-between">
						<span className="text-xs font-medium text-muted-foreground">
							{msg.isOutgoing ? 'You' : 'Contact'}
						</span>
						<span className="text-xs text-muted-foreground">
							{new Date(msg.sentAt).toLocaleString()}
						</span>
					</div>
					{msg.text ? (
						<p className="mt-1 text-sm text-gray-800">{msg.text}</p>
					) : (
						<p className="mt-1 text-sm italic text-muted-foreground">[No text content]</p>
					)}
				</div>
			))}
			{hasMore ? (
				<button
					type="button"
					onClick={loadMore}
					disabled={isPending}
					className="w-full rounded-lg border border-border py-2 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50"
				>
					{isPending ? 'Loading...' : 'Load more messages'}
				</button>
			) : null}
		</div>
	);
}
