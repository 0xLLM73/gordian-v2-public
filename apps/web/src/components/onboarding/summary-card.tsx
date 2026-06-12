'use client';

import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { getOnboardingSummaryAction } from '@/app/actions/calibration';

const ROLE_LABELS: Record<string, string> = {
	vc_investor: 'a VC / Investor',
	founder: 'a Founder',
	bd: 'in BD / Partnerships',
	community: 'in Community',
	developer: 'a Developer',
	other: 'a professional',
};

const GOAL_LABELS: Record<string, string> = {
	commitments: 'tracking commitments',
	reconnect: 'reconnecting with people',
	network: 'growing your network',
	deal_flow: 'managing deal flow',
};

interface SummaryData {
	userRole: string | null;
	primaryGoal: string | null;
	priorityContactCount: number;
	contactCount: number;
	commitmentCount: number;
	briefTime: number;
}

function formatBriefTime(hour: number): string {
	const period = hour >= 12 ? 'PM' : 'AM';
	const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
	return `${displayHour}:00 ${period}`;
}

export function SummaryCard() {
	const [data, setData] = useState<SummaryData | null>(null);
	const [loading, setLoading] = useState(true);
	const fetchedRef = useRef(false);

	useEffect(() => {
		if (fetchedRef.current) return;
		fetchedRef.current = true;
		let cancelled = false;

		getOnboardingSummaryAction({})
			.then((result) => {
				if (!cancelled && result?.data) {
					setData(result.data);
				}
			})
			.catch((err) => {
				if (!cancelled) {
					console.error('[summary-card] Failed to fetch:', err);
				}
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, []);

	if (loading) {
		return (
			<div className="flex items-center justify-center rounded-lg border border-border bg-card p-6">
				<Loader2 className="size-5 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (!data) return null;

	const lines: string[] = [];

	if (data.userRole && data.primaryGoal) {
		const role = ROLE_LABELS[data.userRole] ?? data.userRole;
		const goal = GOAL_LABELS[data.primaryGoal] ?? data.primaryGoal;
		lines.push(`You're ${role} focused on ${goal}.`);
	} else if (data.userRole) {
		lines.push(`You're ${ROLE_LABELS[data.userRole] ?? data.userRole}.`);
	} else if (data.primaryGoal) {
		lines.push(`Focused on ${GOAL_LABELS[data.primaryGoal] ?? data.primaryGoal}.`);
	}

	if (data.contactCount > 0) {
		lines.push(`${data.contactCount} contacts synced.`);
	}
	if (data.priorityContactCount > 0) {
		lines.push(`${data.priorityContactCount} priority contacts selected.`);
	}
	if (data.commitmentCount > 0) {
		lines.push(`${data.commitmentCount} commitments found.`);
	}
	lines.push(`Your morning brief arrives at ${formatBriefTime(data.briefTime)}.`);

	if (lines.length === 0) return null;

	return (
		<div className="rounded-lg border border-border bg-card p-4">
			<h3 className="mb-2 text-sm font-semibold text-foreground">
				Here's what I learned about you
			</h3>
			<ul className="space-y-1">
				{lines.map((line) => (
					<li key={line} className="text-sm text-muted-foreground">
						{line}
					</li>
				))}
			</ul>
			<Link href="/settings" className="mt-3 inline-block text-xs text-primary hover:underline">
				Edit preferences
			</Link>
		</div>
	);
}
