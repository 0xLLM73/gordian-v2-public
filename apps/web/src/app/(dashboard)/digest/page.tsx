import { getCalibration, getContactsByIds, listDigests } from '@repo/db';
import { Suspense } from 'react';
import { DigestViewer } from '@/components/digest/digest-viewer';
import { getUserWorkspaceId, getWorkspaceEnvelope, requireSession } from '@/lib/workspace';

export default async function DigestPage() {
	const session = await requireSession();
	const workspaceId = await getUserWorkspaceId(session.user.id);
	if (!workspaceId) return <div>Set up your workspace first.</div>;

	return (
		<div>
			<div className="mb-6 flex items-center justify-between">
				<h1 className="text-2xl font-bold text-foreground">Daily Digest</h1>
			</div>
			<Suspense fallback={<DigestSkeleton />}>
				<DigestContent workspaceId={workspaceId} userId={session.user.id} />
			</Suspense>
		</div>
	);
}

async function DigestContent({ workspaceId, userId }: { workspaceId: string; userId: string }) {
	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) return <div>Encryption key not found.</div>;
	const [pastDigests, calibration] = await Promise.all([
		listDigests(workspaceId, userId, envelope, { limit: 10 }),
		getCalibration(userId, workspaceId, envelope),
	]);
	const canGenerateDigest = calibration?.consentAiAnalysis === true;

	// Extract unique contactId UUIDs from all digest sections (contact_ref + inline in text)
	const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
	const contactIds = new Set<string>();
	for (const digest of pastDigests) {
		const sections = digest.sections as Record<string, unknown> | null;
		if (!sections) continue;
		for (const key of ['key_conversations', 'highlights', 'action_items', 'watch_list'] as const) {
			const items = sections[key];
			if (Array.isArray(items)) {
				for (const item of items) {
					const obj = item as Record<string, unknown>;
					// Scan all string fields in each section item for UUIDs
					for (const val of Object.values(obj)) {
						if (typeof val === 'string') {
							for (const match of val.matchAll(UUID_RE)) {
								contactIds.add(match[0].toLowerCase());
							}
						}
					}
				}
			}
		}
		// Also scan the activity_overview summary
		const overview = sections.activity_overview as Record<string, unknown> | undefined;
		if (overview?.summary && typeof overview.summary === 'string') {
			for (const match of overview.summary.matchAll(UUID_RE)) {
				contactIds.add(match[0].toLowerCase());
			}
		}
	}

	// SEC-006: Resolve contactIds to names, project only id + firstName + lastName
	const contactMap: Record<string, string> = {};
	if (contactIds.size > 0) {
		const contacts = await getContactsByIds(workspaceId, [...contactIds], envelope);
		for (const c of contacts) {
			const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown';
			contactMap[c.id.toLowerCase()] = name;
		}
	}

	return (
		<DigestViewer
			pastDigests={pastDigests}
			contactMap={contactMap}
			canGenerate={canGenerateDigest}
			generateDisabledReason={
				canGenerateDigest
					? undefined
					: 'Enable AI analysis consent before generating a digest from imported messages.'
			}
		/>
	);
}

function DigestSkeleton() {
	return (
		<div className="space-y-4">
			{[1, 2, 3].map((i) => (
				<div key={i} className="animate-pulse rounded-lg border border-border bg-card p-6">
					<div className="h-5 w-48 rounded bg-muted" />
					<div className="mt-3 h-4 w-full rounded bg-muted" />
					<div className="mt-2 h-4 w-3/4 rounded bg-muted" />
				</div>
			))}
		</div>
	);
}
