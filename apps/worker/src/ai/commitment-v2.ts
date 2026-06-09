import { createHmac } from 'node:crypto';
import type { ExtractedCommitment } from './commitment-extraction';

export const COMMITMENT_V2_DETECTOR_VERSION = 'commitment-v2-detector-1';
export const COMMITMENT_V2_PROMPT_VERSION = 'commitment-v2-shadow-1';
export const COMMITMENT_V2_VALIDATOR_VERSION = 'commitment-v2-validator-1';

type TranscriptMessage = {
	id?: string;
	sourceMessageId?: string;
	role: string;
	content: string;
	timestamp: string;
};

export type CommitmentV2Route = 'active' | 'draft' | 'candidate_follow_up' | 'reject';

export type CommitmentV2SignalType =
	| 'commitment_candidate'
	| 'follow_up_candidate'
	| 'meeting_intent_candidate'
	| 'non_actionable'
	| 'rejected';

export interface CommitmentV2Candidate {
	anchorSourceId: string;
	windowSourceIds: string[];
	positiveReasonCodes: string[];
	negativeReasonCodes: string[];
	candidateScore: number;
	contentFingerprintHmac?: string;
	detectorVersion: string;
}

export interface CommitmentV2ValidatedItem {
	temporaryId: string;
	route: CommitmentV2Route;
	signalType: CommitmentV2SignalType;
	confidence: number;
	failureCodes: string[];
	warningCodes: string[];
	sourceMessageIds: string[];
	primarySourceMessageId?: string;
	evidenceLevel?: ExtractedCommitment['evidence_level'];
}

export interface CommitmentV2ShadowReport {
	detectorVersion: string;
	promptVersion: string;
	validatorVersion: string;
	sourceAccountId?: string;
	candidateCount: number;
	extractedCount: number;
	routeCounts: Record<CommitmentV2Route, number>;
	failureCodeCounts: Record<string, number>;
	warningCodeCounts: Record<string, number>;
	candidates: CommitmentV2Candidate[];
	validatedItems: CommitmentV2ValidatedItem[];
	privacySafeEvent: {
		event: 'commitment_v2_shadow_completed';
		source_account_present: boolean;
		candidate_count: number;
		extracted_count: number;
		route_counts: Record<CommitmentV2Route, number>;
		failure_code_counts: Record<string, number>;
		warning_code_counts: Record<string, number>;
		detector_version: string;
		prompt_version: string;
		validator_version: string;
	};
}

const SOURCE_ID_PREFIX = 'm';
const WINDOW_LOOKBACK = 6;
const WINDOW_LOOKAHEAD = 3;
const MIN_CANDIDATE_SCORE = 0.35;

const FIRST_PERSON_PROMISE_RE =
	/\b(?:i\s*(?:will|'ll|am going to|can|should|need to)|let me|i'?m on it|on it|will do)\b/i;
const REQUEST_RE =
	/\b(?:can you|could you|would you|please|pls|need you to|remind me|ping me|send me|review this|book|schedule)\b/i;
const ACCEPTANCE_RE = /\b(?:sure|ok|okay|yes|yep|yeah|works|sounds good|will do|on it)\b/i;
const DATE_RE =
	/\b(?:today|tomorrow|tonight|eod|eow|next week|by\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(?::\d{2})?\s*(?:am|pm)?)|in\s+\d+\s+(?:hour|hours|day|days|week|weeks))\b/i;
const ACTION_VERB_RE =
	/\b(?:send|review|pay|wire|refund|deposit|settle|bring|call|book|schedule|follow up|circle back|ask|intro|introduce|share|draft|finish|complete|prepare|look into|get back)\b/i;
const MEETING_RE = /\b(?:meet|meeting|call|schedule|book|calendar|zoom)\b/i;
const PAYMENT_RE = /\b(?:pay|wire|refund|deposit|settle|invoice)\b/i;

const ATTENDANCE_RE = /\bi(?:'ll|\s+will|\s+can)?\s+(?:be there|come|join|attend|show up)\b/i;
const VAGUE_INTENT_RE =
	/\b(?:sometime|someday|maybe|probably|i'?ll try|i will try|we should|would be nice|if i|if we)\b/i;
const JOKE_RE = /\b(?:lol|haha|jk|joking|lmao|😂|🤣)\b/i;
const COMPLETED_RE = /\b(?:already sent|already paid|already did|done|completed|finished)\b/i;
const CANCELLATION_RE = /\b(?:never mind|nevermind|no need|cancel(?:led)?|forget it)\b/i;
const STATUS_RE = /\b(?:i'?m working on it|working on it|in progress|looking into it)\b/i;
const ANNOUNCEMENT_RE =
	/\bi\s+will\s+be\s+(?:presenting|speaking|traveling|travelling|attending|sending\s+(?:out\s+)?(?:another\s+)?announcement)\b/i;
const THREAT_RE = /\bi(?:'ll|\s+will)\s+(?:kill|destroy|murder|crush)\b/i;
const ABUSIVE_OR_THREAT_RE =
	/\b(?:terminal cancer|humble (?:him|her|them)|less than (?:a )?human|make (?:him|her|them) feel less than|kill|destroy|murder|crush)\b/i;

function sourceId(message: TranscriptMessage, index: number): string {
	return message.sourceMessageId || message.id || `${SOURCE_ID_PREFIX}${index + 1}`;
}

function normalizeText(text: string): string {
	return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function hmacWindow(messages: TranscriptMessage[], workspaceSalt?: Buffer): string | undefined {
	if (!workspaceSalt) return undefined;
	const hmac = createHmac('sha256', workspaceSalt);
	for (const [index, message] of messages.entries()) {
		hmac.update(sourceId(message, index));
		hmac.update('\0');
		hmac.update(normalizeText(message.content));
		hmac.update('\0');
	}
	return hmac.digest('hex');
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

function reasonCodesForMessage(
	messages: TranscriptMessage[],
	index: number,
): { positive: string[]; negative: string[]; score: number } {
	const text = messages[index]?.content ?? '';
	const positive: string[] = [];
	const negative: string[] = [];

	if (FIRST_PERSON_PROMISE_RE.test(text)) positive.push('first_person_promise');
	if (REQUEST_RE.test(text)) positive.push('request_or_directive');
	if (DATE_RE.test(text)) positive.push('date_or_deadline');
	if (ACTION_VERB_RE.test(text)) positive.push('trackable_action_verb');
	if (PAYMENT_RE.test(text)) positive.push('payment_action');
	if (MEETING_RE.test(text)) positive.push('meeting_action');

	if (ACCEPTANCE_RE.test(text)) {
		const priorWindowStart = Math.max(0, index - 5);
		const acceptedRequest = messages
			.slice(priorWindowStart, index)
			.some((message) => REQUEST_RE.test(message.content));
		if (acceptedRequest) positive.push('accepted_prior_request');
	}

	if (ATTENDANCE_RE.test(text)) negative.push('attendance_confirmation');
	if (VAGUE_INTENT_RE.test(text)) negative.push('vague_intent');
	if (JOKE_RE.test(text)) negative.push('joke_or_banter');
	if (COMPLETED_RE.test(text)) negative.push('completed_or_past_action');
	if (CANCELLATION_RE.test(text)) negative.push('cancelled_or_negated');
	if (STATUS_RE.test(text) && !REQUEST_RE.test(text)) negative.push('status_only');
	if (ANNOUNCEMENT_RE.test(text)) negative.push('announcement');
	if (THREAT_RE.test(text)) negative.push('threat_or_banter');

	const score =
		positive.length * 0.22 +
		(positive.includes('date_or_deadline') && positive.includes('trackable_action_verb')
			? 0.2
			: 0) -
		negative.length * 0.28;

	return { positive: unique(positive), negative: unique(negative), score };
}

export function buildCommitmentV2Candidates(
	messages: TranscriptMessage[],
	workspaceSalt?: Buffer,
): CommitmentV2Candidate[] {
	const candidates: CommitmentV2Candidate[] = [];
	const seenAnchors = new Set<string>();

	for (let index = 0; index < messages.length; index++) {
		const reasons = reasonCodesForMessage(messages, index);
		const hasStrongDueDateAction =
			reasons.positive.includes('date_or_deadline') &&
			reasons.positive.includes('trackable_action_verb');
		if (reasons.score < MIN_CANDIDATE_SCORE && !hasStrongDueDateAction) continue;

		const anchorSourceId = sourceId(messages[index], index);
		if (seenAnchors.has(anchorSourceId)) continue;
		seenAnchors.add(anchorSourceId);

		const start = Math.max(0, index - WINDOW_LOOKBACK);
		const end = Math.min(messages.length - 1, index + WINDOW_LOOKAHEAD);
		const windowMessages = messages.slice(start, end + 1);
		const windowSourceIds = windowMessages.map((message, windowIndex) =>
			sourceId(message, start + windowIndex),
		);

		candidates.push({
			anchorSourceId,
			windowSourceIds,
			positiveReasonCodes: reasons.positive,
			negativeReasonCodes: reasons.negative,
			candidateScore: Number(Math.max(0, Math.min(1, reasons.score)).toFixed(3)),
			contentFingerprintHmac: hmacWindow(windowMessages, workspaceSalt),
			detectorVersion: COMMITMENT_V2_DETECTOR_VERSION,
		});
	}

	return candidates;
}

function candidateForCommitment(
	candidates: CommitmentV2Candidate[],
	commitment: ExtractedCommitment,
): CommitmentV2Candidate | undefined {
	const sourceIds = commitment.source_message_ids ?? [];
	return candidates.find((candidate) =>
		sourceIds.some((sourceMessageId) => candidate.windowSourceIds.includes(sourceMessageId)),
	);
}

function quoteGroundsToMessages(
	commitment: ExtractedCommitment,
	messages: TranscriptMessage[],
): boolean {
	const quote = normalizeText(commitment.quote);
	if (quote.length === 0) return false;
	return messages.some((message) => normalizeText(message.content).includes(quote));
}

function validateTrackableOutcome(commitment: ExtractedCommitment): boolean {
	const combined = `${commitment.title} ${commitment.quote}`;
	if (commitment.commitment_type === 'financial') return PAYMENT_RE.test(combined);
	if (commitment.commitment_type === 'meeting') {
		return MEETING_RE.test(combined) && (DATE_RE.test(combined) || /schedule|book/i.test(combined));
	}
	const hasTrackableAction = ACTION_VERB_RE.test(combined) || PAYMENT_RE.test(combined);
	if (commitment.evidence_level === 'accepted_request') {
		return hasTrackableAction || ACCEPTANCE_RE.test(combined);
	}
	return hasTrackableAction;
}

function classifySignal(commitment: ExtractedCommitment): CommitmentV2SignalType {
	const combined = `${commitment.title} ${commitment.quote}`;
	if (commitment.evidence_level === 'weak') return 'follow_up_candidate';
	if (commitment.commitment_type === 'meeting') return 'meeting_intent_candidate';
	if (ACTION_VERB_RE.test(combined) || FIRST_PERSON_PROMISE_RE.test(combined)) {
		return 'commitment_candidate';
	}
	return 'non_actionable';
}

function negativeFailureCodes(commitment: ExtractedCommitment): string[] {
	const combined = `${commitment.title} ${commitment.quote}`;
	const failures: string[] = [];
	if (ATTENDANCE_RE.test(combined)) failures.push('attendance_confirmation');
	if (THREAT_RE.test(combined) || ABUSIVE_OR_THREAT_RE.test(combined) || JOKE_RE.test(combined)) {
		failures.push('banter_or_threat');
	}
	if (VAGUE_INTENT_RE.test(combined)) failures.push('vague_intent');
	if (ANNOUNCEMENT_RE.test(combined)) failures.push('announcement');
	if (COMPLETED_RE.test(combined)) failures.push('completed_or_past_action');
	if (CANCELLATION_RE.test(combined)) failures.push('cancelled_or_negated');
	return unique(failures);
}

export function validateCommitmentV2Item(input: {
	commitment: ExtractedCommitment;
	messages: TranscriptMessage[];
	candidates: CommitmentV2Candidate[];
	activeAutocreateEnabled?: boolean;
	index?: number;
}): CommitmentV2ValidatedItem {
	const { commitment, messages, candidates, activeAutocreateEnabled = false } = input;
	const allSourceIds = new Set(messages.map(sourceId));
	const sourceMessageIds = unique(commitment.source_message_ids ?? []);
	const failureCodes: string[] = [];
	const warningCodes: string[] = [];
	const candidate = candidateForCommitment(candidates, commitment);

	if (sourceMessageIds.length === 0) failureCodes.push('missing_source_message_ids');
	for (const sourceMessageId of sourceMessageIds) {
		if (!allSourceIds.has(sourceMessageId)) failureCodes.push('source_id_not_in_episode');
	}
	if (!candidate) warningCodes.push('no_matching_candidate_window');
	if (!quoteGroundsToMessages(commitment, messages)) failureCodes.push('quote_not_grounded');
	if (
		commitment.state === 'completed' ||
		commitment.state === 'cancelled' ||
		commitment.state === 'superseded'
	) {
		failureCodes.push(`state_${commitment.state}`);
	}
	if (commitment.assignee === 'unknown') warningCodes.push('ambiguous_assignee');
	if (!validateTrackableOutcome(commitment)) failureCodes.push('not_trackable');
	failureCodes.push(...negativeFailureCodes(commitment));

	const signalType = classifySignal(commitment);
	let route: CommitmentV2Route = 'reject';
	const uniqueFailureCodes = unique(failureCodes);
	const uniqueWarningCodes = unique(warningCodes);

	if (uniqueFailureCodes.length > 0) {
		route = 'reject';
	} else if (
		activeAutocreateEnabled &&
		commitment.confidence >= 0.92 &&
		uniqueWarningCodes.length === 0 &&
		(commitment.evidence_level === 'explicit' || commitment.evidence_level === 'accepted_request')
	) {
		route = 'active';
	} else if (commitment.confidence >= 0.7 && signalType !== 'non_actionable') {
		route = 'draft';
	} else if (commitment.confidence >= 0.55 && signalType === 'follow_up_candidate') {
		route = 'candidate_follow_up';
	}

	return {
		temporaryId: `commitment-v2-${input.index ?? 0}`,
		route,
		signalType: route === 'reject' ? 'rejected' : signalType,
		confidence: commitment.confidence,
		failureCodes: uniqueFailureCodes,
		warningCodes: uniqueWarningCodes,
		sourceMessageIds,
		primarySourceMessageId: sourceMessageIds[0],
		evidenceLevel: commitment.evidence_level,
	};
}

function incrementCounts<T extends string>(counts: Record<T, number>, values: T[]) {
	for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
}

function countCodes(items: CommitmentV2ValidatedItem[], key: 'failureCodes' | 'warningCodes') {
	const counts: Record<string, number> = {};
	for (const item of items) {
		for (const code of item[key]) counts[code] = (counts[code] ?? 0) + 1;
	}
	return counts;
}

export function analyzeCommitmentV2Shadow(input: {
	messages: TranscriptMessage[];
	extractedCommitments: ExtractedCommitment[];
	workspaceSalt?: Buffer;
	sourceAccountId?: string;
	activeAutocreateEnabled?: boolean;
}): CommitmentV2ShadowReport {
	const candidates = buildCommitmentV2Candidates(input.messages, input.workspaceSalt);
	const validatedItems = input.extractedCommitments.map((commitment, index) =>
		validateCommitmentV2Item({
			commitment,
			messages: input.messages,
			candidates,
			activeAutocreateEnabled: input.activeAutocreateEnabled,
			index,
		}),
	);
	const routeCounts: Record<CommitmentV2Route, number> = {
		active: 0,
		draft: 0,
		candidate_follow_up: 0,
		reject: 0,
	};
	incrementCounts(
		routeCounts,
		validatedItems.map((item) => item.route),
	);

	const failureCodeCounts = countCodes(validatedItems, 'failureCodes');
	const warningCodeCounts = countCodes(validatedItems, 'warningCodes');
	const privacySafeEvent = {
		event: 'commitment_v2_shadow_completed' as const,
		source_account_present: Boolean(input.sourceAccountId),
		candidate_count: candidates.length,
		extracted_count: input.extractedCommitments.length,
		route_counts: routeCounts,
		failure_code_counts: failureCodeCounts,
		warning_code_counts: warningCodeCounts,
		detector_version: COMMITMENT_V2_DETECTOR_VERSION,
		prompt_version: COMMITMENT_V2_PROMPT_VERSION,
		validator_version: COMMITMENT_V2_VALIDATOR_VERSION,
	};

	return {
		detectorVersion: COMMITMENT_V2_DETECTOR_VERSION,
		promptVersion: COMMITMENT_V2_PROMPT_VERSION,
		validatorVersion: COMMITMENT_V2_VALIDATOR_VERSION,
		sourceAccountId: input.sourceAccountId,
		candidateCount: candidates.length,
		extractedCount: input.extractedCommitments.length,
		routeCounts,
		failureCodeCounts,
		warningCodeCounts,
		candidates,
		validatedItems,
		privacySafeEvent,
	};
}

export function isCommitmentV2StorageRoute(route: CommitmentV2Route): route is 'active' | 'draft' {
	return route === 'active' || route === 'draft';
}

export function filterCommitmentsByV2Validation(input: {
	messages: TranscriptMessage[];
	extractedCommitments: ExtractedCommitment[];
	workspaceSalt?: Buffer;
	sourceAccountId?: string;
	activeAutocreateEnabled?: boolean;
}): { report: CommitmentV2ShadowReport; commitments: ExtractedCommitment[] } {
	const report = analyzeCommitmentV2Shadow(input);
	const commitments = input.extractedCommitments.filter((_, index) => {
		const route = report.validatedItems[index]?.route;
		return route ? isCommitmentV2StorageRoute(route) : false;
	});
	return { report, commitments };
}

export function isCommitmentV2ShadowEnabled(env: Record<string, string | undefined>): boolean {
	return env.COMMITMENT_V2_SHADOW_ENABLED !== 'false';
}

export function isCommitmentV2ValidationEnabled(env: Record<string, string | undefined>): boolean {
	return env.COMMITMENT_V2_VALIDATION_ENABLED !== 'false';
}
