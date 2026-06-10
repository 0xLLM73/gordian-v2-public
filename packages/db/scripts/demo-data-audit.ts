import { createHash } from 'node:crypto';
import type { SealedEnvelope } from '@repo/crypto';
import { and, eq, sql } from 'drizzle-orm';
import { loadRootEnv } from '../../../scripts/lib/load-root-env.mjs';
import { db } from '../src/client';
import { listDealArtifacts } from '../src/dal/deal-artifacts';
import { dealParticipants } from '../src/schema/deal-participants';
import { workspaces } from '../src/schema/workspaces';

loadRootEnv();

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/gordian_dev';
process.env.DEV_KMS_BYPASS ??= 'true';

const SEEDED_DEMO_DEALS = [
	{
		workspaceId: deterministicUUID('workspace-alice'),
		dealId: deterministicUUID('alice-deal-aptos-series'),
	},
	{
		workspaceId: deterministicUUID('workspace-alice'),
		dealId: deterministicUUID('alice-deal-moveprotocol-seed'),
	},
	{
		workspaceId: deterministicUUID('workspace-alice'),
		dealId: deterministicUUID('alice-deal-fund-ii-lp'),
	},
	{
		workspaceId: deterministicUUID('workspace-alice'),
		dealId: deterministicUUID('alice-deal-token-warrant'),
	},
	{
		workspaceId: deterministicUUID('workspace-bob'),
		dealId: deterministicUUID('bob-deal-sol-otc'),
	},
	{
		workspaceId: deterministicUUID('workspace-bob'),
		dealId: deterministicUUID('bob-deal-pudgy-flip'),
	},
	{
		workspaceId: deterministicUUID('workspace-bob'),
		dealId: deterministicUUID('bob-deal-eth-usdc-lp'),
	},
	{
		workspaceId: deterministicUUID('workspace-bob'),
		dealId: deterministicUUID('bob-deal-bonk-play'),
	},
	{
		workspaceId: deterministicUUID('workspace-charlie'),
		dealId: deterministicUUID('charlie-deal-arb-delegation'),
	},
	{
		workspaceId: deterministicUUID('workspace-charlie'),
		dealId: deterministicUUID('charlie-deal-compound-audit'),
	},
	{
		workspaceId: deterministicUUID('workspace-charlie'),
		dealId: deterministicUUID('charlie-deal-snapshot-build'),
	},
	{
		workspaceId: deterministicUUID('workspace-charlie'),
		dealId: deterministicUUID('charlie-deal-op-retainer'),
	},
] as const;

const E2E_ARTIFACT_TITLE_PREFIXES = ['Sensitive Artifact', 'E2E artifact'] as const;

function deterministicUUID(name: string): string {
	const hash = createHash('sha256').update(`gordian-seed:${name}`).digest('hex');
	return [
		hash.slice(0, 8),
		hash.slice(8, 12),
		`4${hash.slice(13, 16)}`,
		`8${hash.slice(17, 20)}`,
		hash.slice(20, 32),
	].join('-');
}

async function getDemoWorkspaceEnvelope(workspaceId: string): Promise<SealedEnvelope | null> {
	const [workspace] = await db
		.select({
			encryptedWrk: workspaces.encryptedWrk,
			kmsContext: workspaces.kmsContext,
			wrkVersion: workspaces.wrkVersion,
		})
		.from(workspaces)
		.where(eq(workspaces.id, workspaceId))
		.limit(1);

	if (!workspace) return null;
	const rawContext = workspace.kmsContext;
	const kmsContext =
		typeof rawContext === 'string'
			? (JSON.parse(rawContext) as Record<string, string>)
			: (rawContext as Record<string, string>);

	return {
		encryptedWrk: Buffer.from(workspace.encryptedWrk, 'base64'),
		kmsContext,
		wrkVersion: workspace.wrkVersion,
	};
}

async function getParticipantCount(workspaceId: string, dealId: string): Promise<number> {
	const [row] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(dealParticipants)
		.where(and(eq(dealParticipants.workspaceId, workspaceId), eq(dealParticipants.dealId, dealId)));
	return Number(row?.count ?? 0);
}

async function main(): Promise<void> {
	const workspaceEnvelopes = new Map<string, SealedEnvelope | null>();
	const leakedArtifacts: string[] = [];
	const leakedParticipants: string[] = [];

	for (const { workspaceId } of SEEDED_DEMO_DEALS) {
		if (!workspaceEnvelopes.has(workspaceId)) {
			workspaceEnvelopes.set(workspaceId, await getDemoWorkspaceEnvelope(workspaceId));
		}
	}

	for (const { workspaceId, dealId } of SEEDED_DEMO_DEALS) {
		const envelope = workspaceEnvelopes.get(workspaceId);
		if (!envelope) continue;

		const artifacts = await listDealArtifacts(workspaceId, dealId, envelope);
		for (const artifact of artifacts) {
			const title = String(artifact.title ?? '');
			if (E2E_ARTIFACT_TITLE_PREFIXES.some((prefix) => title.startsWith(prefix))) {
				leakedArtifacts.push(`${workspaceId}/${dealId}: ${title}`);
			}
		}

		const participantCount = await getParticipantCount(workspaceId, dealId);
		if (participantCount > 0) {
			leakedParticipants.push(`${workspaceId}/${dealId}: ${participantCount} participant row(s)`);
		}
	}

	if (leakedArtifacts.length > 0 || leakedParticipants.length > 0) {
		console.error('Seeded demo data contains stale e2e fixture rows:');
		for (const artifact of leakedArtifacts) console.error(`  - artifact ${artifact}`);
		for (const participant of leakedParticipants) console.error(`  - participant ${participant}`);
		console.error('Run pnpm seed:demo against a local demo database before publishing or demoing.');
		process.exit(1);
	}

	console.log('Seeded demo data audit passed.');
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
