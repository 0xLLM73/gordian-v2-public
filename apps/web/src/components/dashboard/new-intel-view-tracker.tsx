'use client';

// 'use client' — needs useEffect to fire analytics event on mount

import { useEffect } from 'react';
import { useDashboardTracking } from '@/hooks/use-dashboard-tracking';

export function NewIntelViewTracker({
	newContactCount,
	trendingTopicCount,
	introCount,
}: {
	newContactCount: number;
	trendingTopicCount: number;
	introCount: number;
}) {
	const { trackNewIntelView } = useDashboardTracking();

	useEffect(() => {
		trackNewIntelView({ newContactCount, trendingTopicCount, introCount });
	}, [trackNewIntelView, newContactCount, trendingTopicCount, introCount]);

	return null;
}
