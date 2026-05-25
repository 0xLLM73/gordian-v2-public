export { encrypt, decrypt } from './aes';
export { computeBlindIndex } from './blind-index';
export { deriveKeys } from './hkdf';
export {
	keyStore,
	getCurrentKeys,
	unwrapWrk,
	withKeys,
	clearKeyCache,
	generateSessionKek,
	decryptSessionKek,
	deleteSessionKek,
	rehardenSessionKek,
	getTelegramSessionKeyProvider,
	assertSafeTelegramSessionKeyProviderForMtProto,
	generateWorkspaceWrk,
	getWorkspaceKeyProvider,
	isWorkspaceKeychainMarker,
	storeWorkspaceWrkInKeychain,
	deleteWorkspaceWrk,
} from './kms';
export type { TelegramSessionKeyProvider, WorkspaceKeyProvider } from './kms';
export type {
	DerivedKeys,
	ContactAliasInput,
	ContactAliasKind,
	ContactAliasMapEntry,
	ContactAliasMaskOptions,
	ContactMaskEntity,
	ContactMaskResult,
	DetectedEntity,
	EncryptedField,
	EntityMap,
	EntityType,
	KeyContext,
	MaskResult,
	SealedEnvelope,
} from './types';
export {
	generatePersonPseudonym,
	maskContactAliases,
	maskEntities,
	prefilterEntities,
} from './entity-masking';
export {
	computeNextVirtualVersion,
	deriveRotationKeys,
	reEncryptField,
	reEncryptFieldWithNewWrk,
	withKeysForVersion,
} from './rotation';
