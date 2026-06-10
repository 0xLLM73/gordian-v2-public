const NORMALIZE_KEY_PATTERN = /[^a-z0-9]/g;

export const BASIC_CRM_EXPORT_INCLUDED = ['contacts', 'commitments', 'deals'] as const;

export const BASIC_CRM_EXPORT_EXCLUDED = [
	'telegram_messages',
	'chats',
	'knowledge_graph',
	'memories',
	'ai_learning_data',
	'audit_logs',
	'runtime_queues',
] as const;

export const BASIC_CRM_EXPORT_COLLECTION_FIELD_ALLOWLISTS = {
	contacts: [
		'id',
		'firstName',
		'lastName',
		'username',
		'phone',
		'email',
		'messageCount',
		'lastMessageAt',
		'ghostingDismissedAt',
		'createdAt',
		'updatedAt',
	],
	commitments: [
		'id',
		'contactId',
		'title',
		'commitmentType',
		'status',
		'assignee',
		'confidence',
		'dueDate',
		'fulfilledAt',
		'snoozedUntil',
		'createdAt',
		'updatedAt',
		'contactFirstName',
		'contactLastName',
	],
	deals: [
		'id',
		'contactId',
		'title',
		'dealType',
		'stage',
		'value',
		'source',
		'terms',
		'stageHistory',
		'closedAt',
		'createdAt',
		'updatedAt',
		'contactFirstName',
		'contactLastName',
	],
} as const satisfies Record<(typeof BASIC_CRM_EXPORT_INCLUDED)[number], readonly string[]>;

export type BasicCrmExportCollection = keyof typeof BASIC_CRM_EXPORT_COLLECTION_FIELD_ALLOWLISTS;

const BASIC_CRM_EXPORT_FORBIDDEN_KEYS = new Set([
	'accesskey',
	'accesstoken',
	'accesstokenexpiresat',
	'accountid',
	'aioutput',
	'airun',
	'airuns',
	'apihash',
	'apikey',
	'auditlogs',
	'authorization',
	'bandittraceid',
	'bearer',
	'bottoken',
	'chats',
	'content',
	'drafttext',
	'emailblindindex',
	'emailbidx',
	'embedding',
	'embeddings',
	'encryptedwrk',
	'extractioncontext',
	'firstnameblindindex',
	'firstnamebidx',
	'fulfillmentevidence',
	'idtoken',
	'inputembedding',
	'knowledgegraph',
	'kmscontext',
	'lastnameblindindex',
	'lastnamebidx',
	'lastmessagebody',
	'lastmessagecontent',
	'lastmessagetext',
	'memories',
	'messagebody',
	'messagecontent',
	'messages',
	'messagetext',
	'mistakeembedding',
	'note',
	'notes',
	'params',
	'password',
	'phoneblindindex',
	'phonebidx',
	'phonecodehash',
	'privatenote',
	'privatenotes',
	'prompt',
	'prompts',
	'queryembedding',
	'quote',
	'rawmessage',
	'rawmessages',
	'refreshtoken',
	'refreshtokenexpiresat',
	'secret',
	'session',
	'sessionkekencrypted',
	'sessionstring',
	'sourceaccountid',
	'sourcemanifest',
	'sourcemessageids',
	'sourcemessagetext',
	'stagenote',
	'telegramaccountid',
	'telegramchatid',
	'telegramid',
	'telegrammessageid',
	'telegrammessages',
	'telegramsenderid',
	'telegramuserid',
	'titleblindindex',
	'token',
	'uncertainty',
	'usernameblindindex',
	'usernamebidx',
	'userid',
	'workspaceid',
	'workspacekey',
	'wrk',
]);

const ARTIFACT_CONTAINER_KEYS = new Set(['artifact', 'artifacts', 'dealartifact', 'dealartifacts']);
const AI_RUN_CONTAINER_KEYS = new Set(['airun', 'airuns', 'dealairun', 'dealairuns']);

export function normalizeExportKey(key: string) {
	return key.toLowerCase().replace(NORMALIZE_KEY_PATTERN, '');
}

export function isForbiddenBasicCrmExportKey(key: string) {
	const normalized = normalizeExportKey(key);
	if (BASIC_CRM_EXPORT_FORBIDDEN_KEYS.has(normalized)) return true;
	return /^(raw|telegram|source|last)?message(text|content|body|snippet)$/.test(normalized);
}

export function stripSensitiveExportFields(value: unknown, path: string[] = []): unknown {
	if (value instanceof Date) return value.toISOString();
	if (Array.isArray(value)) return value.map((item) => stripSensitiveExportFields(item, path));
	if (!value || typeof value !== 'object') return value;

	const result: Record<string, unknown> = {};
	for (const [key, childValue] of Object.entries(value)) {
		const normalizedKey = normalizeExportKey(key);
		const insideArtifact = path.some((entry) => ARTIFACT_CONTAINER_KEYS.has(entry));
		const insideAiRun = path.some((entry) => AI_RUN_CONTAINER_KEYS.has(entry));
		if (isForbiddenBasicCrmExportKey(key)) continue;
		if (ARTIFACT_CONTAINER_KEYS.has(normalizedKey)) continue;
		if (insideArtifact) continue;
		if (AI_RUN_CONTAINER_KEYS.has(normalizedKey)) continue;
		if (insideAiRun) continue;
		result[key] = stripSensitiveExportFields(childValue, [...path, normalizedKey]);
	}
	return result;
}

export function sanitizeBasicCrmExportRows(
	collection: BasicCrmExportCollection,
	rows: Array<Record<string, unknown>>,
) {
	const allowlist = new Set<string>(BASIC_CRM_EXPORT_COLLECTION_FIELD_ALLOWLISTS[collection]);
	return rows.map((row) => {
		const projected: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(row)) {
			if (!allowlist.has(key)) continue;
			projected[key] = stripSensitiveExportFields(value, [collection, normalizeExportKey(key)]);
		}
		return projected;
	});
}
