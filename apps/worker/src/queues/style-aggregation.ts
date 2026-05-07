import {
	contactStyleOverrides,
	db,
	eq,
	getContactStyleOverridesBatch,
	isFeatureEnabled,
	updateDeviationSignals,
	upsertVoiceProfile,
	workspaceMembers,
} from '@repo/db';
import { Queue, Worker } from 'bullmq';
import { withRLS } from '../middleware/rls';
import { connection } from '../redis';

// ─── Queue ───────────────────────────────────────────────────────────────────

export const styleAggregationQueue = new Queue('style-aggregation', {
	connection,
	prefix: '{ai-flow}',
	defaultJobOptions: {
		attempts: 2,
		backoff: { type: 'exponential', delay: 30000 },
		removeOnComplete: { count: 50 },
		removeOnFail: { count: 100 },
	},
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function inferDominantTone(override: {
	contractionRate: number;
	slangRate: number;
	greetingRate: number;
	exclamationRate: number;
}): 'casual' | 'professional' | 'warm' | 'terse' {
	const informal = override.contractionRate + override.slangRate;
	if (override.greetingRate > 0.4 && override.exclamationRate > 0.3) return 'warm';
	if (informal > 0.3) return 'casual';
	if (informal < 0.1 && override.greetingRate < 0.1) return 'terse';
	return 'professional';
}

// ─── Worker ──────────────────────────────────────────────────────────────────

export const styleAggregationWorker = new Worker(
	'style-aggregation',
	withRLS(async () => {
		console.log('[style-aggregation] Starting nightly aggregation...');

		// 1. Get distinct workspaces that have contact_style_overrides data
		const workspaceRows = await db
			.selectDistinct({ workspaceId: contactStyleOverrides.workspaceId })
			.from(contactStyleOverrides);

		if (workspaceRows.length === 0) {
			console.log('[style-aggregation] No workspaces with style data, skipping.');
			return;
		}

		let profilesUpserted = 0;
		let deviationsUpdated = 0;

		// [SEC-FIX MED-4] Process one workspace at a time
		for (const { workspaceId } of workspaceRows) {
			// [SEC-FIX HIGH-2] Feature flag check per workspace
			const enabled = await isFeatureEnabled('voice_profile_collection', workspaceId);
			if (!enabled) continue;

			// [SEC-FIX CRIT-3] Paginate through overrides in batches of 500
			const allOverrides: Array<{
				contactId: string;
				avgMessageLength: number;
				emojiRate: number;
				contractionRate: number;
				exclamationRate: number;
				questionAskRate: number;
				greetingRate: number;
				signoffRate: number;
				slangRate: number;
				avgWordCount: number;
				fillerWordRate: number;
				avgUniqueWordRatio: number;
				emojiTopN: unknown;
				sampleSize: number;
			}> = [];

			let offset = 0;
			const batchSize = 500;
			let hasMore = true;
			while (hasMore) {
				const batch = await getContactStyleOverridesBatch(workspaceId, {
					limit: batchSize,
					offset,
				});
				allOverrides.push(...batch);
				hasMore = batch.length === batchSize;
				offset += batchSize;
			}

			if (allOverrides.length === 0) continue;

			// [SEC-FIX HIGH-4] Only process data that already exists — no unbounded queries

			// Compute weighted average across all contacts for this workspace (by sampleSize)
			let totalWeight = 0;
			let wAvgMessageLength = 0;
			let wAvgWordCount = 0;
			let wEmojiRate = 0;
			let wContractionRate = 0;
			let wExclamationRate = 0;
			const wQuestionRate = 0;
			let wQuestionAskRate = 0;
			const wEllipsisRate = 0;
			const wAllCapsRate = 0;
			let wGreetingRate = 0;
			let wSignoffRate = 0;
			let wSlangRate = 0;
			let wFillerWordRate = 0;
			let wAvgUniqueWordRatio = 0;
			let totalSamples = 0;

			for (const o of allOverrides) {
				const w = o.sampleSize;
				if (w <= 0) continue;
				totalWeight += w;
				wAvgMessageLength += o.avgMessageLength * w;
				wAvgWordCount += o.avgWordCount * w;
				wEmojiRate += o.emojiRate * w;
				wContractionRate += o.contractionRate * w;
				wExclamationRate += o.exclamationRate * w;
				wQuestionAskRate += o.questionAskRate * w;
				wGreetingRate += o.greetingRate * w;
				wSignoffRate += o.signoffRate * w;
				wSlangRate += o.slangRate * w;
				wFillerWordRate += o.fillerWordRate * w;
				wAvgUniqueWordRatio += o.avgUniqueWordRatio * w;
				totalSamples += w;
			}

			if (totalWeight === 0) continue;

			const baseProfile = {
				avgMessageLength: wAvgMessageLength / totalWeight,
				medianMessageLength: wAvgMessageLength / totalWeight, // Approximation from aggregate
				avgWordCount: wAvgWordCount / totalWeight,
				avgSentenceCount: 0, // Not tracked per-contact
				exclamationRate: wExclamationRate / totalWeight,
				questionRate: wQuestionRate / totalWeight,
				ellipsisRate: wEllipsisRate / totalWeight,
				allCapsRate: wAllCapsRate / totalWeight,
				emojiRate: wEmojiRate / totalWeight,
				emojiTopN: [] as Array<{ emoji: string; count: number }>,
				contractionRate: wContractionRate / totalWeight,
				slangRate: wSlangRate / totalWeight,
				greetingRate: wGreetingRate / totalWeight,
				signoffRate: wSignoffRate / totalWeight,
				questionAskRate: wQuestionAskRate / totalWeight,
				initiationRate: 0,
				avgUniqueWordRatio: wAvgUniqueWordRatio / totalWeight,
				fillerWordRate: wFillerWordRate / totalWeight,
				sampleSize: totalSamples,
			};

			// TODO: userId is needed for upsertVoiceProfile — for now, derive from workspace members
			// This aggregation runs per-workspace; in a multi-user workspace, each user
			// should have their own profile. For now, we use a workspace-level profile
			// by querying the first workspace member. The DAL verifies membership.
			const members = await db
				.select({ userId: workspaceMembers.userId })
				.from(workspaceMembers)
				.where(eq(workspaceMembers.workspaceId, workspaceId));

			// Preserve existing rich AI fields (pick most recent — don't merge qualitative text)
			const { voiceProfiles } = await import('@repo/db');
			const { desc } = await import('@repo/db');
			const existingRich = await db
				.select({
					richSummary: voiceProfiles.richSummary,
					richTone: voiceProfiles.richTone,
					richStructure: voiceProfiles.richStructure,
					codeSwitchingSummary: voiceProfiles.codeSwitchingSummary,
					configRecommendations: voiceProfiles.configRecommendations,
				})
				.from(voiceProfiles)
				.where(eq(voiceProfiles.workspaceId, workspaceId))
				.orderBy(desc(voiceProfiles.updatedAt))
				.limit(1);

			const richFields = existingRich[0] ?? {};

			for (const { userId } of members) {
				await upsertVoiceProfile(userId, workspaceId, {
					...baseProfile,
					...richFields,
				});
				profilesUpserted++;
			}

			// Recompute per-contact deviation signals
			for (const o of allOverrides) {
				const lengthMultiplier =
					baseProfile.avgMessageLength > 0
						? clamp(o.avgMessageLength / baseProfile.avgMessageLength, 0.1, 10)
						: 1;

				const contactInformal = o.contractionRate + o.slangRate;
				const baseInformal = baseProfile.contractionRate + baseProfile.slangRate;
				const formalityShift = clamp(contactInformal - baseInformal, -1, 1);

				const emojiMultiplier =
					baseProfile.emojiRate > 0 ? clamp(o.emojiRate / baseProfile.emojiRate, 0.1, 10) : 1;

				const dominantTone = inferDominantTone(o);

				await updateDeviationSignals(workspaceId, o.contactId, {
					lengthMultiplier,
					formalityShift,
					emojiMultiplier,
					dominantTone,
				});
				deviationsUpdated++;
			}
		}

		console.log(
			`[style-aggregation] Done: ${profilesUpserted} profiles upserted, ${deviationsUpdated} deviations updated`,
		);
	}),
	{ connection, prefix: '{ai-flow}', concurrency: 1 },
);

styleAggregationWorker.on('completed', (job) => {
	console.log(`[style-aggregation] Job ${job.id} completed`);
});
styleAggregationWorker.on('failed', (job, err) => {
	console.error(`[style-aggregation] Job ${job?.id} failed:`, err.message);
});

// ─── Scheduled interval (nightly) ────────────────────────────────────────────

let aggregationInterval: ReturnType<typeof setInterval> | null = null;

export function scheduleStyleAggregation(): void {
	styleAggregationQueue
		.add('nightly-aggregate', {})
		.catch((err) =>
			console.error('[style-aggregation] Failed to queue initial run:', (err as Error).message),
		);

	aggregationInterval = setInterval(
		async () => {
			try {
				await styleAggregationQueue.add('nightly-aggregate', {});
			} catch (err) {
				console.error('[style-aggregation] Failed to queue nightly run:', (err as Error).message);
			}
		},
		24 * 60 * 60 * 1000,
	);
}

export function stopStyleAggregation(): void {
	if (aggregationInterval) {
		clearInterval(aggregationInterval);
		aggregationInterval = null;
	}
}
