'use client';

import { MessageCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
// Needs client boundary: useState for panel toggle, provides ChatContextProvider to subtree
import { ChatContextProvider } from '@/hooks/use-chat-context';
import { useMediaQuery } from '@/hooks/use-media-query';
import { ChatPanel } from './chat-panel';

export function ChatToggle({ children }: { children: React.ReactNode }) {
	const [isOpen, setIsOpen] = useState(false);
	const isMobile = useMediaQuery('(max-width: 768px)');

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
				e.preventDefault();
				setIsOpen((prev) => !prev);
			}
			if (e.key === 'Escape' && isOpen) {
				setIsOpen(false);
			}
		};

		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [isOpen]);

	return (
		<ChatContextProvider>
			<div className="flex min-h-0 flex-1 overflow-hidden">
				<div className="flex flex-1 flex-col overflow-hidden">{children}</div>
				{isOpen && isMobile ? (
					<div className="fixed inset-0 z-50 bg-card">
						<ChatPanel onClose={() => setIsOpen(false)} />
					</div>
				) : isOpen ? (
					<div className="h-full w-96 flex-shrink-0 md:w-[28rem]">
						<ChatPanel onClose={() => setIsOpen(false)} />
					</div>
				) : null}
				{!isOpen ? (
					<Button
						size="icon"
						onClick={() => setIsOpen(true)}
						className="fixed bottom-6 right-6 z-50 h-12 w-12 rounded-full shadow-stripe-lg"
						aria-label="Open chat"
					>
						<MessageCircle className="h-6 w-6" />
					</Button>
				) : null}
			</div>
		</ChatContextProvider>
	);
}
