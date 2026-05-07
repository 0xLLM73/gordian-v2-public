import { AppSidebar } from '@/components/app-sidebar';
import { ChatToggle } from '@/components/chat/chat-toggle';
import { RealtimeSync } from '@/components/realtime-sync';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/sonner';
import { getUserWorkspaceId, requireSession } from '@/lib/workspace';

export default async function DashboardLayout({
	children,
	analytics,
}: {
	children: React.ReactNode;
	analytics: React.ReactNode;
}) {
	const session = await requireSession();
	const workspaceId = await getUserWorkspaceId(session.user.id);

	return (
		<SidebarProvider>
			{workspaceId ? <RealtimeSync workspaceId={workspaceId} /> : null}
			<AppSidebar />
			<SidebarInset className="h-svh overflow-hidden">
				<header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
					<SidebarTrigger className="-ml-1" />
				</header>
				<ChatToggle>
					<div className="flex flex-1 overflow-hidden">
						<main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
						{analytics && (
							<aside className="hidden w-80 overflow-y-auto border-l border-border p-6 xl:block">
								{analytics}
							</aside>
						)}
					</div>
				</ChatToggle>
			</SidebarInset>
			<Toaster richColors />
		</SidebarProvider>
	);
}
