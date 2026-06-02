'use client';

import { getRealtimeTokenAction } from '@/app/actions/realtime';
import { createClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';

interface SyncProgress {
	contacts: number;
	messages: number;
	stage: string;
	isComplete: boolean;
}

interface RecentContact {
	id: string;
	firstName: string;
	lastName: string;
}

/** Per-contact insight from worker — shown in sync feed narrative */
export interface ContactInsight {
	name: string;
	lastMessageAt: string;
	messageCount: number;
}

/** Stale contact for ghosting alert */
export interface StaleContact {
	id: string;
	firstName: string | null;
	lastName: string | null;
	lastMessageAt: string | null;
	messageCount: number;
}

const POLL_INTERVAL_MS = 8000;

function getSupabaseRealtimeConfig() {
	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
	const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
	if (!supabaseUrl || !supabaseKey) return null;

	return { supabaseUrl, supabaseKey };
}

export function useOnboardingSync(workspaceId: string | null) {
	const [progress, setProgress] = useState<SyncProgress>({
		contacts: 0,
		messages: 0,
		stage: 'connecting',
		isComplete: false,
	});
	const [recentContacts, setRecentContacts] = useState<RecentContact[]>([]);
	const [feedEvents, setFeedEvents] = useState<ContactInsight[]>([]);
	const [staleContacts, setStaleContacts] = useState<StaleContact[]>([]);
	const channelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null);
	const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const fetchRecentContacts = useCallback(async () => {
		try {
			const res = await fetch('/api/onboarding/recent-contacts?limit=60');
			if (res.ok) {
				const data = (await res.json()) as RecentContact[];
				setRecentContacts(data);
			}
		} catch {
			// Ignore — non-critical display data
		}
	}, []);

	// Poll /api/onboarding/status as fallback
	useEffect(() => {
		if (!workspaceId || progress.isComplete) return;

		async function poll() {
			try {
				const res = await fetch('/api/onboarding/status');
				if (!res.ok) return;
				const data = (await res.json()) as {
					contacts: number;
					messages: number;
					synced: boolean;
					staleContacts?: StaleContact[];
				};

				setProgress((prev) => {
					const newContacts = Math.max(prev.contacts, data.contacts);
					const newMessages = Math.max(prev.messages, data.messages);
					const stage = data.synced
						? 'complete'
						: data.messages > 0
							? 'messages'
							: data.contacts > 0
								? 'contacts'
								: prev.stage;

					return {
						contacts: newContacts,
						messages: newMessages,
						stage,
						isComplete: data.synced,
					};
				});

				if (data.contacts > 0) {
					fetchRecentContacts();
				}

				// Polling fallback for stale contacts
				if (data.staleContacts?.length && staleContacts.length === 0) {
					setStaleContacts(data.staleContacts);
				}
			} catch {
				// Ignore polling errors
			}
		}

		poll(); // Immediate first poll
		pollRef.current = setInterval(poll, POLL_INTERVAL_MS);

		return () => {
			if (pollRef.current) {
				clearInterval(pollRef.current);
				pollRef.current = null;
			}
		};
	}, [workspaceId, progress.isComplete, fetchRecentContacts, staleContacts.length]);

	// Subscribe to Supabase Broadcast for real-time updates
	useEffect(() => {
		if (!workspaceId) return;
		let cancelled = false;

		async function connect() {
			const config = getSupabaseRealtimeConfig();
			if (!config) return;

			const result = await getRealtimeTokenAction({});
			if (cancelled || !result?.data?.token) return;

			const supabase = createClient(config.supabaseUrl, config.supabaseKey);

			supabase.realtime.setAuth(result.data.token);

			const channel = supabase.channel(`workspace:${workspaceId}`, {
				config: { private: true },
			});

			channel
				.on(
					'broadcast',
					{ event: 'sync-progress' },
					(payload: {
						payload: {
							contacts: number;
							messages: number;
							stage: string;
							contactProcessed?: ContactInsight;
							staleContacts?: StaleContact[];
						};
					}) => {
						const p = payload.payload;
						setProgress((prev) => ({
							contacts: Math.max(prev.contacts, p.contacts),
							messages: Math.max(prev.messages, p.messages),
							stage: p.stage,
							isComplete: p.stage === 'complete',
						}));
						if (p.contacts > 0) {
							fetchRecentContacts();
						}
						// Track D: accumulate per-contact insights for feed narrative
						if (p.contactProcessed) {
							const processed = p.contactProcessed;
							setFeedEvents((prev) => [...prev, processed]);
						}
						// Track D: ghosting alert
						if (p.staleContacts?.length) {
							setStaleContacts(p.staleContacts);
						}
					},
				)
				.on('broadcast', { event: 'telegram-sync-batch' }, () => {
					// Sync batch completed — refetch contacts
					fetchRecentContacts();
					setProgress((prev) => ({ ...prev, isComplete: true, stage: 'complete' }));
				})
				.subscribe();

			channelRef.current = channel;
		}

		connect();

		return () => {
			cancelled = true;
			if (channelRef.current) {
				channelRef.current.unsubscribe();
				channelRef.current = null;
			}
		};
	}, [workspaceId, fetchRecentContacts]);

	return { ...progress, recentContacts, feedEvents, staleContacts };
}
