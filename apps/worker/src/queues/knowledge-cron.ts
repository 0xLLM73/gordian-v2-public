import type { SealedEnvelope } from '@repo/crypto';
import { deriveKeys, unwrapWrk } from '@repo/crypto';
import {
	and,
	db,
	eq,
	getContactsNeedingExtraction,
	getKnowledgeAnalysisContactCandidates,
	getKnowledgeNode,
	getMessagesByContact,
	hasWorkspaceAiAnalysisConsent,
	isFeatureEnabled,
	knowledgeEvidence,
	linkContactToKnowledge,
	sql,
} from '@repo/db';
import {
	type KnowledgeEmbeddingMode,
	type KnowledgeLlmMode,
	getKnowledgeEmbeddingRuntime,
	getKnowledgeLlmRuntime,
	isKnowledgeLlmEnabled,
} from '@repo/shared';

import { BatchRelationshipExtractor } from '../ai/batch-relationship';
import { keywordPreFilter } from '../ai/knowledge-extraction';
import { extractKnowledgeForContact } from '../ai/knowledge-extraction';

/** Max LLM calls per nightly run across all workspaces (controls batch spend). */
const DEFAULT_LLM_BUDGET = 50;
const DEFAULT_CONTACT_LIMIT = 50;
const MANUAL_TOPIC_SCAN_PAGE_SIZE = 500;
const MANUAL_TOPIC_MAX_EVIDENCE_PER_CONTACT = 3;
const MANUAL_TOPIC_DEFAULT_MAX_EVIDENCE = 200;

const MANUAL_TOPIC_STOPWORDS = new Set([
	'about',
	'after',
	'agent',
	'agents',
	'and',
	'around',
	'context',
	'discussion',
	'discussions',
	'evaluation',
	'evaluating',
	'for',
	'from',
	'local',
	'model',
	'models',
	'topic',
	'with',
]);

export type KnowledgeAnalysisMode = 'incremental' | 'evidence' | 'full';

export interface KnowledgeAnalysisEstimate {
	workspaceId: string;
	mode: KnowledgeAnalysisMode;
	enabled: boolean;
	hasConsent: boolean;
	canRun: boolean;
	contactsEstimated: number;
	staleContactsEstimated: number;
	messagesEstimated: number;
	embeddingRequestsEstimated: number;
	embeddingInputsEstimated: number;
	embeddingProviderMode: KnowledgeEmbeddingMode;
	embeddingProviderLabel: string;
	llmRequestsEstimated: number;
	llmProviderMode: KnowledgeLlmMode;
	llmProviderLabel: string;
	limit: number;
}

export interface KnowledgeAnalysisResult {
	mode: KnowledgeAnalysisMode;
	workspaceId?: string;
	workspacesScanned: number;
	contactsProcessed: number;
	embeddingMatches: number;
	embeddingProviderMode: KnowledgeEmbeddingMode;
	embeddingProviderLabel: string;
	llmQueued: number;
	batchLinked: number;
	batchUsed: boolean;
	llmProviderMode: KnowledgeLlmMode;
	llmProviderLabel: string;
	elapsedMs: number;
	skippedWorkspaces: Array<{ workspaceId: string; reason: string }>;
}

export interface ManualKnowledgeEvidenceBuildResult {
	workspaceId: string;
	nodeId: string;
	contactsScanned: number;
	messagesScanned: number;
	evidenceCreated: number;
	contactsLinked: number;
	totalEvidenceRows: number;
	totalEvidenceContacts: number;
	totalEvidenceMessages: number;
	elapsedMs: number;
	skippedReason?: string;
}

type KnowledgeAnalysisContactCandidate = {
	id: string;
	messageCount: number;
	stale: boolean;
};

function normalizeManualTopicText(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9@#.+-]+/g, ' ')
		.trim()
		.replace(/\s+/g, ' ');
}

function manualTopicNeedles(
	name: string,
	description?: string | null,
): {
	phrases: string[];
	tokens: string[];
} {
	const normalizedName = normalizeManualTopicText(name);
	const normalizedDescription = description ? normalizeManualTopicText(description) : '';
	const phrases = [...new Set([normalizedName].filter((value) => value.length >= 4))];
	const strongTokens = (value: string) =>
		value
			.split(' ')
			.map((token) => token.trim())
			.filter((token) => token.length >= 3 && !MANUAL_TOPIC_STOPWORDS.has(token));
	const nameTokens = strongTokens(normalizedName);
	const descriptionTokens = strongTokens(normalizedDescription);
	const tokens = [...new Set(nameTokens.length > 0 ? nameTokens : descriptionTokens)].slice(0, 8);

	return { phrases, tokens };
}

function manualTopicMatch(
	text: string,
	needles: { phrases: string[]; tokens: string[] },
): { confidence: number; matchType: 'phrase' | 'token'; matchedTokenCount: number } | null {
	const normalized = normalizeManualTopicText(text);
	if (!normalized) return null;

	for (const phrase of needles.phrases) {
		if (normalized.includes(phrase)) {
			return { confidence: 0.95, matchType: 'phrase', matchedTokenCount: phrase.split(' ').length };
		}
	}

	const matchedTokenCount = needles.tokens.filter((token) => normalized.includes(token)).length;
	if (matchedTokenCount === 0) return null;

	return {
		confidence: Math.min(0.9, 0.76 + matchedTokenCount * 0.04),
		matchType: 'token',
		matchedTokenCount,
	};
}

async function getManualKnowledgeEvidenceTotals(
	workspaceId: string,
	nodeId: string,
): Promise<{
	totalEvidenceRows: number;
	totalEvidenceContacts: number;
	totalEvidenceMessages: number;
}> {
	const result = await db.execute(sql`
		SELECT
			COUNT(*)::int AS total_evidence_rows,
			COUNT(DISTINCT contact_id) FILTER (WHERE contact_id IS NOT NULL)::int AS total_evidence_contacts,
			COUNT(DISTINCT message_id) FILTER (WHERE message_id IS NOT NULL)::int AS total_evidence_messages
		FROM knowledge_evidence
		WHERE workspace_id = ${workspaceId}::uuid
			AND knowledge_node_id = ${nodeId}::uuid
	`);
	const row = (
		result as unknown as Array<{
			total_evidence_rows?: number | string | null;
			total_evidence_contacts?: number | string | null;
			total_evidence_messages?: number | string | null;
		}>
	)[0];
	return {
		totalEvidenceRows: Number(row?.total_evidence_rows ?? 0),
		totalEvidenceContacts: Number(row?.total_evidence_contacts ?? 0),
		totalEvidenceMessages: Number(row?.total_evidence_messages ?? 0),
	};
}

let cronInterval: ReturnType<typeof setInterval> | null = null;

async function isKnowledgeExtractionEnabled(workspaceId: string): Promise<boolean> {
	if (process.env.KNOWLEDGE_EXTRACTION_ENABLED === 'true') return true;
	return isFeatureEnabled('knowledge_extraction', workspaceId);
}

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
 * the batch extractor for deferred cloud batch submission, unless local KG LLM
 * mode is enabled.
 */
async function processWorkspace(
	workspaceId: string,
	llmBudget: number,
	batcher: BatchRelationshipExtractor,
	options: { mode?: KnowledgeAnalysisMode; limit?: number } = {},
): Promise<{
	contactsProcessed: number;
	embeddingMatches: number;
	llmQueued: number;
	skippedReason?: string;
}> {
	const enabled = await isKnowledgeExtractionEnabled(workspaceId);
	const llmEnabled = isKnowledgeLlmEnabled(process.env);
	if (!enabled) {
		return {
			contactsProcessed: 0,
			embeddingMatches: 0,
			llmQueued: 0,
			skippedReason: 'feature_disabled',
		};
	}

	const hasConsent = await hasWorkspaceAiAnalysisConsent(workspaceId);
	if (!hasConsent) {
		return {
			contactsProcessed: 0,
			embeddingMatches: 0,
			llmQueued: 0,
			skippedReason: 'ai_consent_missing',
		};
	}

	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) {
		console.warn(`[knowledge-cron] No envelope for workspace=${workspaceId.slice(0, 8)}`);
		return {
			contactsProcessed: 0,
			embeddingMatches: 0,
			llmQueued: 0,
			skippedReason: 'workspace_envelope_missing',
		};
	}

	const wrk = await unwrapWrk(envelope);
	const keys = await deriveKeys(wrk, workspaceId, envelope.wrkVersion);
	const workspaceSalt = keys.bik;

	const mode = options.mode ?? 'incremental';
	const contactLimit = options.limit ?? Math.max(llmBudget, DEFAULT_CONTACT_LIMIT);
	const contactIds =
		mode === 'full' || mode === 'evidence'
			? (
					await getKnowledgeAnalysisContactCandidates(workspaceId, {
						includeFresh: true,
						limit: contactLimit,
					})
				).map((contact) => contact.id)
			: await getContactsNeedingExtraction(workspaceId, contactLimit);
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

			const messageInputs = msgs
				.filter((m): m is typeof m & { text: string } => Boolean(m.text))
				.map((m) => ({ id: m.id, text: m.text, timestamp: m.sentAt }));
			if (messageInputs.length === 0) continue;
			const texts = messageInputs.map((m) => m.text);

			// Embedding-first match runs inline (cheap, always on)
			const result = await extractKnowledgeForContact(messageInputs, contactId, workspaceId, {
				skipLLM: true, // Always skip inline LLM — batch handles it
				workspaceSalt,
				envelope,
			});
			totalEmbeddingMatches += result.embeddingMatches;

			// Queue LLM extraction into batch (if budget allows and keyword filter passes)
			if (llmEnabled && mode !== 'evidence' && llmBudgetRemaining > 0 && keywordPreFilter(texts)) {
				batcher.addRequest(workspaceId, contactId, messageInputs, workspaceSalt, envelope);
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

async function estimateKeywordFilteredLlmRequests(
	workspaceId: string,
	contacts: KnowledgeAnalysisContactCandidate[],
	llmBudget: number,
): Promise<number> {
	if (contacts.length === 0 || llmBudget <= 0) return 0;

	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) {
		return Math.min(contacts.length, llmBudget);
	}

	let llmRequests = 0;
	for (const contact of contacts) {
		if (llmRequests >= llmBudget) break;
		try {
			const msgs = await getMessagesByContact(workspaceId, contact.id, envelope, {
				limit: 200,
			});
			const texts = msgs
				.filter((m): m is typeof m & { text: string } => Boolean(m.text))
				.map((m) => m.text);
			if (texts.length > 0 && keywordPreFilter(texts)) {
				llmRequests++;
			}
		} catch (err) {
			console.error(
				`[knowledge-cron] Estimate keyword filter failed for contact=${contact.id.slice(0, 8)}:`,
				(err as Error).message,
			);
			llmRequests++;
		}
	}

	return llmRequests;
}

/** Estimate the amount of work a manual knowledge analysis run would perform. */
export async function estimateKnowledgeAnalysis(
	workspaceId: string,
	options: { mode?: KnowledgeAnalysisMode; limit?: number; llmBudget?: number } = {},
): Promise<KnowledgeAnalysisEstimate> {
	const mode = options.mode ?? 'incremental';
	const limit = options.limit ?? DEFAULT_CONTACT_LIMIT;
	const enabled = await isKnowledgeExtractionEnabled(workspaceId);
	const hasConsent = await hasWorkspaceAiAnalysisConsent(workspaceId);
	const candidates = await getKnowledgeAnalysisContactCandidates(workspaceId, {
		includeFresh: mode === 'full' || mode === 'evidence',
		limit,
	});
	const eligibleContacts =
		mode === 'full' || mode === 'evidence'
			? candidates
			: candidates.filter((contact) => contact.stale);
	const messagesEstimated = eligibleContacts.reduce(
		(sum, contact) => sum + contact.messageCount,
		0,
	);
	const embeddingInputsEstimated = eligibleContacts.reduce(
		(sum, contact) => sum + Math.min(contact.messageCount, 10),
		0,
	);
	const llmBudget = options.llmBudget ?? DEFAULT_LLM_BUDGET;
	const embeddingRuntime = getKnowledgeEmbeddingRuntime(process.env);
	const llmRuntime = getKnowledgeLlmRuntime(process.env);
	const llmRequestsEstimated =
		mode === 'evidence' || llmRuntime.mode === 'disabled'
			? 0
			: await estimateKeywordFilteredLlmRequests(workspaceId, eligibleContacts, llmBudget);

	return {
		workspaceId,
		mode,
		enabled,
		hasConsent,
		canRun: enabled && hasConsent && eligibleContacts.length > 0,
		contactsEstimated: eligibleContacts.length,
		staleContactsEstimated: eligibleContacts.filter((contact) => contact.stale).length,
		messagesEstimated,
		embeddingRequestsEstimated: eligibleContacts.length,
		embeddingInputsEstimated,
		embeddingProviderMode: embeddingRuntime.mode,
		embeddingProviderLabel: embeddingRuntime.label,
		llmRequestsEstimated,
		llmProviderMode: llmRuntime.mode,
		llmProviderLabel: llmRuntime.label,
		limit,
	};
}

/**
 * Build message-backed evidence for a user-created knowledge node.
 * This intentionally runs locally over decrypted Telegram messages and uses
 * lexical topic matches so it does not require vendor AI or message egress.
 */
export async function runManualKnowledgeEvidenceBuild(options: {
	workspaceId: string;
	nodeId: string;
	limit?: number;
	maxEvidence?: number;
}): Promise<ManualKnowledgeEvidenceBuildResult> {
	const startTime = Date.now();
	const limit = options.limit ?? 500;
	const maxEvidence = options.maxEvidence ?? MANUAL_TOPIC_DEFAULT_MAX_EVIDENCE;
	const baseResult = {
		workspaceId: options.workspaceId,
		nodeId: options.nodeId,
		contactsScanned: 0,
		messagesScanned: 0,
		evidenceCreated: 0,
		contactsLinked: 0,
		totalEvidenceRows: 0,
		totalEvidenceContacts: 0,
		totalEvidenceMessages: 0,
		elapsedMs: 0,
	};

	const enabled = await isKnowledgeExtractionEnabled(options.workspaceId);
	if (!enabled) {
		return {
			...baseResult,
			elapsedMs: Date.now() - startTime,
			skippedReason: 'feature_disabled',
		};
	}

	const hasConsent = await hasWorkspaceAiAnalysisConsent(options.workspaceId);
	if (!hasConsent) {
		return {
			...baseResult,
			elapsedMs: Date.now() - startTime,
			skippedReason: 'ai_consent_missing',
		};
	}

	const envelope = await getWorkspaceEnvelope(options.workspaceId);
	if (!envelope) {
		return {
			...baseResult,
			elapsedMs: Date.now() - startTime,
			skippedReason: 'workspace_envelope_missing',
		};
	}

	const node = await getKnowledgeNode(options.workspaceId, options.nodeId, envelope);
	if (!node) {
		return {
			...baseResult,
			elapsedMs: Date.now() - startTime,
			skippedReason: 'node_not_found',
		};
	}

	const needles = manualTopicNeedles(node.displayName ?? node.name, node.description);
	if (needles.phrases.length === 0 && needles.tokens.length === 0) {
		return {
			...baseResult,
			elapsedMs: Date.now() - startTime,
			skippedReason: 'empty_topic',
		};
	}

	const existingEvidence = await db
		.select({ messageId: knowledgeEvidence.messageId, contactId: knowledgeEvidence.contactId })
		.from(knowledgeEvidence)
		.where(
			and(
				eq(knowledgeEvidence.workspaceId, options.workspaceId),
				eq(knowledgeEvidence.knowledgeNodeId, options.nodeId),
			),
		);
	const seenMessageIds = new Set(
		existingEvidence
			.map((row) => row.messageId)
			.filter((messageId): messageId is string => Boolean(messageId)),
	);
	const existingEvidenceByContact = new Map<string, number>();
	for (const row of existingEvidence) {
		if (!row.contactId) continue;
		existingEvidenceByContact.set(
			row.contactId,
			(existingEvidenceByContact.get(row.contactId) ?? 0) + 1,
		);
	}
	const linkedContacts = new Set<string>();
	const contacts = await getKnowledgeAnalysisContactCandidates(options.workspaceId, {
		includeFresh: true,
		limit,
	});

	let messagesScanned = 0;
	let evidenceCreated = 0;
	for (const contact of contacts) {
		if (evidenceCreated >= maxEvidence) break;
		let contactEvidence = existingEvidenceByContact.get(contact.id) ?? 0;
		if (contactEvidence >= MANUAL_TOPIC_MAX_EVIDENCE_PER_CONTACT) continue;
		let offset = 0;
		let contactWasScanned = false;

		while (
			evidenceCreated < maxEvidence &&
			contactEvidence < MANUAL_TOPIC_MAX_EVIDENCE_PER_CONTACT
		) {
			const messages = await getMessagesByContact(options.workspaceId, contact.id, envelope, {
				limit: MANUAL_TOPIC_SCAN_PAGE_SIZE,
				offset,
			});
			if (messages.length === 0) break;

			contactWasScanned = true;
			messagesScanned += messages.length;
			for (const message of messages) {
				if (evidenceCreated >= maxEvidence) break;
				if (contactEvidence >= MANUAL_TOPIC_MAX_EVIDENCE_PER_CONTACT) break;
				if (!message.text || seenMessageIds.has(message.id)) continue;

				const match = manualTopicMatch(message.text, needles);
				if (!match) continue;

				await linkContactToKnowledge(
					options.workspaceId,
					options.nodeId,
					contact.id,
					'knows_about',
					match.confidence,
					{
						messageId: message.id,
						snippet: message.text.slice(0, 1000),
						occurredAt: message.sentAt,
						evidenceKind: 'manual',
						confidence: match.confidence,
						metadata: {
							source: 'manual_topic_message_scan',
							matchType: match.matchType,
							matchedTokenCount: match.matchedTokenCount,
							scanVersion: 1,
						},
						envelope,
					},
				);
				seenMessageIds.add(message.id);
				linkedContacts.add(contact.id);
				contactEvidence++;
				evidenceCreated++;
			}

			if (messages.length < MANUAL_TOPIC_SCAN_PAGE_SIZE) break;
			offset += MANUAL_TOPIC_SCAN_PAGE_SIZE;
		}

		if (contactWasScanned) {
			baseResult.contactsScanned++;
		}
	}

	const totals = await getManualKnowledgeEvidenceTotals(options.workspaceId, options.nodeId);
	console.log(
		`[knowledge-manual] Complete: node=${options.nodeId.slice(0, 8)}, ` +
			`${baseResult.contactsScanned} contacts, ${messagesScanned} messages, ` +
			`${evidenceCreated} new evidence rows, ${totals.totalEvidenceRows} total evidence rows, ` +
			`${linkedContacts.size} contacts linked, ` +
			`${((Date.now() - startTime) / 1000).toFixed(1)}s`,
	);

	return {
		...baseResult,
		messagesScanned,
		evidenceCreated,
		contactsLinked: linkedContacts.size,
		...totals,
		elapsedMs: Date.now() - startTime,
	};
}

/**
 * Knowledge extraction job.
 * Phase 1: Embedding-first matching (inline, per contact)
 * Phase 2: LLM extraction via cloud batch or sync local KG LLM
 * Fallback: Sync inferWithCache if cloud batch fails
 */
export async function runKnowledgeAnalysis(
	options: {
		workspaceId?: string;
		mode?: KnowledgeAnalysisMode;
		limit?: number;
		llmBudget?: number;
	} = {},
): Promise<KnowledgeAnalysisResult> {
	const startTime = Date.now();
	const mode = options.mode ?? 'incremental';
	console.log(`[knowledge-cron] Starting ${mode} knowledge analysis...`);

	const { workspaces } = await import('@repo/db');
	const allWorkspaces = options.workspaceId
		? [{ id: options.workspaceId }]
		: await db.select({ id: workspaces.id }).from(workspaces);

	const batcher = new BatchRelationshipExtractor();
	let totalContacts = 0;
	let totalEmbedding = 0;
	let totalLlmQueued = 0;
	let llmBudget = mode === 'evidence' ? 0 : (options.llmBudget ?? DEFAULT_LLM_BUDGET);
	const embeddingRuntime = getKnowledgeEmbeddingRuntime(process.env);
	const llmRuntime = getKnowledgeLlmRuntime(process.env);
	const skippedWorkspaces: KnowledgeAnalysisResult['skippedWorkspaces'] = [];

	// Phase 1: Embedding-first matching + collect LLM requests into batch
	for (const ws of allWorkspaces) {
		if (llmBudget <= 0) {
			console.log('[knowledge-cron] LLM budget exhausted, remaining workspaces embedding-only');
		}

		const result = await processWorkspace(ws.id, llmBudget, batcher, {
			mode,
			limit: options.limit,
		});
		if (result.skippedReason) {
			skippedWorkspaces.push({ workspaceId: ws.id, reason: result.skippedReason });
		}
		totalContacts += result.contactsProcessed;
		totalEmbedding += result.embeddingMatches;
		totalLlmQueued += result.llmQueued;
		llmBudget -= result.llmQueued;
	}

	// Phase 2: Submit batch and process results (or fall back to sync)
	let batchLinked = 0;
	let batchUsed = false;
	if (batcher.size > 0) {
		console.log(`[knowledge-cron] Processing ${batcher.size} LLM requests via ${llmRuntime.label}`);
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
	const llmMode =
		totalLlmQueued === 0
			? 'none'
			: batchUsed
				? 'batch'
				: llmRuntime.mode === 'local'
					? 'local'
					: 'sync';
	console.log(
		`[knowledge-cron] Complete: ${totalContacts} contacts, ${totalEmbedding} embedding matches, ` +
			`${totalLlmQueued} LLM requests (${llmMode}), ${batchLinked} entities linked, ${elapsed}s`,
	);

	return {
		mode,
		workspaceId: options.workspaceId,
		workspacesScanned: allWorkspaces.length,
		contactsProcessed: totalContacts,
		embeddingMatches: totalEmbedding,
		embeddingProviderMode: embeddingRuntime.mode,
		embeddingProviderLabel: embeddingRuntime.label,
		llmQueued: totalLlmQueued,
		batchLinked,
		batchUsed,
		llmProviderMode: llmRuntime.mode,
		llmProviderLabel: llmRuntime.label,
		elapsedMs: Date.now() - startTime,
		skippedWorkspaces,
	};
}

async function runNightlyExtraction(): Promise<void> {
	await runKnowledgeAnalysis({ mode: 'incremental' });
}

/**
 * Schedule the nightly knowledge extraction cron.
 * Runs every 24 hours. Does NOT run immediately on startup
 * (unlike health scoring) to avoid burning LLM credits on deploy.
 */
export function scheduleKnowledgeCron(): void {
	if (process.env.KNOWLEDGE_AUTO_ANALYSIS_ENABLED !== 'true') {
		console.log('[knowledge-cron] Automatic knowledge analysis disabled');
		return;
	}

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
