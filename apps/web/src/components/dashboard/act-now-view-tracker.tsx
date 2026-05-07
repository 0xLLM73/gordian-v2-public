'use client';
// 'use client' — needs useEffect to fire analytics event on mount

import { useDashboardTracking } from '@/hooks/use-dashboard-tracking';
import { useEffect } from 'react';

export function ActNowViewTracker({
	overdueCount,
	pendingDraftCount,
	followUpCount,
}: {
	overdueCount: number;
	pendingDraftCount: number;
	followUpCount: number;
}) {
	const { trackActNowView } = useDashboardTracking();

	useEffect(() => {
		trackActNowView({ overdueCount, pendingDraftCount, followUpCount });
	}, [trackActNowView, overdueCount, pendingDraftCount, followUpCount]);

	return null;
}
