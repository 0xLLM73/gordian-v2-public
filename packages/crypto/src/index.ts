export { decrypt, encrypt } from './aes';
export { computeBlindIndex } from './blind-index';
export {
	generatePersonPseudonym,
	maskContactAliases,
	maskEntities,
	prefilterEntities,
} from './entity-masking';
export { deriveKeys } from './hkdf';
export type { TelegramSessionKeyProvider, WorkspaceKeyProvider } from './kms';
export {
	assertSafeTelegramSessionKeyProviderForMtProto,
	clearKeyCache,
	decryptSessionKek,
	deleteSessionKek,
	deleteWorkspaceWrk,
	generateSessionKek,
	generateWorkspaceWrk,
	getCurrentKeys,
	getTelegramSessionKeyProvider,
	getWorkspaceKeyProvider,
	isWorkspaceKeychainMarker,
	keyStore,
	rehardenSessionKek,
	storeWorkspaceWrkInKeychain,
	unwrapWrk,
	withKeys,
} from './kms';
export {
	computeNextVirtualVersion,
	deriveRotationKeys,
	reEncryptField,
	reEncryptFieldWithNewWrk,
	withKeysForVersion,
} from './rotation';
export type {
	ContactAliasInput,
	ContactAliasKind,
	ContactAliasMapEntry,
	ContactAliasMaskOptions,
	ContactMaskEntity,
	ContactMaskResult,
	DerivedKeys,
	DetectedEntity,
	EncryptedField,
	EntityMap,
	EntityType,
	KeyContext,
	MaskResult,
	SealedEnvelope,
} from './types';
