import crypto from 'node:crypto';

/** Maximum age of an OAuth state token (10 minutes) */
const STATE_MAX_AGE_S = 600;

/**
 * Get the HMAC secret for OAuth state tokens.
 * SEC-100: Throws if not configured — no empty-string fallback.
 */
function getOAuthSecret(): string {
	const secret =
		process.env.OAUTH_STATE_SECRET ||
		process.env.WORKER_INTERNAL_SECRET ||
		process.env.INTERNAL_AUTH_SECRET;
	if (!secret) throw new Error('OAUTH_STATE_SECRET not configured');
	return secret;
}

/**
 * Build an opaque OAuth state token with HMAC, nonce, and timestamp.
 * Format: base64url(JSON({wid, n, ts})) + "." + hmac(sha256)
 *
 * SEC-100: Throws if secret missing (no empty-string fallback)
 * SEC-103: CSPRNG nonce + timestamp prevent replay attacks
 * SEC-111: Full 256-bit HMAC (no truncation)
 */
export function buildOAuthState(workspaceId: string): string {
	const secret = getOAuthSecret();
	const nonce = crypto.randomBytes(16).toString('hex');
	const ts = Math.floor(Date.now() / 1000);
	const payload = Buffer.from(JSON.stringify({ wid: workspaceId, n: nonce, ts })).toString(
		'base64url',
	);
	const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
	return `${payload}.${hmac}`;
}

/**
 * Verify HMAC, check expiry, and extract workspaceId from OAuth state token.
 * Returns null if tampered, expired (>10 min), or malformed.
 */
export function verifyOAuthState(state: string): string | null {
	const dot = state.lastIndexOf('.');
	if (dot === -1) return null;

	const payload = state.slice(0, dot);
	const hmac = state.slice(dot + 1);

	let secret: string;
	try {
		secret = getOAuthSecret();
	} catch {
		return null;
	}

	const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');

	if (hmac.length !== expected.length) return null;
	if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected))) return null;

	try {
		const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
			wid?: string;
			n?: string;
			ts?: number;
		};

		if (!data.wid || !data.n || typeof data.ts !== 'number') return null;

		// SEC-103: Reject expired tokens
		const now = Math.floor(Date.now() / 1000);
		if (now - data.ts > STATE_MAX_AGE_S) return null;

		return data.wid;
	} catch {
		return null;
	}
}
