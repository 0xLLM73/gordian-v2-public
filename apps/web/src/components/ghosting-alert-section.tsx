import { getHealthScoresByContactIds, getPreferences, getStaleContacts } from '@repo/db';
import type { GhostingContact } from '@/components/ghosting-alert-card';
import { GhostingAlertCard } from '@/components/ghosting-alert-card';
import { getWorkspaceEnvelope } from '@/lib/workspace';

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
	if (prefs.ghostingAlertStatuses.length === 0) return null;

	const staleContacts = await getStaleContacts(workspaceId, envelope, {
		staleDays: prefs.ghostingStaleDays,
		limit: 10,
	});

	if (staleContacts.length === 0) return null;

	// Enrich the exact stale contacts; a top-N health slice can miss neglected contacts.
	const healthScores = await getHealthScoresByContactIds(
		workspaceId,
		staleContacts.map((c) => c.id),
	);
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
			if (!c.healthLabel) return true; // No health data yet — show by default
			return alertStatuses.has(c.healthLabel);
		});

	if (contacts.length === 0) return null;

	return <GhostingAlertCard contacts={contacts} />;
}
