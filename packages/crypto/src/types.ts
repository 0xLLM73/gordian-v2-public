export interface KeyContext {
	workspaceId: string;
	userId: string;
}

export interface DerivedKeys {
	/** Data Encryption Key — AES-256-GCM */
	dek: Buffer;
	/** Blind Index Key — HMAC-SHA256 */
	bik: Buffer;
	/** Telegram Session Key — AES-256-GCM (isolated from DEK to limit blast radius) */
	tsk: Buffer;
}

export interface SealedEnvelope {
	/** Encrypted WRK blob from KMS */
	encryptedWrk: Buffer;
	/** KMS Encryption Context */
	kmsContext: Record<string, string>;
	/** WRK version for rotation */
	wrkVersion: number;
}

export interface EncryptedField {
	/** Base64-encoded IV (12 bytes) + ciphertext + auth tag (16 bytes) */
	ciphertext: string;
	/** Key version used for encryption */
	keyVersion: number;
}

/** Entity types recognized by Entity-Linked Masking */
export type EntityType = 'PERSON' | 'ORG' | 'MONEY' | 'PHONE' | 'EMAIL' | 'ADDRESS';

/** A detected entity in text with its span */
export interface DetectedEntity {
	text: string;
	type: EntityType;
	start: number;
	end: number;
}

/** Mapping from original entity text to its pseudonym */
export interface EntityMap {
	original: string;
	pseudonym: string;
	type: EntityType;
}

/** Result of entity masking */
export interface MaskResult {
	maskedText: string;
	entityMap: EntityMap[];
}

export type ContactAliasKind = 'fullName' | 'firstName' | 'lastName' | 'username' | 'alias';

export interface ContactAliasInput {
	value: string;
	kind?: ContactAliasKind;
}

/** Contact identity material already known locally by the workspace. */
export interface ContactMaskEntity {
	contactId: string;
	fullName?: string | null;
	firstName?: string | null;
	lastName?: string | null;
	username?: string | null;
	aliases?: Array<string | ContactAliasInput>;
}

export interface ContactAliasMaskOptions {
	/** Full names are masked by default. */
	maskFullNames?: boolean;
	/** First names can be noisy, so callers must opt in. */
	maskFirstNames?: boolean;
	/** Last names can be noisy, so callers must opt in. */
	maskLastNames?: boolean;
	/** @username and username tokens are masked by default. */
	maskUsernames?: boolean;
	/** Structured PII prefiltering is enabled by default unless set false. */
	maskStructuredPii?: boolean;
	/** Optional caller-provided structured PII spans, e.g. prefilterEntities(text). */
	structuredEntities?: DetectedEntity[];
}

export interface ContactAliasMapEntry {
	alias: string;
	matchedText: string;
	contactId: string;
	pseudonym: string;
	kind: ContactAliasKind;
}

export interface ContactMaskResult extends MaskResult {
	aliasMap: ContactAliasMapEntry[];
}
