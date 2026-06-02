import { createHmac } from 'node:crypto';
import type {
	ContactAliasInput,
	ContactAliasKind,
	ContactAliasMapEntry,
	ContactAliasMaskOptions,
	ContactMaskEntity,
	ContactMaskResult,
	DetectedEntity,
	EntityMap,
	EntityType,
	MaskResult,
} from './types';

/**
 * Entity-Linked Masking (followup12a/12b):
 * Replace PII with consistent, workspace-scoped pseudonyms.
 * "Alice called Bob" → "PERSON_a1b2 called PERSON_c3d4"
 *
 * CRITICAL: Embeddings are invertible. Vec2Text recovers 92% of text.
 * Raw PII must NEVER be embedded. This function sanitizes text before
 * it reaches the embedding API.
 */

/**
 * Generate a consistent pseudonym for an entity using HMAC.
 * Same entity + same salt → same pseudonym (enables entity co-reference).
 */
function generatePseudonym(entityText: string, type: string, salt: Buffer): string {
	const hash = createHmac('sha256', salt)
		.update(entityText.toLowerCase().trim())
		.digest('hex')
		.substring(0, 8); // NOTE: Pseudonym length changed from 4→8 hex in Sprint 6 (SEC-037).
	// Existing embeddings have 4-char pseudonyms and will naturally refresh on next sync.
	// Full re-embedding deferred to multi-user launch.

	return `${type}_${hash}`;
}

/**
 * Generate a stable workspace-scoped person alias from a contact id.
 * The raw name/handle is intentionally not included in the HMAC input.
 */
export function generatePersonPseudonym(contactId: string, workspaceSalt: Buffer): string {
	const hash = createHmac('sha256', workspaceSalt)
		.update(contactId.trim())
		.digest('hex')
		.substring(0, 8);

	return `PERSON_${hash}`;
}

/**
 * Mask detected entities in text with consistent pseudonyms.
 *
 * @param text - Raw text containing PII
 * @param workspaceSalt - Workspace-scoped salt for consistent pseudonyms
 * @param detectedEntities - Entities detected by NER or heuristic prefilter
 * @returns Masked text and entity map for reverse lookup
 */
export function maskEntities(
	text: string,
	workspaceSalt: Buffer,
	detectedEntities: DetectedEntity[],
): MaskResult {
	if (detectedEntities.length === 0) {
		return { maskedText: text, entityMap: [] };
	}

	const entityMap: EntityMap[] = [];
	let maskedText = text;

	// Sort by position (descending) to preserve offsets during replacement
	const sorted = [...detectedEntities].sort((a, b) => b.start - a.start);

	for (const entity of sorted) {
		const pseudonym = generatePseudonym(entity.text, entity.type, workspaceSalt);

		entityMap.push({
			original: entity.text,
			pseudonym,
			type: entity.type,
		});

		maskedText =
			maskedText.substring(0, entity.start) + pseudonym + maskedText.substring(entity.end);
	}

	return { maskedText, entityMap };
}

// ─── Contact-Aware Name/User Masking ─────────────────────────────────────────

interface ContactAliasCandidate {
	alias: string;
	contactId: string;
	kind: ContactAliasKind;
	pseudonym: string;
	boundary: 'name' | 'username';
}

interface ReplacementSpan {
	start: number;
	end: number;
	text: string;
	type: EntityType;
	replacement: string;
	source: 'contact' | 'structured';
	contactId?: string;
	alias?: string;
	kind?: ContactAliasKind;
}

const MIN_SAFE_NAME_VARIANT_LENGTH = 2;

const DEFAULT_CONTACT_ALIAS_OPTIONS: Required<Omit<ContactAliasMaskOptions, 'structuredEntities'>> =
	{
		maskFullNames: true,
		maskFirstNames: false,
		maskLastNames: false,
		maskUsernames: true,
		maskStructuredPii: true,
	};

/**
 * Mask locally-known contact names and usernames with contact-id pseudonyms.
 *
 * This is entirely local span logic: raw names/handles are never sent to any
 * external service, and PERSON aliases are derived from contact ids only.
 */
export function maskContactAliases(
	text: string,
	workspaceSalt: Buffer,
	contacts: ContactMaskEntity[],
	options: ContactAliasMaskOptions = {},
): ContactMaskResult {
	const resolvedOptions = { ...DEFAULT_CONTACT_ALIAS_OPTIONS, ...options };
	const contactSpans = buildContactAliasSpans(text, workspaceSalt, contacts, resolvedOptions);
	const structuredSpans = resolvedOptions.maskStructuredPii
		? (resolvedOptions.structuredEntities ?? prefilterEntities(text)).map((entity) => ({
				start: entity.start,
				end: entity.end,
				text: entity.text,
				type: entity.type,
				replacement: generatePseudonym(entity.text, entity.type, workspaceSalt),
				source: 'structured' as const,
			}))
		: [];

	const selected = selectNonOverlappingSpans([...contactSpans, ...structuredSpans]);
	let maskedText = text;

	for (const span of [...selected].sort((a, b) => b.start - a.start)) {
		maskedText =
			maskedText.substring(0, span.start) + span.replacement + maskedText.substring(span.end);
	}

	const entityMap: EntityMap[] = selected
		.sort((a, b) => a.start - b.start || b.end - a.end)
		.map((span) => ({
			original: span.text,
			pseudonym: span.replacement,
			type: span.type,
		}));

	const aliasMap: ContactAliasMapEntry[] = selected
		.filter(
			(
				span,
			): span is ReplacementSpan &
				Required<Pick<ReplacementSpan, 'contactId' | 'alias' | 'kind'>> =>
				span.source === 'contact' &&
				span.contactId !== undefined &&
				span.alias !== undefined &&
				span.kind !== undefined,
		)
		.map((span) => ({
			alias: span.alias,
			matchedText: span.text,
			contactId: span.contactId,
			pseudonym: span.replacement,
			kind: span.kind,
		}));

	return { maskedText, entityMap, aliasMap };
}

function buildContactAliasSpans(
	text: string,
	workspaceSalt: Buffer,
	contacts: ContactMaskEntity[],
	options: Required<Omit<ContactAliasMaskOptions, 'structuredEntities'>>,
): ReplacementSpan[] {
	const candidates = buildContactAliasCandidates(contacts, workspaceSalt, options);
	const spans: ReplacementSpan[] = [];

	for (const candidate of candidates) {
		for (const match of findAliasMatches(text, candidate.alias, candidate.boundary)) {
			spans.push({
				start: match.start,
				end: match.end,
				text: match.text,
				type: 'PERSON',
				replacement: candidate.pseudonym,
				source: 'contact',
				contactId: candidate.contactId,
				alias: candidate.alias,
				kind: candidate.kind,
			});
		}
	}

	return spans;
}

function buildContactAliasCandidates(
	contacts: ContactMaskEntity[],
	workspaceSalt: Buffer,
	options: Required<Omit<ContactAliasMaskOptions, 'structuredEntities'>>,
): ContactAliasCandidate[] {
	const byAlias = new Map<string, ContactAliasCandidate[]>();

	for (const contact of contacts) {
		const pseudonym = generatePersonPseudonym(contact.contactId, workspaceSalt);
		const aliases: Array<Omit<ContactAliasCandidate, 'contactId' | 'pseudonym'>> = [];

		if (options.maskFullNames) {
			addNameAlias(aliases, contact.fullName, 'fullName');
			if (contact.firstName && contact.lastName) {
				addNameAlias(aliases, `${contact.firstName} ${contact.lastName}`, 'fullName');
			}
		}
		if (options.maskFirstNames) {
			addNameAlias(aliases, contact.firstName, 'firstName', MIN_SAFE_NAME_VARIANT_LENGTH);
		}
		if (options.maskLastNames) {
			addNameAlias(aliases, contact.lastName, 'lastName', MIN_SAFE_NAME_VARIANT_LENGTH);
		}
		if (options.maskUsernames) {
			addUsernameAliases(aliases, contact.username);
		}
		for (const alias of contact.aliases ?? []) {
			addConfiguredAlias(aliases, alias);
		}

		for (const alias of aliases) {
			const key = normalizeAliasKey(alias.alias);
			const candidates = byAlias.get(key) ?? [];
			candidates.push({
				...alias,
				contactId: contact.contactId,
				pseudonym,
			});
			byAlias.set(key, candidates);
		}
	}

	const unambiguous: ContactAliasCandidate[] = [];
	for (const candidates of byAlias.values()) {
		const contactIds = new Set(candidates.map((candidate) => candidate.contactId));
		if (contactIds.size === 1) {
			unambiguous.push(candidates[0]);
		}
	}

	return unambiguous.sort(
		(a, b) => b.alias.length - a.alias.length || a.alias.localeCompare(b.alias),
	);
}

function addNameAlias(
	aliases: Array<Omit<ContactAliasCandidate, 'contactId' | 'pseudonym'>>,
	value: string | null | undefined,
	kind: ContactAliasKind,
	minLength = 1,
): void {
	const alias = normalizeAlias(value);
	if (alias.length >= minLength) {
		aliases.push({ alias, kind, boundary: 'name' });
	}
}

function addUsernameAliases(
	aliases: Array<Omit<ContactAliasCandidate, 'contactId' | 'pseudonym'>>,
	value: string | null | undefined,
): void {
	const username = normalizeUsername(value);
	if (!username) return;
	aliases.push({ alias: `@${username}`, kind: 'username', boundary: 'username' });
	aliases.push({ alias: username, kind: 'username', boundary: 'username' });
}

function addConfiguredAlias(
	aliases: Array<Omit<ContactAliasCandidate, 'contactId' | 'pseudonym'>>,
	input: string | ContactAliasInput,
): void {
	const value = typeof input === 'string' ? input : input.value;
	const kind = typeof input === 'string' ? 'alias' : (input.kind ?? 'alias');

	if (kind === 'username') {
		addUsernameAliases(aliases, value);
		return;
	}

	addNameAlias(aliases, value, kind);
}

function normalizeAlias(value: string | null | undefined): string {
	return (value ?? '').trim().replace(/\s+/g, ' ');
}

function normalizeAliasKey(value: string): string {
	return value.toLocaleLowerCase();
}

function normalizeUsername(value: string | null | undefined): string {
	return normalizeAlias(value).replace(/^@+/, '');
}

function findAliasMatches(
	text: string,
	alias: string,
	boundary: ContactAliasCandidate['boundary'],
): Array<{ start: number; end: number; text: string }> {
	const pattern = escapeRegExp(alias).replace(/\s+/g, '\\s+');
	const regex = new RegExp(pattern, 'gi');
	const matches: Array<{ start: number; end: number; text: string }> = [];
	let match = regex.exec(text);

	while (match !== null) {
		const matchText = match[0];
		const start = match.index;
		const end = start + matchText.length;
		if (hasAliasBoundaries(text, start, end, boundary)) {
			matches.push({ start, end, text: matchText });
		}
		match = regex.exec(text);
	}

	return matches;
}

function hasAliasBoundaries(
	text: string,
	start: number,
	end: number,
	boundary: ContactAliasCandidate['boundary'],
): boolean {
	const previous = start > 0 ? text[start - 1] : '';
	const next = end < text.length ? text[end] : '';
	const isBoundaryChar = boundary === 'username' ? isUsernameBoundaryChar : isNameBoundaryChar;

	return !isBoundaryChar(previous) && !isBoundaryChar(next);
}

function isNameBoundaryChar(char: string): boolean {
	return /[A-Za-z0-9_'-]/.test(char);
}

function isUsernameBoundaryChar(char: string): boolean {
	return /[A-Za-z0-9_]/.test(char);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function selectNonOverlappingSpans(spans: ReplacementSpan[]): ReplacementSpan[] {
	const selected: ReplacementSpan[] = [];
	const sorted = [...spans].sort((a, b) => {
		const lengthDiff = b.end - b.start - (a.end - a.start);
		if (lengthDiff !== 0) return lengthDiff;
		const priorityDiff = getSpanPriority(a) - getSpanPriority(b);
		if (priorityDiff !== 0) return priorityDiff;
		return a.start - b.start;
	});

	for (const span of sorted) {
		if (!selected.some((existing) => spansOverlap(existing, span))) {
			selected.push(span);
		}
	}

	return selected.sort((a, b) => a.start - b.start || b.end - a.end);
}

function spansOverlap(a: ReplacementSpan, b: ReplacementSpan): boolean {
	return a.start < b.end && b.start < a.end;
}

function getSpanPriority(span: ReplacementSpan): number {
	if (span.source === 'structured' && span.type !== 'PERSON') return 0;
	if (span.source === 'contact') return 1;
	return 2;
}

// ─── Heuristic Prefilter ──────────────────────────────────────────────────────

const PII_PATTERNS: Array<{ type: EntityType; pattern: RegExp }> = [
	{ type: 'EMAIL', pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
	{ type: 'PERSON', pattern: /(?<![\w.])@[A-Za-z][A-Za-z0-9_]{4,31}\b(?![/.-])/g },
	{ type: 'ADDRESS', pattern: /\b0x[a-fA-F0-9]{40}\b/g },
	{
		type: 'PHONE',
		pattern: /(?:\+\d{1,3}[-.\s]?)?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g,
	},
	{
		type: 'MONEY',
		pattern:
			/[$€£¥]\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s?(?:USD|EUR|GBP|ETH|BTC|USDT|USDC)\b/gi,
	},
];

const MIN_PHONE_LENGTH = 7;

/**
 * Detect structured PII entities using regex patterns.
 * Returns entities sorted by start position (ascending), deduplicated by span.
 */
export function prefilterEntities(text: string): DetectedEntity[] {
	const entities: DetectedEntity[] = [];

	for (const { type, pattern } of PII_PATTERNS) {
		const regex = new RegExp(pattern.source, pattern.flags);
		let match = regex.exec(text);
		while (match !== null) {
			const matchText = match[0];
			const start = match.index;
			const end = start + matchText.length;

			if (type !== 'PHONE' || matchText.replace(/\D/g, '').length >= MIN_PHONE_LENGTH) {
				entities.push({ text: matchText, type, start, end });
			}
			match = regex.exec(text);
		}
	}

	entities.sort((a, b) => a.start - b.start || b.end - a.end);

	const deduped: DetectedEntity[] = [];
	let lastEnd = -1;
	for (const entity of entities) {
		if (entity.start >= lastEnd) {
			deduped.push(entity);
			lastEnd = entity.end;
		}
	}

	return deduped;
}
