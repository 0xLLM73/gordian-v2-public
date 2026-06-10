export interface RedactOptions {
	includeStack?: boolean;
}

const REDACTED = '[redacted]';

const SENSITIVE_FIELD_KEYS = new Set([
	'accountId',
	'apiHash',
	'apiKey',
	'botToken',
	'content',
	'encryptedWrk',
	'embedding',
	'embeddings',
	'inputEmbedding',
	'kmsContext',
	'message',
	'messages',
	'messageText',
	'mistakeEmbedding',
	'params',
	'phoneCodeHash',
	'queryEmbedding',
	'rawMessage',
	'rawMessages',
	'secret',
	'session',
	'sessionString',
	'sourceAccountId',
	'telegramId',
	'telegramMessages',
	'token',
	'workspaceKey',
	'wrk',
]);

function normalizeKey(key: string): string {
	return key.replace(/[_-]/g, '').toLowerCase();
}

function isSensitiveFieldKey(key: string): boolean {
	const normalized = normalizeKey(key);
	for (const candidate of SENSITIVE_FIELD_KEYS) {
		if (normalized === normalizeKey(candidate)) return true;
	}
	return /^(raw|telegram|source|last)?message(text|content|body|snippet)?$/i.test(key);
}

function stringifyUnknown(value: unknown, options: RedactOptions): string {
	if (value instanceof Error) {
		return options.includeStack && value.stack ? value.stack : value.message;
	}
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
		return String(value);
	}
	if (value === undefined) return 'undefined';

	const seen = new WeakSet<object>();
	try {
		return JSON.stringify(value, (_key, item) => {
			if (_key && isSensitiveFieldKey(_key)) return REDACTED;
			if (item instanceof Error) {
				return {
					name: item.name,
					errorMessage: item.message,
					...(options.includeStack && item.stack ? { stack: item.stack } : {}),
				};
			}
			if (typeof item === 'object' && item !== null) {
				if (seen.has(item)) return '[circular]';
				seen.add(item);
			}
			return item;
		});
	} catch {
		return String(value);
	}
}

function redactDatabaseParams(text: string): string {
	return text.replace(/\bparams\s*:\s*(?:\[[^\n]*\]|[^\n]*)/gi, `params: ${REDACTED}`);
}

function redactVectorLikeArrays(text: string): string {
	const numberPattern = String.raw`[-+]?(?:\d+\.\d+|\d+|\.\d+)(?:e[-+]?\d+)?`;
	const commaSeparatedNumbers = String.raw`${numberPattern}(?:\s*,\s*${numberPattern}){15,}`;
	const bracketedVector = new RegExp(String.raw`\[\s*${commaSeparatedNumbers}\s*\]`, 'gi');
	const bareVector = new RegExp(String.raw`\b${commaSeparatedNumbers}\b`, 'gi');

	return text.replace(bracketedVector, REDACTED).replace(bareVector, REDACTED);
}

export function redactText(text: string): string {
	return redactVectorLikeArrays(redactDatabaseParams(text))
		.replace(
			/https:\/\/api\.telegram\.org\/bot[^/\s"')]+/g,
			'https://api.telegram.org/bot[redacted]',
		)
		.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, `$1${REDACTED}`)
		.replace(/\b(security\s+add-generic-password\b[^"'`\n]*?\s-w\s+)([^"'`\s]+)/gi, `$1${REDACTED}`)
		.replace(
			/\b(api[_-]?hash|telegram[_-]?api[_-]?hash|bot[_-]?token|telegram[_-]?bot[_-]?token|openai[_-]?api[_-]?key|anthropic[_-]?api[_-]?key|gemini[_-]?api[_-]?key|worker[_-]?internal[_-]?secret|internal[_-]?auth[_-]?secret|password|phoneCodeHash|verification[_-]?code)\b\s*[:=]\s*(?:"[^"\n]*"|'[^'\n]*'|[^"',\s}]+)/gi,
			(_match, key: string) => `${key}=${REDACTED}`,
		)
		.replace(/\b(redis|rediss|postgres|postgresql):\/\/[^@\s]+@/gi, '$1://[redacted]@')
		.replace(/\btelegram-session:[0-9a-f-]{36}(?::[0-9a-f-]{36})?\b/gi, REDACTED)
		.replace(/\bworkspace-wrk:[0-9a-f-]{36}(?::[0-9a-f-]{36})?\b/gi, REDACTED)
		.replace(
			/\b(security\s+find-generic-password\b[^"'`\n]*?\s-a\s+)([^"'`\s]+)([^"'`\n]*?\s-s\s+)([^"'`\s]+)([^"'`\n]*?\s-w\b)/gi,
			`$1${REDACTED}$3${REDACTED}$5`,
		)
		.replace(/\b\d{5,}:[A-Za-z0-9_-]{20,}\b/g, REDACTED)
		.replace(/\b(sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/g, REDACTED)
		.replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, REDACTED)
		.replace(/\b1[A-Za-z0-9+/=_-]{80,}\b/g, REDACTED)
		.replace(/\b[A-Za-z0-9+/=_-]{120,}\b/g, REDACTED)
		.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
		.replace(
			/(?<![A-Za-z0-9])(?:\+\d[\d\s().-]{6,}\d|\(\d{3}\)\s*\d{3}[\s.-]?\d{4}|\d{3}[\s.-]\d{3}[\s.-]\d{4})(?![A-Za-z0-9])/g,
			'[phone]',
		);
}

export function redactSensitive(value: unknown, options: RedactOptions = {}): string {
	return redactText(stringifyUnknown(value, options));
}

export function redactErrorMessage(error: unknown): string {
	return redactSensitive(error, { includeStack: false });
}
