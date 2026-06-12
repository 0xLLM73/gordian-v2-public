'use client';

import { useEffect, useMemo } from 'react';
// Needs client boundary: useEffect for mount/unmount lifecycle to set/reset chat context
import type { ChatContext } from '@/hooks/use-chat-context';
import { useSetChatContext } from '@/hooks/use-chat-context';

type ChatContextSetterProps = Omit<ChatContext, 'page'> & { page: string };

/** Sets chat context on mount, resets to dashboard on unmount. */
export function ChatContextSetter({
	page,
	contactId,
	contactName,
	contactSummary,
	dealId,
	dealTitle,
}: ChatContextSetterProps) {
	const { setContext, resetContext } = useSetChatContext();

	const ctx = useMemo(
		() => ({ page, contactId, contactName, contactSummary, dealId, dealTitle }),
		[page, contactId, contactName, contactSummary, dealId, dealTitle],
	);

	useEffect(() => {
		setContext(ctx);
		return () => {
			resetContext();
		};
	}, [ctx, setContext, resetContext]);

	return null;
}
