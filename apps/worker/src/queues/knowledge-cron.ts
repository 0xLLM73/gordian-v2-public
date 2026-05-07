import type { SealedEnvelope } from '@repo/crypto';
import { deriveKeys, unwrapWrk } from '@repo/crypto';
import {
	db,
	eq,
	getContactsNeedingExtraction,
	getMessagesByContact,
	isFeatureEnabled,
} from '@repo/db';

import { BatchRelationshipExtractor } from '../ai/batch-relationship';
import { keywordPreFilter } from '../ai/knowledge-extraction';
import { extractKnowledgeForContact } from '../ai/knowledge-extraction';

/** Max LLM calls per nightly run across all workspaces (controls batch spend). */
const DEFAULT_LLM_BUDGET = 50;

let cronInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Fetch the workspace encryption envelope from the database.
 */
async function getWorkspaceEnvelope(workspaceId: string): Promise<SealedEnvelope | null> {
	const { workspaces } = await import('@repo/db');
	const result = await db
		.select({
			encryptedWrk: workspaces.encryptedWrk,
			kmsContext: workspaces.kmsContext,
			wrkVersion: workspaces.wrkVersion,
		})
		.from(workspaces)
		.where(eq(workspaces.id, workspaceId))
		.limit(1);

	if (result.length === 0) return null;

	const ws = result[0];
	const rawCtx = ws.kmsContext;
	const kmsContext: Record<string, string> =
		typeof rawCtx === 'string' ? JSON.parse(rawCtx) : (rawCtx as Record<string, string>);
	return {
		encryptedWrk: Buffer.from(ws.encryptedWrk, 'base64'),
		kmsContext,
		wrkVersion: ws.wrkVersion,
	};
}

/**
 * Run knowledge extraction for a single workspace.
 * Embedding-first matching runs inline. LLM requests are collected into
 * the batch extractor for deferred Anthropic Batch API submission (50% cost savings).
 */
async function processWorkspace(
	workspaceId: string,
	llmBudget: number,
	batcher: BatchRelationshipExtractor,
): Promise<{ contactsProcessed: number; embeddingMatches: number; llmQueued: number }> {
	const enabled = await isFeatureEnabled('knowledge_extraction', workspaceId);
	if (!enabled) return { contactsProcessed: 0, embeddingMatches: 0, llmQueued: 0 };

	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) {
		console.warn(`[knowledge-cron] No envelope for workspace=${workspaceId.slice(0, 8)}`);
		return { contactsProcessed: 0, embeddingMatches: 0, llmQueued: 0 };
	}

	const wrk = await unwrapWrk(envelope);
	const keys = await deriveKeys(wrk, workspaceId, envelope.wrkVersion);
	const workspaceSalt = keys.bik;

	// Only process contacts with new messages since last extraction
	const contactIds = await getContactsNeedingExtraction(workspaceId, llmBudget);
	if (contactIds.length === 0) {
		console.log(`[knowledge-cron] No stale contacts for workspace=${workspaceId.slice(0, 8)}`);
		return { contactsProcessed: 0, embeddingMatches: 0, llmQueued: 0 };
	}

	console.log(
		`[knowledge-cron] Processing ${contactIds.length} contacts for workspace=${workspaceId.slice(0, 8)}`,
	);

	let totalEmbeddingMatches = 0;
	let llmQueued = 0;
	let llmBudgetRemaining = llmBudget;

	for (const contactId of contactIds) {
		try {
			// Fetch decrypted messages for this contact
			const msgs = await getMessagesByContact(workspaceId, contactId, envelope, {
				limit: 200,
			});
			if (msgs.length === 0) continue;

			const texts = msgs
				.filter((m): m is typeof m & { text: string } => Boolean(m.text))
				.map((m) => m.text);
			if (texts.length === 0) continue;

			// Embedding-first match runs inline (cheap, always on)
			const result = await extractKnowledgeForContact(texts, contactId, workspaceId, {
				skipLLM: true, // Always skip inline LLM — batch handles it
				workspaceSalt,
				envelope,
			});
			totalEmbeddingMatches += result.embeddingMatches;

			// Queue LLM extraction into batch (if budget allows and keyword filter passes)
			if (llmBudgetRemaining > 0 && keywordPreFilter(texts)) {
				batcher.addRequest(workspaceId, contactId, texts, workspaceSalt, envelope);
				llmQueued++;
				llmBudgetRemaining--;
			}
		} catch (err) {
			console.error(
				`[knowledge-cron] Error processing contact=${contactId.slice(0, 8)}:`,
				(err as Error).message,
			);
		}
	}

	// Schedule inference to generate links from newly extracted nodes
	if (totalEmbeddingMatches > 0) {
		try {
			const { scheduleKnowledgeInference } = await import('./knowledge-inference');
			await scheduleKnowledgeInference(workspaceId);
			console.log(`[knowledge-cron] Scheduled inference for workspace=${workspaceId.slice(0, 8)}`);
		} catch (err) {
			console.error('[knowledge-cron] Failed to schedule inference:', (err as Error).message);
		}
	}

	return {
		contactsProcessed: contactIds.length,
		embeddingMatches: totalEmbeddingMatches,
		llmQueued,
	};
}

/**
 * Nightly knowledge extraction job.
 * Phase 1: Embedding-first matching (inline, per contact)
 * Phase 2: LLM extraction via Anthropic Batch API (50% cost savings)
 * Fallback: Sync inferWithCache if batch fails
 */
async function runNightlyExtraction(): Promise<void> {
	const startTime = Date.now();
	console.log('[knowledge-cron] Starting nightly extraction...');

	const { workspaces } = await import('@repo/db');
	const allWorkspaces = await db.select({ id: workspaces.id }).from(workspaces);

	const batcher = new BatchRelationshipExtractor();
	let totalContacts = 0;
	let totalEmbedding = 0;
	let totalLlmQueued = 0;
	let llmBudget = DEFAULT_LLM_BUDGET;

	// Phase 1: Embedding-first matching + collect LLM requests into batch
	for (const ws of allWorkspaces) {
		if (llmBudget <= 0) {
			console.log('[knowledge-cron] LLM budget exhausted, remaining workspaces embedding-only');
		}

		const result = await processWorkspace(ws.id, llmBudget, batcher);
		totalContacts += result.contactsProcessed;
		totalEmbedding += result.embeddingMatches;
		totalLlmQueued += result.llmQueued;
		llmBudget -= result.llmQueued;
	}

	// Phase 2: Submit batch and process results (or fall back to sync)
	let batchLinked = 0;
	let batchUsed = false;
	if (batcher.size > 0) {
		console.log(`[knowledge-cron] Submitting ${batcher.size} LLM requests via Batch API`);
		const batchResult = await batcher.submitAndProcess();
		batchLinked = batchResult.totalLinked;
		batchUsed = batchResult.batchUsed;

		// Schedule inference for any workspaces that got new LLM-extracted nodes
		if (batchLinked > 0) {
			for (const ws of allWorkspaces) {
				try {
					const { scheduleKnowledgeInference } = await import('./knowledge-inference');
					await scheduleKnowledgeInference(ws.id);
				} catch {
					// Best-effort inference scheduling
				}
			}
		}
	}

	const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
	const mode = batchUsed ? 'batch' : 'sync-fallback';
	console.log(
		`[knowledge-cron] Complete: ${totalContacts} contacts, ${totalEmbedding} embedding matches, ` +
			`${totalLlmQueued} LLM requests (${mode}), ${batchLinked} entities linked, ${elapsed}s`,
	);
}

/**
 * Schedule the nightly knowledge extraction cron.
 * Runs every 24 hours. Does NOT run immediately on startup
 * (unlike health scoring) to avoid burning LLM credits on deploy.
 */
export function scheduleKnowledgeCron(): void {
	console.log('[knowledge-cron] Scheduled nightly extraction (every 24h)');
	cronInterval = setInterval(
		async () => {
			try {
				await runNightlyExtraction();
			} catch (err) {
				console.error('[knowledge-cron] Failed:', (err as Error).message);
			}
		},
		24 * 60 * 60 * 1000,
	);
}

/** Stop the cron interval for graceful shutdown. */
export function stopKnowledgeCron(): void {
	if (cronInterval) {
		clearInterval(cronInterval);
		cronInterval = null;
	}
}

/**
 * Manually trigger the nightly extraction (for admin endpoint).
 */
export { runNightlyExtraction };
