'use client';

// 'use client' — needs useEffect to fire analytics event on mount

import { useEffect } from 'react';
import { useDashboardTracking } from '@/hooks/use-dashboard-tracking';

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
