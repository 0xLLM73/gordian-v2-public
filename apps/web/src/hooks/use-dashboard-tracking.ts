'use client';

import { trackEventAction } from '@/app/actions/analytics';
import type { ActNowAction, ActNowItemType, DashboardSection } from '@repo/shared';
import { useCallback, useEffect, useRef } from 'react';

function fireTrack(event: string, properties?: Record<string, unknown>) {
	void trackEventAction({ event, properties }).catch(() => {});
}

export function useDashboardTracking() {
	const trackActNowView = useCallback(
		(counts: {
			overdueCount: number;
			pendingDraftCount: number;
			followUpCount: number;
		}) => {
			fireTrack('dashboard.act_now_view', {
				overdue_count: counts.overdueCount,
				pending_draft_count: counts.pendingDraftCount,
				follow_up_count: counts.followUpCount,
			});
		},
		[],
	);

	const trackActNowClick = useCallback(
		(action: ActNowAction, itemType: ActNowItemType, itemId: string) => {
			fireTrack('dashboard.act_now_click', {
				action,
				item_type: itemType,
				item_id: itemId,
			});
		},
		[],
	);

	const trackWatchExpand = useCallback(
		(itemType: 'stale_contact' | 'ghosting_alert', contactId?: string) => {
			fireTrack('dashboard.watch_expand', {
				item_type: itemType,
				...(contactId ? { contact_id: contactId } : {}),
			});
		},
		[],
	);

	const trackNewIntelView = useCallback(
		(counts: {
			newContactCount: number;
			trendingTopicCount: number;
			introCount: number;
		}) => {
			fireTrack('dashboard.new_intel_view', {
				new_contact_count: counts.newContactCount,
				trending_topic_count: counts.trendingTopicCount,
				intro_count: counts.introCount,
			});
		},
		[],
	);

	const trackGhostingAlertAction = useCallback(
		(action: 'remind' | 'dismiss', contactId: string) => {
			fireTrack('dashboard.ghosting_alert_action', {
				action,
				contact_id: contactId,
			});
		},
		[],
	);

	return {
		trackActNowView,
		trackActNowClick,
		trackWatchExpand,
		trackNewIntelView,
		trackGhostingAlertAction,
	};
}

/**
 * Tracks time a dashboard section is visible using IntersectionObserver.
 * Attach the returned ref to the section's container element.
 * Fires `dashboard.section_time` when the section leaves the viewport.
 */
export function useSectionTimeTracking(section: DashboardSection) {
	const ref = useRef<HTMLDivElement>(null);
	const visibleSince = useRef<number | null>(null);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;

		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry?.isIntersecting) {
					visibleSince.current = Date.now();
				} else if (visibleSince.current !== null) {
					const ms = Date.now() - visibleSince.current;
					visibleSince.current = null;
					if (ms > 500) {
						fireTrack('dashboard.section_time', {
							section,
							visible_ms: ms,
						});
					}
				}
			},
			{ threshold: 0.5 },
		);

		observer.observe(el);
		return () => observer.disconnect();
	}, [section]);

	return ref;
}
