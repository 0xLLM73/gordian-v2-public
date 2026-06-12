'use client';

import { createClient } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { getRealtimeTokenAction } from '@/app/actions/realtime';

/** Token refresh interval: 50 minutes (token expires at 60) */
const TOKEN_REFRESH_MS = 50 * 60 * 1000;

function getSupabaseRealtimeConfig() {
	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
	const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
	if (!supabaseUrl || !supabaseKey) return null;

	return { supabaseUrl, supabaseKey };
}

export function useRealtimeSync(workspaceId: string) {
	const router = useRouter();
	const channelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null);
	const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

	useEffect(() => {
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
				.on('broadcast', { event: 'telegram-sync-batch' }, () => {
					router.refresh();
				})
				.on('broadcast', { event: 'new-message' }, () => {
					router.refresh();
				})
				.on('broadcast', { event: 'morning-brief' }, () => {
					router.refresh();
				})
				.subscribe();

			channelRef.current = channel;

			// Refresh token before expiry
			refreshRef.current = setInterval(async () => {
				const refreshResult = await getRealtimeTokenAction({});
				if (refreshResult?.data?.token) {
					supabase.realtime.setAuth(refreshResult.data.token);
				}
			}, TOKEN_REFRESH_MS);
		}

		connect();

		return () => {
			cancelled = true;
			if (channelRef.current) {
				channelRef.current.unsubscribe();
				channelRef.current = null;
			}
			if (refreshRef.current) {
				clearInterval(refreshRef.current);
				refreshRef.current = null;
			}
		};
	}, [workspaceId, router]);
}
