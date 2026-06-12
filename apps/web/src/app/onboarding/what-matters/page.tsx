'use client';

import type { ContactSuggestion } from '@repo/db';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { trackEventAction } from '@/app/actions/analytics';
import {
	getPriorityContactSuggestionsAction,
	saveWhatMattersAction,
} from '@/app/actions/calibration';
import { OnboardingCard } from '@/components/onboarding/onboarding-card';
import { useOnboarding } from '@/components/onboarding/onboarding-provider';
import { Button } from '@/components/ui/button';
import { useAbandonTracking } from '@/hooks/use-abandon-tracking';
import { useStepTracking } from '@/hooks/use-step-tracking';
import { cn } from '@/lib/utils';

type Sensitivity = 'everything' | 'specific' | 'tasks_only';
type UserRole = 'vc_investor' | 'founder' | 'bd' | 'community' | 'developer' | 'other';
type PrimaryGoal = 'commitments' | 'reconnect' | 'network' | 'deal_flow';

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
	{ value: 'vc_investor', label: 'VC / Investor' },
	{ value: 'founder', label: 'Founder' },
	{ value: 'bd', label: 'BD / Partnerships' },
	{ value: 'community', label: 'Community' },
	{ value: 'developer', label: 'Developer' },
	{ value: 'other', label: 'Other' },
];

const SENSITIVITY_OPTIONS: { value: Sensitivity; label: string; description: string }[] = [
	{
		value: 'everything',
		label: 'Track everything',
		description: 'I mean what I say — even casual promises',
	},
	{
		value: 'specific',
		label: 'Only if I set a specific time',
		description: "Coffee sometime? That's just being polite",
	},
	{
		value: 'tasks_only',
		label: "That's small talk — only real tasks",
		description: 'Only explicit action items with clear deliverables',
	},
];

const GOAL_OPTIONS: { value: PrimaryGoal; label: string; description: string }[] = [
	{
		value: 'commitments',
		label: 'Track my commitments',
		description: 'Never drop a promise or follow-up again',
	},
	{
		value: 'reconnect',
		label: 'Reconnect with people',
		description: 'Surface contacts I should reach out to',
	},
	{
		value: 'network',
		label: 'Grow my network',
		description: 'Find warm intros and strengthen connections',
	},
	{
		value: 'deal_flow',
		label: 'Manage deal flow',
		description: 'Track deals, pipeline, and investor relationships',
	},
];

export default function WhatMattersPage() {
	const router = useRouter();
	const { workspaceId, hydrated } = useOnboarding();

	const [role, setRole] = useState<UserRole | null>(null);
	const [sensitivity, setSensitivity] = useState<Sensitivity>('specific');
	const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());
	const [goal, setGoal] = useState<PrimaryGoal | null>(null);
	const [mostActive, setMostActive] = useState<ContactSuggestion[]>([]);
	const [mostNeglected, setMostNeglected] = useState<ContactSuggestion[]>([]);
	const [loading, setLoading] = useState(true);
	const [submitting, setSubmitting] = useState(false);
	const fetchedRef = useRef(false);
	useAbandonTracking('what_matters', workspaceId);
	const completeStep = useStepTracking('what_matters', workspaceId);

	useEffect(() => {
		if (!hydrated) return;
		if (!workspaceId) {
			router.replace('/onboarding/connect');
		}
	}, [hydrated, workspaceId, router]);

	useEffect(() => {
		if (!workspaceId || fetchedRef.current) return;
		fetchedRef.current = true;

		getPriorityContactSuggestionsAction({})
			.then((result) => {
				if (result?.data) {
					setMostActive(result.data.mostActive);
					setMostNeglected(result.data.mostNeglected);
				}
			})
			.catch((err) => {
				console.error('[what-matters] Failed to fetch contacts:', err);
			})
			.finally(() => setLoading(false));
	}, [workspaceId]);

	const toggleContact = (id: string) => {
		setSelectedContacts((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	};

	const handleSubmit = async () => {
		setSubmitting(true);
		try {
			await saveWhatMattersAction({
				commitmentSensitivity: sensitivity,
				priorityContactIds: [...selectedContacts],
				...(role && { userRole: role }),
				...(goal && { primaryGoal: goal }),
			});
			trackEventAction({
				event: 'onboarding.coffee_test_answered',
				properties: { sensitivity },
			});
			if (selectedContacts.size > 0) {
				trackEventAction({
					event: 'onboarding.priority_contacts_selected',
					properties: { count: selectedContacts.size },
				});
			}
		} catch (err) {
			console.error('[what-matters] Failed to save:', err);
		} finally {
			setSubmitting(false);
		}
		completeStep();
		router.push('/onboarding/calibrate');
	};

	const handleSkip = () => {
		completeStep();
		router.push('/onboarding/calibrate');
	};

	if (!hydrated || !workspaceId) return null;

	return (
		<OnboardingCard className="max-w-xl">
			<div className="mb-6">
				<h1 className="text-2xl font-bold text-foreground">What matters to you?</h1>
				<p className="mt-2 text-sm text-muted-foreground">
					Help Gordian understand how you communicate so it tracks the right things.
				</p>
			</div>

			{/* Section 1: Role */}
			<div className="mb-8">
				<h2 className="mb-1 text-sm font-semibold text-foreground">What best describes you?</h2>
				<p className="mb-3 text-xs text-muted-foreground">This helps us tailor your experience.</p>
				<div className="flex flex-wrap gap-2">
					{ROLE_OPTIONS.map((opt) => (
						<button
							key={opt.value}
							type="button"
							onClick={() => setRole(role === opt.value ? null : opt.value)}
							className={cn(
								'rounded-full border px-3 py-1.5 text-sm transition-all',
								role === opt.value
									? 'border-primary bg-primary/10 text-primary'
									: 'border-border bg-card text-foreground hover:border-primary/30',
							)}
						>
							{opt.label}
						</button>
					))}
				</div>
			</div>

			{/* Section 2: Coffee Test */}
			<div className="mb-8">
				<h2 className="mb-1 text-sm font-semibold text-foreground">The Coffee Test</h2>
				<p className="mb-3 text-xs text-muted-foreground">
					If you tell someone "Let's grab coffee sometime," should I track that?
				</p>
				<div className="space-y-2">
					{SENSITIVITY_OPTIONS.map((opt) => (
						<button
							key={opt.value}
							type="button"
							onClick={() => setSensitivity(opt.value)}
							className={cn(
								'w-full rounded-lg border p-3 text-left transition-all',
								sensitivity === opt.value
									? 'border-primary bg-primary/5 ring-1 ring-primary/20'
									: 'border-border bg-card hover:border-primary/30',
							)}
						>
							<p className="text-sm font-medium text-foreground">{opt.label}</p>
							<p className="mt-0.5 text-xs text-muted-foreground">{opt.description}</p>
						</button>
					))}
				</div>
			</div>

			{/* Section 3: Priority Contacts */}
			<div className="mb-8">
				<h2 className="mb-1 text-sm font-semibold text-foreground">Who matters most right now?</h2>
				<p className="mb-3 text-xs text-muted-foreground">
					Tap to select — these contacts get processed first.
				</p>

				{loading ? (
					<div className="flex items-center justify-center py-8">
						<Loader2 className="size-5 animate-spin text-muted-foreground" />
					</div>
				) : (
					<div className="space-y-4">
						{mostActive.length > 0 && (
							<div>
								<p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
									Most Active
								</p>
								<div className="flex flex-wrap gap-2">
									{mostActive.map((c) => (
										<ContactChip
											key={c.id}
											contact={c}
											selected={selectedContacts.has(c.id)}
											onClick={() => toggleContact(c.id)}
											detail={`${c.messageCount} messages`}
										/>
									))}
								</div>
							</div>
						)}

						{mostNeglected.length > 0 && (
							<div>
								<p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
									Haven't talked to in a while
								</p>
								<div className="flex flex-wrap gap-2">
									{mostNeglected.map((c) => (
										<ContactChip
											key={c.id}
											contact={c}
											selected={selectedContacts.has(c.id)}
											onClick={() => toggleContact(c.id)}
											detail={
												c.lastMessageAt
													? `${Math.round((Date.now() - new Date(c.lastMessageAt).getTime()) / 86400000)}d ago`
													: ''
											}
										/>
									))}
								</div>
							</div>
						)}

						{mostActive.length === 0 && mostNeglected.length === 0 && (
							<p className="py-4 text-center text-xs text-muted-foreground">
								Sync is still running — contacts will appear once messages are processed.
							</p>
						)}
					</div>
				)}
			</div>

			{/* Section 4: Goal */}
			<div className="mb-8">
				<h2 className="mb-1 text-sm font-semibold text-foreground">
					What should I focus on for you?
				</h2>
				<p className="mb-3 text-xs text-muted-foreground">
					Pick the one that matters most — you can change this later.
				</p>
				<div className="space-y-2">
					{GOAL_OPTIONS.map((opt) => (
						<button
							key={opt.value}
							type="button"
							onClick={() => setGoal(goal === opt.value ? null : opt.value)}
							className={cn(
								'w-full rounded-lg border p-3 text-left transition-all',
								goal === opt.value
									? 'border-primary bg-primary/5 ring-1 ring-primary/20'
									: 'border-border bg-card hover:border-primary/30',
							)}
						>
							<p className="text-sm font-medium text-foreground">{opt.label}</p>
							<p className="mt-0.5 text-xs text-muted-foreground">{opt.description}</p>
						</button>
					))}
				</div>
			</div>

			{/* Actions */}
			<div className="flex justify-between">
				<Button variant="outline" onClick={handleSkip}>
					Skip
				</Button>
				<Button onClick={handleSubmit} disabled={submitting}>
					{submitting ? (
						<>
							<Loader2 className="mr-2 size-4 animate-spin" />
							Saving...
						</>
					) : (
						'Continue'
					)}
				</Button>
			</div>
		</OnboardingCard>
	);
}

function ContactChip({
	contact,
	selected,
	onClick,
	detail,
}: {
	contact: ContactSuggestion;
	selected: boolean;
	onClick: () => void;
	detail: string;
}) {
	const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Unknown';

	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-all',
				selected
					? 'border-primary bg-primary/10 text-primary'
					: 'border-border bg-card text-foreground hover:border-primary/30',
			)}
		>
			<span className="font-medium">{name}</span>
			{detail && <span className="text-xs text-muted-foreground">· {detail}</span>}
		</button>
	);
}
