'use client';

import {
	BarChart3,
	BookOpen,
	CalendarCheck,
	Coins,
	FileText,
	HandshakeIcon,
	LayoutDashboard,
	LogOut,
	Network,
	Search,
	Settings,
	Target,
	Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from '@/components/ui/sidebar';
import { authClient } from '@/lib/auth-client';

const navGroups = [
	{
		label: 'Main',
		items: [
			{ href: '/', label: 'Dashboard', icon: LayoutDashboard },
			{ href: '/search', label: 'Search', icon: Search },
		],
	},
	{
		label: 'CRM',
		items: [
			{ href: '/contacts', label: 'Contacts', icon: Users },
			{ href: '/deals', label: 'Deals', icon: FileText },
			{ href: '/commitments', label: 'Commitments', icon: CalendarCheck },
			{ href: '/goals', label: 'Goals', icon: Target },
		],
	},
	{
		label: 'Intelligence',
		items: [
			{ href: '/digest', label: 'Digest', icon: BarChart3 },
			{ href: '/introductions', label: 'Network', icon: Network },
			{ href: '/knowledge', label: 'Knowledge', icon: BookOpen },
		],
	},
	{
		label: 'Other',
		items: [
			{ href: '/tokens', label: 'Tokens', icon: Coins },
			{ href: '/follow-up-plans', label: 'Follow-up Plans', icon: HandshakeIcon },
		],
	},
];

export function AppSidebar() {
	const pathname = usePathname();
	const router = useRouter();

	async function handleSignOut() {
		await authClient.signOut();
		router.push('/login');
	}

	return (
		<Sidebar collapsible="icon">
			<SidebarHeader className="border-b border-sidebar-border px-4 py-3">
				<Link href="/" className="flex items-center gap-2">
					<div className="flex h-7 w-7 items-center justify-center rounded-md gradient-stripe">
						<span className="text-sm font-bold text-white">G</span>
					</div>
					<span className="text-lg font-bold text-sidebar-foreground group-data-[collapsible=icon]:hidden">
						Gordian
					</span>
				</Link>
			</SidebarHeader>
			<SidebarContent>
				{navGroups.map((group) => (
					<SidebarGroup key={group.label}>
						<SidebarGroupLabel>{group.label}</SidebarGroupLabel>
						<SidebarGroupContent>
							<SidebarMenu>
								{group.items.map((item) => {
									const isActive =
										item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
									return (
										<SidebarMenuItem key={item.href}>
											<SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
												<Link href={item.href}>
													<item.icon />
													<span>{item.label}</span>
												</Link>
											</SidebarMenuButton>
										</SidebarMenuItem>
									);
								})}
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				))}
			</SidebarContent>
			<SidebarFooter>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton asChild tooltip="Settings">
							<Link href="/settings">
								<Settings />
								<span>Settings</span>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<SidebarMenuButton onClick={handleSignOut} tooltip="Sign out">
							<LogOut />
							<span>Sign out</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarFooter>
		</Sidebar>
	);
}
