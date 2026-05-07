'use client';

import { useRealtimeSync } from '@/hooks/use-realtime';

export function RealtimeSync({ workspaceId }: { workspaceId: string }) {
	useRealtimeSync(workspaceId);
	return null;
}
