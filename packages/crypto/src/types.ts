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
