import { GhostingAlertCard } from '@/components/ghosting-alert-card';
import type { GhostingContact } from '@/components/ghosting-alert-card';
import { getWorkspaceEnvelope } from '@/lib/workspace';
import { getHealthScoresByWorkspace, getPreferences, getStaleContacts } from '@repo/db';

interface GhostingAlertSectionProps {
	workspaceId: string;
	userId: string;
}

/**
 * Server component that fetches stale contacts enriched with health labels
 * and passes them to the client-side GhostingAlertCard.
 * Import this into a dashboard section wrapped in <Suspense>.
 */
export async function GhostingAlertSection({ workspaceId, userId }: GhostingAlertSectionProps) {
	const [envelope, prefs] = await Promise.all([
		getWorkspaceEnvelope(workspaceId),
		getPreferences(workspaceId, userId),
	]);

	if (!envelope) return null;

	const staleContacts = await getStaleContacts(workspaceId, envelope, {
		staleDays: prefs.ghostingStaleDays,
		limit: 10,
	});

	if (staleContacts.length === 0) return null;

	// Enrich with health labels — fetch scores for contacts that match user's alert preferences
	const healthScores = await getHealthScoresByWorkspace(workspaceId, { limit: 200 });
	const healthMap = new Map(healthScores.map((h) => [h.contactId, h.label]));

	const alertStatuses: Set<string> = new Set(prefs.ghostingAlertStatuses);

	const contacts: GhostingContact[] = staleContacts
		.map((c) => ({
			id: c.id,
			firstName: c.firstName as string | null,
			lastName: c.lastName as string | null,
			lastMessageAt: c.lastMessageAt ? c.lastMessageAt.toISOString() : null,
			messageCount: c.messageCount ?? 0,
			healthLabel: healthMap.get(c.id) ?? null,
		}))
		.filter((c) => {
			// If user configured alert statuses, only show contacts matching those labels
			if (alertStatuses.size === 0) return true;
			if (!c.healthLabel) return true; // No health data yet — show by default
			return alertStatuses.has(c.healthLabel);
		});

	if (contacts.length === 0) return null;

	return <GhostingAlertCard contacts={contacts} />;
}
