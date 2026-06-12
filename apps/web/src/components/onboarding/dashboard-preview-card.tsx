'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { GuidedActionCard } from '@/components/onboarding/guided-action-card';
import { Button } from '@/components/ui/button';

interface Stats {
	contacts: number;
	messages: number;
}

export function DashboardPreviewCard() {
	const [stats, setStats] = useState<Stats>({ contacts: 0, messages: 0 });

	useEffect(() => {
		async function load() {
			try {
				const res = await fetch('/api/onboarding/status');
				if (!res.ok) return;
				const data = (await res.json()) as { contacts: number; messages: number };
				setStats(data);
			} catch {
				// Non-critical
			}
		}
		load();
	}, []);

	return (
		<GuidedActionCard
			title="Your dashboard is ready"
			description="Here's a preview of what Gordian found"
			accentColor="bg-success"
		>
			<div className="flex gap-6">
				<div>
					<span className="text-2xl font-bold tabular-nums text-foreground">{stats.contacts}</span>
					<p className="text-xs text-muted-foreground">contacts</p>
				</div>
				<div>
					<span className="text-2xl font-bold tabular-nums text-foreground">{stats.messages}</span>
					<p className="text-xs text-muted-foreground">messages analyzed</p>
				</div>
			</div>
			<Button asChild className="mt-4 w-full">
				<Link href="/?welcome=1">Go to Dashboard</Link>
			</Button>
		</GuidedActionCard>
	);
}
