'use client';
// 'use client' — needs ref + IntersectionObserver for section visibility time tracking

import { useSectionTimeTracking } from '@/hooks/use-dashboard-tracking';
import type { DashboardSection } from '@repo/shared';

export function SectionTimeWrapper({
	section,
	children,
	className,
}: {
	section: DashboardSection;
	children: React.ReactNode;
	className?: string;
}) {
	const ref = useSectionTimeTracking(section);
	return (
		<section ref={ref} className={className}>
			{children}
		</section>
	);
}
