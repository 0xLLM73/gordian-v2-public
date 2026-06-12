import {
	type ContactMaskEntity,
	decrypt,
	deriveKeys,
	generatePersonPseudonym,
	maskContactAliases,
	type SealedEnvelope,
	unwrapWrk,
} from '@repo/crypto';
import type { ContactMaskingAlias } from '@repo/db';
import {
	createConnection,
	createIntroduction,
	createRelationship,
	getMemoriesByContact,
	getWorkspaceConnectionKeywords,
	getWorkspaceIntroKeywords,
	hasUserAiAnalysisConsent,
	listContactMaskingAliases,
	searchContactByName,
} from '@repo/db';
import { redactSensitive } from '@repo/shared';
import { type Job, Queue, Worker } from 'bullmq';
import { detectConnections, hasConnectionKeywords } from '../ai/connection-detection';
import {
	type DetectedIntroduction,
	detectIntroductions,
	hasIntroKeywords,
} from '../ai/introduction-detection';
import { extractRelationships } from '../ai/relationship-extraction';
import { withRLS } from '../middleware/rls';
import { connection } from '../redis';

/**
 * Relationship Extraction Queue (Phase 13).
 * Triggered after message sync — not scheduled (DragonflyDB doesn't support BullMQ repeat).
 * Fetches entity-masked memories for a contact, extracts relationships via AI,
 * and upserts them into contact_relationships.
 *
 * CRITICAL: Queue prefix MUST be '{ai-flow}' to share hashtag with other AI queues
 * (prevents CROSSSLOT errors on DragonflyDB).
 */

export interface RelationshipExtractionJobData {
	workspaceId: string;
	userId?: string;
	sourceAccountId?: string;
	contactId?: string;
	chatId?: string;
	chatType?: 'private' | 'group' | 'supergroup' | 'channel';
	messages?: Array<{
		role: string;
		content: string;
		timestamp: string;
		sourceMessageId?: string;
		chatId?: string;
		contactId?: string;
	}>;
	workspaceSalt?: string;
	/** Encrypted key envelope — NEVER plaintext keys in job payloads */
	keyEnvelope?: {
		encryptedWrk: string;
		kmsContext: Record<string, string>;
		wrkVersion: number;
	};
}

export const relationshipExtractionQueue = new Queue('relationship-extraction', {
	connection,
	prefix: '{ai-flow}',
	defaultJobOptions: {
		attempts: 2,
		backoff: { type: 'exponential', delay: 10000 },
		removeOnComplete: true,
		removeOnFail: { count: 50, age: 3600 },
	},
});

const RELATIONSHIP_STATUS_STATES = ['active', 'waiting', 'delayed', 'failed'] as const;
const DEFAULT_RELATIONSHIP_WORKER_LOCK_DURATION_MS = 10 * 60 * 1000;
const DEFAULT_RELATIONSHIP_WORKER_STALLED_INTERVAL_MS = 60 * 1000;
const DEFAULT_RELATIONSHIP_WORKER_MAX_STALLED_COUNT = 2;
const RESOLVED_FAILURE_REASON_PATTERNS = [
	'connection_keywords',
	'column "connection_keywords" does not exist',
] as const;

export type RelationshipExtractionDiagnostics = {
	targetType: 'contact' | 'chat' | 'unknown';
	messagesInBatch: number;
	freshSourceMessages: number;
	memoriesLoaded: number;
	hadSanitizedMemories: boolean;
	relationshipModelCalls: number;
	introductionKeywordMatched: boolean;
	introductionModelCalls: number;
	introductionRejectedLowConfidence: number;
	introductionRejectedUnresolvedContacts: number;
	introductionRejectedDuplicateContacts: number;
	introductionRejectedCreateError: number;
	introductionDetectionErrors: number;
	connectionKeywordMatched: boolean;
	connectionModelCalls: number;
	connectionRejectedLowConfidence: number;
	connectionRejectedCreateError: number;
	connectionDetectionErrors: number;
	completedAt?: string;
};

export type RelationshipExtractionQueueStatus = {
	active: number;
	waiting: number;
	delayed: number;
	retainedFailed: number;
	resolvedFailed: number;
	failed: number;
	total: number;
	introductionJobs: number;
	connectionJobs: number;
	unknownJobs: number;
	progressReports: number;
	diagnostics: {
		messagesInBatch: number;
		freshSourceMessages: number;
		relationshipModelCalls: number;
		introductionKeywordMatches: number;
		introductionModelCalls: number;
		introductionRejected: number;
		connectionKeywordMatches: number;
		connectionModelCalls: number;
		connectionRejected: number;
	};
	oldestJobAt: string | null;
	newestJobAt: string | null;
	sampledAt: string;
};

export type RelationshipExtractionFailureCleanupResult = {
	scanned: number;
	removed: number;
	retained: number;
	sampledAt: string;
};

export function relationshipExtractionConcurrency(env: NodeJS.ProcessEnv = process.env): number {
	const raw = env.RELATIONSHIP_EXTRACTION_CONCURRENCY;
	if (!raw) return 1;
	const parsed = Math.trunc(Number(raw));
	if (!Number.isFinite(parsed)) return 1;
	return Math.min(Math.max(parsed, 1), 4);
}

function positiveIntegerEnv(name: string, fallback: number): number {
	const parsed = Number(process.env[name]);
	return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

const RELATIONSHIP_EXTRACTION_WORKER_OPTS = {
	lockDuration: positiveIntegerEnv(
		'RELATIONSHIP_EXTRACTION_WORKER_LOCK_DURATION_MS',
		DEFAULT_RELATIONSHIP_WORKER_LOCK_DURATION_MS,
	),
	stalledInterval: positiveIntegerEnv(
		'RELATIONSHIP_EXTRACTION_WORKER_STALLED_INTERVAL_MS',
		DEFAULT_RELATIONSHIP_WORKER_STALLED_INTERVAL_MS,
	),
	maxStalledCount: positiveIntegerEnv(
		'RELATIONSHIP_EXTRACTION_WORKER_MAX_STALLED_COUNT',
		DEFAULT_RELATIONSHIP_WORKER_MAX_STALLED_COUNT,
	),
};

export function isResolvedRelationshipExtractionFailureReason(reason: unknown): boolean {
	if (typeof reason !== 'string') return false;
	const normalized = reason.toLowerCase();
	return RESOLVED_FAILURE_REASON_PATTERNS.some((pattern) =>
		normalized.includes(pattern.toLowerCase()),
	);
}

function matchesRelationshipJobScope(
	job: Job<RelationshipExtractionJobData>,
	input: { workspaceId: string; userId?: string },
): boolean {
	const data = job.data;
	if (data.workspaceId !== input.workspaceId) return false;
	if (input.userId && data.userId && data.userId !== input.userId) return false;
	return true;
}

function relationshipDiagnosticsFromProgress(
	progress: unknown,
): RelationshipExtractionDiagnostics | null {
	if (!progress || typeof progress !== 'object') return null;
	const record = progress as Partial<RelationshipExtractionDiagnostics>;
	if (
		typeof record.messagesInBatch !== 'number' ||
		typeof record.freshSourceMessages !== 'number'
	) {
		return null;
	}
	return {
		targetType:
			record.targetType === 'contact' || record.targetType === 'chat'
				? record.targetType
				: 'unknown',
		messagesInBatch: record.messagesInBatch,
		freshSourceMessages: record.freshSourceMessages,
		memoriesLoaded: Number(record.memoriesLoaded ?? 0),
		hadSanitizedMemories: Boolean(record.hadSanitizedMemories),
		relationshipModelCalls: Number(record.relationshipModelCalls ?? 0),
		introductionKeywordMatched: Boolean(record.introductionKeywordMatched),
		introductionModelCalls: Number(record.introductionModelCalls ?? 0),
		introductionRejectedLowConfidence: Number(record.introductionRejectedLowConfidence ?? 0),
		introductionRejectedUnresolvedContacts: Number(
			record.introductionRejectedUnresolvedContacts ?? 0,
		),
		introductionRejectedDuplicateContacts: Number(
			record.introductionRejectedDuplicateContacts ?? 0,
		),
		introductionRejectedCreateError: Number(record.introductionRejectedCreateError ?? 0),
		introductionDetectionErrors: Number(record.introductionDetectionErrors ?? 0),
		connectionKeywordMatched: Boolean(record.connectionKeywordMatched),
		connectionModelCalls: Number(record.connectionModelCalls ?? 0),
		connectionRejectedLowConfidence: Number(record.connectionRejectedLowConfidence ?? 0),
		connectionRejectedCreateError: Number(record.connectionRejectedCreateError ?? 0),
		connectionDetectionErrors: Number(record.connectionDetectionErrors ?? 0),
		completedAt: typeof record.completedAt === 'string' ? record.completedAt : undefined,
	};
}

function emptyRelationshipDiagnostics(
	data: RelationshipExtractionJobData,
): RelationshipExtractionDiagnostics {
	return {
		targetType: data.contactId ? 'contact' : data.chatId ? 'chat' : 'unknown',
		messagesInBatch: data.messages?.length ?? 0,
		freshSourceMessages: 0,
		memoriesLoaded: 0,
		hadSanitizedMemories: false,
		relationshipModelCalls: 0,
		introductionKeywordMatched: false,
		introductionModelCalls: 0,
		introductionRejectedLowConfidence: 0,
		introductionRejectedUnresolvedContacts: 0,
		introductionRejectedDuplicateContacts: 0,
		introductionRejectedCreateError: 0,
		introductionDetectionErrors: 0,
		connectionKeywordMatched: false,
		connectionModelCalls: 0,
		connectionRejectedLowConfidence: 0,
		connectionRejectedCreateError: 0,
		connectionDetectionErrors: 0,
	};
}

async function updateRelationshipDiagnostics(
	job: Job<RelationshipExtractionJobData>,
	diagnostics: RelationshipExtractionDiagnostics,
): Promise<void> {
	if (typeof job.updateProgress !== 'function') return;
	await job.updateProgress(diagnostics).catch((err) => {
		console.warn(
			'[relationship-extraction] Failed to update scan diagnostics:',
			redactSensitive(err),
		);
	});
}

export async function getRelationshipExtractionQueueStatus(input: {
	workspaceId: string;
	userId?: string;
	limit?: number;
}): Promise<RelationshipExtractionQueueStatus> {
	const limit = Math.min(Math.max(input.limit ?? 500, 1), 1000);
	const status: RelationshipExtractionQueueStatus = {
		active: 0,
		waiting: 0,
		delayed: 0,
		retainedFailed: 0,
		resolvedFailed: 0,
		failed: 0,
		total: 0,
		introductionJobs: 0,
		connectionJobs: 0,
		unknownJobs: 0,
		progressReports: 0,
		diagnostics: {
			messagesInBatch: 0,
			freshSourceMessages: 0,
			relationshipModelCalls: 0,
			introductionKeywordMatches: 0,
			introductionModelCalls: 0,
			introductionRejected: 0,
			connectionKeywordMatches: 0,
			connectionModelCalls: 0,
			connectionRejected: 0,
		},
		oldestJobAt: null,
		newestJobAt: null,
		sampledAt: new Date().toISOString(),
	};

	let oldestJobAt = Number.POSITIVE_INFINITY;
	let newestJobAt = 0;

	for (const state of RELATIONSHIP_STATUS_STATES) {
		const jobs = await relationshipExtractionQueue.getJobs([state], 0, limit - 1, true);
		for (const job of jobs) {
			if (!matchesRelationshipJobScope(job, input)) continue;
			const data = job.data;

			if (state === 'failed') {
				status.retainedFailed += 1;
				if (isResolvedRelationshipExtractionFailureReason(job.failedReason)) {
					status.resolvedFailed += 1;
				} else {
					status.failed += 1;
				}
			} else {
				status[state] += 1;
			}
			status.total += 1;
			if (state !== 'failed') {
				if (data.chatId) {
					status.introductionJobs += 1;
				} else if (data.contactId) {
					status.connectionJobs += 1;
				} else {
					status.unknownJobs += 1;
				}
			}
			const progress = relationshipDiagnosticsFromProgress(job.progress);
			if (state !== 'failed' && progress) {
				status.progressReports += 1;
				status.diagnostics.messagesInBatch += progress.messagesInBatch;
				status.diagnostics.freshSourceMessages += progress.freshSourceMessages;
				status.diagnostics.relationshipModelCalls += progress.relationshipModelCalls;
				status.diagnostics.introductionKeywordMatches += progress.introductionKeywordMatched
					? 1
					: 0;
				status.diagnostics.introductionModelCalls += progress.introductionModelCalls;
				status.diagnostics.introductionRejected +=
					progress.introductionRejectedLowConfidence +
					progress.introductionRejectedUnresolvedContacts +
					progress.introductionRejectedDuplicateContacts +
					progress.introductionRejectedCreateError;
				status.diagnostics.connectionKeywordMatches += progress.connectionKeywordMatched ? 1 : 0;
				status.diagnostics.connectionModelCalls += progress.connectionModelCalls;
				status.diagnostics.connectionRejected +=
					progress.connectionRejectedLowConfidence + progress.connectionRejectedCreateError;
			}

			if (job.timestamp) {
				oldestJobAt = Math.min(oldestJobAt, job.timestamp);
				newestJobAt = Math.max(newestJobAt, job.timestamp);
			}
		}
	}

	status.oldestJobAt = Number.isFinite(oldestJobAt) ? new Date(oldestJobAt).toISOString() : null;
	status.newestJobAt = newestJobAt > 0 ? new Date(newestJobAt).toISOString() : null;
	return status;
}

export async function cleanupResolvedRelationshipExtractionFailures(input: {
	workspaceId: string;
	userId?: string;
	limit?: number;
}): Promise<RelationshipExtractionFailureCleanupResult> {
	const limit = Math.min(Math.max(input.limit ?? 500, 1), 1000);
	const jobs = await relationshipExtractionQueue.getJobs(['failed'], 0, limit - 1, true);
	const result: RelationshipExtractionFailureCleanupResult = {
		scanned: 0,
		removed: 0,
		retained: 0,
		sampledAt: new Date().toISOString(),
	};

	for (const job of jobs) {
		if (!matchesRelationshipJobScope(job, input)) continue;
		result.scanned += 1;
		if (!isResolvedRelationshipExtractionFailureReason(job.failedReason)) {
			result.retained += 1;
			continue;
		}
		await job.remove();
		result.removed += 1;
	}

	return result;
}

type FreshBatchContext = {
	content: string;
	keywordContent: string;
	sourceMessageIds: string[];
	aliasToContactId: Map<string, string>;
};

function envelopeFromJob(data: RelationshipExtractionJobData): SealedEnvelope | null {
	if (!data.keyEnvelope) return null;
	return {
		encryptedWrk: Buffer.from(data.keyEnvelope.encryptedWrk, 'base64'),
		kmsContext: data.keyEnvelope.kmsContext,
		wrkVersion: data.keyEnvelope.wrkVersion,
	};
}

function short(value: string | undefined): string {
	return value ? value.slice(0, 8) : 'none';
}

function jobTargetLabel(data: RelationshipExtractionJobData): string {
	if (data.contactId) return `contact=${short(data.contactId)}`;
	if (data.chatId) return `chat=${short(data.chatId)}`;
	return 'batch=unknown';
}

function uniqueStrings(values: Array<string | undefined>): string[] {
	return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function normalizedName(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

const PERSON_STOP_WORDS = new Set([
	'Add',
	'Added',
	'Adding',
	'Also',
	'And',
	'Can',
	'Cc',
	'Connect',
	'Connected',
	'Connecting',
	'For',
	'Forwarded',
	'Forwarding',
	'General',
	'Hey',
	'I',
	'In',
	'Introduce',
	'Introduces',
	'Introducing',
	'Intro',
	'Let',
	'Loop',
	'Meet',
	'No',
	'Put',
	'Putting',
	'Reach',
	'The',
	'This',
	'Touch',
	'Yes',
]);

function shouldPreservePersonLikeToken(match: string, extraPhrases: string[]): boolean {
	const normalized = match.toLowerCase();
	if (extraPhrases.includes(normalized)) return true;
	return match.split(/\s+/).every((word) => PERSON_STOP_WORDS.has(word));
}

function maskUnresolvedPersonLikeTokens(text: string, extraPhrases: string[] = []): string {
	const replacements = new Map<string, string>();
	return text.replace(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g, (match) => {
		if (shouldPreservePersonLikeToken(match, extraPhrases)) return match;
		const replacement = replacements.get(match) ?? `PERSON_UNMAPPED_${replacements.size + 1}`;
		replacements.set(match, replacement);
		return replacement;
	});
}

function maskUnresolvedUsernames(text: string): string {
	const replacements = new Map<string, string>();
	return text.replace(/(?<![A-Za-z0-9_])@[A-Za-z][A-Za-z0-9_]{1,31}\b/g, (match) => {
		const replacement =
			replacements.get(match) ?? `PERSON_UNMAPPED_HANDLE_${replacements.size + 1}`;
		replacements.set(match, replacement);
		return replacement;
	});
}

function toContactMaskEntity(contact: ContactMaskingAlias): ContactMaskEntity {
	const firstName = normalizedName(contact.firstName);
	const lastName = normalizedName(contact.lastName);
	return {
		contactId: contact.id,
		firstName,
		lastName,
		fullName: firstName && lastName ? `${firstName} ${lastName}` : undefined,
		username: normalizedName(contact.username),
	};
}

async function buildFreshBatchContext(
	data: RelationshipExtractionJobData,
	workspaceId: string,
	envelope: SealedEnvelope | null,
	customIntroKeywords: string[],
): Promise<FreshBatchContext> {
	if (!data.messages?.length || !envelope || !data.workspaceSalt) {
		return { content: '', keywordContent: '', sourceMessageIds: [], aliasToContactId: new Map() };
	}

	const wrk = await unwrapWrk(envelope);
	const keys = await deriveKeys(wrk, workspaceId, envelope.wrkVersion);
	const salt = Buffer.from(data.workspaceSalt, 'hex');
	const customKeywordPhrases = customIntroKeywords.map((keyword) =>
		keyword.trim().toLowerCase().replace(/\s+/g, ' '),
	);
	const contacts = await listContactMaskingAliases(workspaceId, envelope, {
		limit: 5000,
		sourceAccountId: data.sourceAccountId,
		includeLegacy: Boolean(data.sourceAccountId),
	}).catch(() => []);
	const contactEntities = contacts.map(toContactMaskEntity);
	const aliasToContactId = new Map<string, string>();
	const sourceMessageIds: string[] = [];
	const lines: string[] = [];
	const keywordLines: string[] = [];

	for (const msg of data.messages) {
		if (!msg.sourceMessageId) continue;

		const plaintext = decrypt(msg.content, keys.dek).trim();
		if (!plaintext) continue;

		const { maskedText, aliasMap } = maskContactAliases(plaintext, salt, contactEntities, {
			maskFirstNames: true,
			maskLastNames: true,
		});
		for (const alias of aliasMap) {
			aliasToContactId.set(alias.pseudonym, alias.contactId);
		}
		const speakerAlias = msg.contactId ? generatePersonPseudonym(msg.contactId, salt) : undefined;
		if (speakerAlias && msg.contactId) {
			aliasToContactId.set(speakerAlias, msg.contactId);
		}
		const usernameMaskedText = maskUnresolvedUsernames(maskedText);
		const redactedText = maskUnresolvedPersonLikeTokens(usernameMaskedText, customKeywordPhrases);
		sourceMessageIds.push(msg.sourceMessageId);
		const speakerTag = speakerAlias ? ` [speaker:${speakerAlias}]` : '';
		lines.push(`[source:${msg.sourceMessageId}]${speakerTag} [${msg.role}] ${redactedText}`);
		keywordLines.push(
			`[source:${msg.sourceMessageId}]${speakerTag} [${msg.role}] ${usernameMaskedText}`,
		);
	}

	return {
		content: lines.join('\n'),
		keywordContent: keywordLines.join('\n'),
		sourceMessageIds: [...new Set(sourceMessageIds)],
		aliasToContactId,
	};
}

function selectIntroSourceMessageIds(
	intro: { source_message_ids?: string[] },
	freshSourceMessageIds: string[],
): string[] | undefined {
	if (freshSourceMessageIds.length === 0) return undefined;

	const allowed = new Set(freshSourceMessageIds);
	const requested = [...new Set(intro.source_message_ids ?? [])];
	const selected = requested.filter((id) => allowed.has(id));
	if (requested.length > 0) return selected.length > 0 ? selected : undefined;
	return undefined;
}

function selectConnectionSourceMessageIds(
	connection: { source_message_ids?: string[] },
	freshSourceMessageIds: string[],
): string[] | undefined {
	if (freshSourceMessageIds.length === 0) return undefined;

	const allowed = new Set(freshSourceMessageIds);
	const requested = [...new Set(connection.source_message_ids ?? [])];
	const selected = requested.filter((id) => allowed.has(id));
	if (requested.length > 0) return selected.length > 0 ? selected : undefined;
	return undefined;
}

function isPseudonymRef(value: string): boolean {
	return /^(?:CONTACT|PERSON|ORG|EMAIL|PHONE|MONEY|ADDRESS)_[A-Za-z0-9_]+$/.test(value);
}

function introParticipantRefs(
	intro: DetectedIntroduction,
	role: 'introducer' | 'introduced1' | 'introduced2',
): string[] {
	if (role === 'introducer') return uniqueStrings([intro.introducer_ref, intro.introducer_name]);
	if (role === 'introduced1')
		return uniqueStrings([intro.introduced_ref_1, intro.introduced_name_1]);
	return uniqueStrings([intro.introduced_ref_2, intro.introduced_name_2]);
}

async function resolveIntroContactId(
	workspaceId: string,
	intro: DetectedIntroduction,
	role: 'introducer' | 'introduced1' | 'introduced2',
	aliasToContactId: Map<string, string>,
	envelope: SealedEnvelope,
): Promise<string | undefined> {
	const refs = introParticipantRefs(intro, role);
	for (const ref of refs) {
		const contactId = aliasToContactId.get(ref);
		if (contactId) return contactId;
	}

	if (aliasToContactId.size > 0) return undefined;

	const legacyName = refs.find((ref) => !isPseudonymRef(ref));
	if (!legacyName) return undefined;

	const candidates = await searchContactByName(workspaceId, legacyName, envelope).catch(() => []);
	return candidates[0]?.id;
}

export const relationshipExtractionWorker = new Worker<RelationshipExtractionJobData>(
	'relationship-extraction',
	withRLS(async (job) => {
		const { workspaceId, contactId, userId } = job.data;
		const envelope = envelopeFromJob(job.data);
		const targetLabel = jobTargetLabel(job.data);
		const diagnostics = emptyRelationshipDiagnostics(job.data);
		await updateRelationshipDiagnostics(job, diagnostics);

		if (!userId && job.data.messages?.length) {
			console.warn(
				`[relationship-extraction] Missing userId on fresh encrypted batch for ${targetLabel}, skipping`,
			);
			diagnostics.completedAt = new Date().toISOString();
			await updateRelationshipDiagnostics(job, diagnostics);
			return { skipped: true, reason: 'missing_user_id', diagnostics };
		}
		if (userId && !(await hasUserAiAnalysisConsent(userId, workspaceId))) {
			console.log(
				`[relationship-extraction] AI consent no longer persisted for workspace=${workspaceId.slice(0, 8)} user=${userId.slice(0, 8)}, skipping`,
			);
			diagnostics.completedAt = new Date().toISOString();
			await updateRelationshipDiagnostics(job, diagnostics);
			return { skipped: true, reason: 'no_ai_consent', diagnostics };
		}

		console.log(
			`[relationship-extraction] Processing ${targetLabel} workspace=${workspaceId.slice(0, 8)}`,
		);
		let relationshipsFound = 0;
		let relationshipsStored = 0;
		let introductionsDetected = 0;
		let introductionsCreated = 0;
		let introductionsRejected = 0;
		let connectionsDetected = 0;
		let connectionsCreated = 0;
		let connectionsRejected = 0;

		// 1. Fetch entity-masked memories for this contact
		// Use contentSanitized — already ELM-masked, safe to pass to LLM
		const memories =
			envelope && contactId
				? await getMemoriesByContact(workspaceId, contactId, envelope, { limit: 20 })
				: [];
		diagnostics.memoriesLoaded = memories.length;

		const sanitizedContent = memories
			.map((m) => m.contentSanitized)
			.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
			.join('\n\n');
		diagnostics.hadSanitizedMemories = Boolean(sanitizedContent);
		const [customKeywords, customConnectionKeywords] = await Promise.all([
			getWorkspaceIntroKeywords(workspaceId),
			getWorkspaceConnectionKeywords(workspaceId),
		]);
		const freshBatch = await buildFreshBatchContext(
			job.data,
			workspaceId,
			envelope,
			customKeywords,
		);
		diagnostics.freshSourceMessages = freshBatch.sourceMessageIds.length;
		await updateRelationshipDiagnostics(job, diagnostics);

		// 2. Skip if no usable content
		if (!sanitizedContent && !freshBatch.content) {
			console.log(`[relationship-extraction] No sanitized content for ${targetLabel}, skipping`);
			diagnostics.completedAt = new Date().toISOString();
			await updateRelationshipDiagnostics(job, diagnostics);
			return { skipped: true, reason: 'no_content', diagnostics };
		}

		// 3. Extract relationships via AI
		diagnostics.relationshipModelCalls = sanitizedContent ? 1 : 0;
		const extracted = sanitizedContent ? await extractRelationships(sanitizedContent) : [];

		// 4. Resolve pseudonym names back to contact IDs via blind-index lookup
		// entity-masked names (e.g. PERSON_a1b2) won't match — we skip unresolvable names
		if (!envelope) {
			console.warn(`[relationship-extraction] No envelope for ${targetLabel}, skipping DB writes`);
			diagnostics.completedAt = new Date().toISOString();
			await updateRelationshipDiagnostics(job, diagnostics);
			return { skipped: true, reason: 'no_envelope', diagnostics };
		}

		relationshipsFound = extracted.length;
		if (extracted.length === 0) {
			console.log(`[relationship-extraction] No relationships found for ${targetLabel}`);
		} else {
			console.log(
				`[relationship-extraction] Found ${extracted.length} relationships for ${targetLabel}`,
			);

			for (const rel of extracted) {
				// Attempt to resolve source and target names to real contact IDs
				const [sourceCandidates, targetCandidates] = await Promise.all([
					searchContactByName(workspaceId, rel.source_name, envelope).catch(() => []),
					searchContactByName(workspaceId, rel.target_name, envelope).catch(() => []),
				]);

				const sourceContact = sourceCandidates[0];
				const targetContact = targetCandidates[0];

				if (!sourceContact || !targetContact) continue;
				if (sourceContact.id === targetContact.id) continue;

				try {
					await createRelationship(
						workspaceId,
						{
							sourceContactId: sourceContact.id,
							targetContactId: targetContact.id,
							relationshipType: rel.relationship_type as Parameters<
								typeof createRelationship
							>[1]['relationshipType'],
							strength: rel.strength_estimate,
							source: 'ai_extracted',
							evidence: { reasoning: rel.reasoning },
						},
						envelope,
					);
					relationshipsStored++;
				} catch (err) {
					console.error(
						'[relationship-extraction] Failed to upsert relationship:',
						redactSensitive(err),
					);
				}
			}

			console.log(
				`[relationship-extraction] Upserted ${relationshipsStored}/${extracted.length} relationships for ${targetLabel}`,
			);
		}

		// 5. Introduction detection — post-step (Phase 16)
		// Keyword pre-filter: merge workspace-level custom keywords with built-in defaults
		const introductionContent = freshBatch.content || sanitizedContent;
		const keywordContent = freshBatch.keywordContent || introductionContent;
		diagnostics.introductionKeywordMatched = hasIntroKeywords(keywordContent, customKeywords);
		await updateRelationshipDiagnostics(job, diagnostics);
		if (diagnostics.introductionKeywordMatched) {
			try {
				diagnostics.introductionModelCalls += 1;
				const intros = await detectIntroductions(introductionContent);
				introductionsDetected = intros.length;
				for (const intro of intros) {
					if (intro.confidence < 0.3) {
						introductionsRejected++;
						diagnostics.introductionRejectedLowConfidence++;
						continue;
					}

					const [introducerId, person1Id, person2Id] = await Promise.all([
						resolveIntroContactId(
							workspaceId,
							intro,
							'introducer',
							freshBatch.aliasToContactId,
							envelope,
						),
						resolveIntroContactId(
							workspaceId,
							intro,
							'introduced1',
							freshBatch.aliasToContactId,
							envelope,
						),
						resolveIntroContactId(
							workspaceId,
							intro,
							'introduced2',
							freshBatch.aliasToContactId,
							envelope,
						),
					]);

					if (!introducerId || !person1Id || !person2Id) {
						introductionsRejected++;
						diagnostics.introductionRejectedUnresolvedContacts++;
						continue;
					}
					if (new Set([introducerId, person1Id, person2Id]).size < 3) {
						introductionsRejected++;
						diagnostics.introductionRejectedDuplicateContacts++;
						continue;
					}

					try {
						const autoConfirm = intro.confidence > 0.9;
						const sourceMessageIds = selectIntroSourceMessageIds(
							intro,
							freshBatch.sourceMessageIds,
						);
						await createIntroduction(
							workspaceId,
							{
								introducerContactId: introducerId,
								introducedContactId1: person1Id,
								introducedContactId2: person2Id,
								context: intro.context,
								confidence: intro.confidence,
								reasoning: intro.reasoning,
								sourceMessageIds,
								status: autoConfirm ? 'active' : 'triage',
								autoConfirmed: autoConfirm,
							},
							envelope,
						);
						console.log(
							`[relationship-extraction] Detected introduction by ${introducerId.slice(0, 8)}`,
						);
						introductionsCreated++;
					} catch (err) {
						introductionsRejected++;
						diagnostics.introductionRejectedCreateError++;
						console.error(
							'[relationship-extraction] Failed to create introduction:',
							redactSensitive(err),
						);
					}
				}
				if (intros.length > 0) {
					console.log(
						`[relationship-extraction] Introduction summary for ${targetLabel}: detected=${introductionsDetected}, created=${introductionsCreated}, rejected=${introductionsRejected}`,
					);
				}
			} catch (err) {
				diagnostics.introductionDetectionErrors++;
				console.error(
					'[relationship-extraction] Introduction detection error:',
					redactSensitive(err),
				);
			}
		}

		// 6. New connection detection — post-step
		// Detects 2-person first-meeting signals (e.g., "great to meet you at ETHDenver")
		const connectionContent = freshBatch.content || sanitizedContent;
		const connectionKeywordContent = freshBatch.keywordContent || connectionContent;
		diagnostics.connectionKeywordMatched =
			Boolean(contactId) &&
			hasConnectionKeywords(connectionKeywordContent, customConnectionKeywords);
		await updateRelationshipDiagnostics(job, diagnostics);
		if (contactId && diagnostics.connectionKeywordMatched) {
			try {
				diagnostics.connectionModelCalls += 1;
				const detected = await detectConnections(connectionContent);
				connectionsDetected = detected.length;
				for (const conn of detected) {
					if (conn.confidence < 0.3) {
						connectionsRejected++;
						diagnostics.connectionRejectedLowConfidence++;
						continue;
					}

					// Try to resolve the masked name to a contact ID.
					// In DMs, entity masking makes this impossible — fall back to the job's contactId
					// since the conversation is between the user and this specific contact.
					let resolvedContactId = contactId;
					const candidates = await searchContactByName(
						workspaceId,
						conn.contact_name,
						envelope,
					).catch(() => []);
					if (candidates[0]) {
						resolvedContactId = candidates[0].id;
					}

					try {
						await createConnection(
							workspaceId,
							{
								contactId: resolvedContactId,
								event: conn.event,
								context: conn.context,
								confidence: conn.confidence,
								reasoning: conn.reasoning,
								sourceMessageIds: selectConnectionSourceMessageIds(
									conn,
									freshBatch.sourceMessageIds,
								),
							},
							envelope,
						);
						console.log(
							`[relationship-extraction] Detected new connection with ${resolvedContactId.slice(0, 8)}`,
						);
						connectionsCreated++;
					} catch (err) {
						connectionsRejected++;
						diagnostics.connectionRejectedCreateError++;
						console.error(
							'[relationship-extraction] Failed to create connection:',
							redactSensitive(err),
						);
					}
				}
			} catch (err) {
				diagnostics.connectionDetectionErrors++;
				console.error(
					'[relationship-extraction] Connection detection error:',
					redactSensitive(err),
				);
			}
		}

		diagnostics.completedAt = new Date().toISOString();
		await updateRelationshipDiagnostics(job, diagnostics);
		console.log(
			`[relationship-extraction] Scan diagnostics for ${targetLabel}: messages=${diagnostics.messagesInBatch}, sources=${diagnostics.freshSourceMessages}, introKeyword=${diagnostics.introductionKeywordMatched}, connectionKeyword=${diagnostics.connectionKeywordMatched}, introRejected=${introductionsRejected}, connectionRejected=${connectionsRejected}`,
		);

		return {
			relationshipsFound,
			relationshipsStored,
			introductionsDetected,
			introductionsCreated,
			introductionsRejected,
			connectionsDetected,
			connectionsCreated,
			connectionsRejected,
			diagnostics,
		};
	}),
	{
		connection,
		prefix: '{ai-flow}',
		concurrency: relationshipExtractionConcurrency(), // Low priority, not time-sensitive
		...RELATIONSHIP_EXTRACTION_WORKER_OPTS,
	},
);
