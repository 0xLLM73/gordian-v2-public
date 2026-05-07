import { createHmac, timingSafeEqual } from 'node:crypto';
import { generateWorkspaceWrk } from '@repo/crypto';
import { accounts, and, createWorkspace, db, eq, sql } from '@repo/db';
import type { BetterAuthPlugin } from 'better-auth';
import { createAuthEndpoint } from 'better-auth/api';
import { z } from 'zod';

import { isRuntimeEnvEnabled } from './runtime-env';
import { track } from './track';
import { getUserWorkspaceId } from './workspace';

/**
 * Auto-create a workspace for users who don't have one yet.
 * Fires on any Telegram connect — invite or otherwise.
 * Non-fatal: logs errors but never blocks authentication.
 */
async function ensureWorkspace(userId: string): Promise<void> {
	try {
		const existingWs = await getUserWorkspaceId(userId);
		if (existingWs) return;

		const wsId = crypto.randomUUID();
		const { encryptedWrk, kmsContext } = await generateWorkspaceWrk(wsId);
		await createWorkspace(userId, 'My Workspace', encryptedWrk.toString('base64'), kmsContext);
	} catch (err) {
		console.error('[auth-telegram] Failed to auto-create workspace for user', err);
	}
}

/**
 * Verify a Better Auth signed cookie value (format: {token}.{hmac-sha256-base64}).
 * Returns the raw token if the HMAC signature is valid, null otherwise.
 * Replicates better-call's getSignedCookie verification logic.
 */
function verifySignedCookie(signedValue: string, secret: string): string | null {
	const lastDot = signedValue.lastIndexOf('.');
	if (lastDot <= 0) return null;

	const token = signedValue.substring(0, lastDot);
	const signature = signedValue.substring(lastDot + 1);

	// Compute expected HMAC-SHA256 (same algorithm as better-call)
	const expectedMac = createHmac('sha256', secret).update(token).digest();

	let signatureBuf: Buffer;
	try {
		signatureBuf = Buffer.from(signature, 'base64');
	} catch {
		return null;
	}

	if (expectedMac.length !== signatureBuf.length) return null;
	if (!timingSafeEqual(expectedMac, signatureBuf)) return null;

	return token;
}

/** Resolve the internal secret for web→worker communication. Fails fast if unconfigured. */
function getInternalSecret(): string {
	const secret = process.env.WORKER_INTERNAL_SECRET ?? process.env.INTERNAL_AUTH_SECRET;
	if (!secret) throw new Error('Internal auth secret not configured');
	return secret;
}

function isTelegramLinkingEnabled(): boolean {
	return (
		isRuntimeEnvEnabled('TELEGRAM_MTPROTO_ENABLED') &&
		isRuntimeEnvEnabled('NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED')
	);
}

/**
 * Custom telegramAuthProvider plugin for Better Auth.
 * Implements service-to-service auth for Telegram login flow.
 *
 * Flow:
 * 1. Client calls /api/auth/telegram/send-code with phone number
 * 2. Plugin proxies to worker, which calls GramJS to send Telegram code
 * 3. Client receives { success: true }
 * 4. Client calls /api/auth/telegram/verify-code with phone + code
 * 5. Plugin proxies to worker for verification
 * 6. Worker encrypts session before returning from verify-code (ASA-002)
 * 7. Plugin stores encrypted session + KEK blob in accounts table via raw SQL
 * 8. On 2FA: returns requires2FA flag for password input
 */
export const telegramAuthPlugin = {
	id: 'telegram-auth',
	endpoints: {
		sendTelegramCode: createAuthEndpoint(
			'/telegram/send-code',
			{
				method: 'POST',
				body: z.object({
					phone: z.string(),
				}),
			},
			async (ctx) => {
				if (!isTelegramLinkingEnabled()) {
					return ctx.json(
						{ error: 'Telegram linking is disabled on this deployment.' },
						{ status: 503 },
					);
				}

				const workerUrl = process.env.WORKER_URL;
				if (!workerUrl) throw new Error('WORKER_URL is not set');
				const internalSecret = getInternalSecret();

				// SEC-SEND-001: Require authenticated session before proxying to worker.
				// Without this, any unauthenticated caller could trigger OTP delivery
				// to arbitrary phone numbers (SMS/call harassment vector).
				const authSecret = ctx.context.secret;
				const cookieHeader = ctx.headers?.get?.('cookie') ?? '';
				const tokenMatch =
					cookieHeader.match(/__Secure-better-auth\.session_token=([^;]+)/) ??
					cookieHeader.match(/better-auth\.session_token=([^;]+)/);

				let hasSession = false;
				if (tokenMatch?.[1]) {
					const signedValue = decodeURIComponent(tokenMatch[1]);
					const sessionToken = verifySignedCookie(signedValue, authSecret);
					if (sessionToken) {
						const found = await ctx.context.internalAdapter.findSession(sessionToken);
						hasSession = !!found?.session?.userId;
					}
				}

				if (!hasSession) {
					return ctx.json(
						{ error: 'Authentication required. Please log in and try again.' },
						{ status: 401 },
					);
				}

				let response: Response;
				try {
					response = await fetch(`${workerUrl}/telegram/send-code`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'X-Internal-Secret': internalSecret,
						},
						body: JSON.stringify({ phone: ctx.body.phone }),
					});
				} catch {
					return ctx.json({ error: 'Worker unreachable' }, { status: 502 });
				}

				if (!response.ok) {
					let errorMsg = 'Failed to send code';
					try {
						const err = (await response.json()) as {
							error?: string;
							retryAfter?: number;
						};
						if (response.status === 429 && err.retryAfter) {
							errorMsg = `Too many attempts. Try again in ${Math.ceil(err.retryAfter / 60)} minutes.`;
						} else if (err.error) {
							errorMsg = err.error;
						}
					} catch {
						// Non-JSON response
					}
					return ctx.json({ error: errorMsg }, { status: response.status });
				}

				// ASA-003: phoneCodeHash is stored server-side in Redis — not returned to client
				return ctx.json({ success: true });
			},
		),

		verifyTelegramCode: createAuthEndpoint(
			'/telegram/verify-code',
			{
				method: 'POST',
				body: z.object({
					phone: z.string(),
					code: z.string(),
					// ASA-003: phoneCodeHash removed — stored server-side, never round-trips through client
					password: z.string().optional(),
				}),
			},
			async (ctx) => {
				if (!isTelegramLinkingEnabled()) {
					return ctx.json(
						{ error: 'Telegram linking is disabled on this deployment.' },
						{ status: 503 },
					);
				}

				const workerUrl = process.env.WORKER_URL;
				if (!workerUrl) throw new Error('WORKER_URL is not set');
				const internalSecret = getInternalSecret();

				// 1. Resolve authenticated user from request session cookie FIRST.
				//    This avoids unnecessary worker calls when unauthenticated, and
				//    lets us pass the Gordian userId to the worker for correct KMS context.
				//    createAuthEndpoint does NOT auto-populate ctx.context.session —
				//    we must parse the session token from cookies and verify the HMAC
				//    signature before trusting it (SEC-HMAC-001).
				const authSecret = ctx.context.secret;
				let userId: string | null = null;

				const cookieHeader = ctx.headers?.get?.('cookie') ?? '';
				// Production uses __Secure- prefix; dev uses bare name
				const tokenMatch =
					cookieHeader.match(/__Secure-better-auth\.session_token=([^;]+)/) ??
					cookieHeader.match(/better-auth\.session_token=([^;]+)/);

				if (tokenMatch?.[1]) {
					const signedValue = decodeURIComponent(tokenMatch[1]);
					// Verify HMAC-SHA256 signature and extract the raw token
					const sessionToken = verifySignedCookie(signedValue, authSecret);
					if (sessionToken) {
						const found = await ctx.context.internalAdapter.findSession(sessionToken);
						userId = found?.session?.userId ?? null;
					}
				}

				// SEC-LOG-001: Require an authenticated session to link Telegram.
				// Without this, an attacker with a valid TG code but no Gordian session
				// could create or hijack accounts via the phone-number fallthrough path.
				if (!userId) {
					return ctx.json(
						{ error: 'Authentication required. Please log in and try again.' },
						{ status: 401 },
					);
				}

				// 2. Verify code via worker — pass userId so KEK is encrypted with correct context
				const response = await fetch(`${workerUrl}/telegram/verify-code`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'X-Internal-Secret': internalSecret,
					},
					body: JSON.stringify({
						phone: ctx.body.phone,
						code: ctx.body.code,
						// ASA-003: phoneCodeHash omitted — worker retrieves it from Redis by phone key
						password: ctx.body.password,
						userId, // Gordian userId for KMS encryption context
					}),
				});

				if (!response.ok) {
					// Only check for the 2FA code — never expose raw worker error messages
					let workerErr: { code?: string; error?: string } = {};
					try {
						workerErr = (await response.json()) as { code?: string; error?: string };
						console.error(
							'[auth-telegram] Worker verify-code failed:',
							response.status,
							JSON.stringify(workerErr),
						);
						if (workerErr.code === 'SESSION_PASSWORD_NEEDED') {
							return ctx.json({ requires2FA: true }, { status: 202 });
						}
					} catch {
						console.error(
							'[auth-telegram] Worker verify-code failed:',
							response.status,
							'(non-JSON body)',
						);
					}
					throw new Error('Verification failed');
				}

				// ASA-002: Worker encrypts session before returning — no wrap-session call needed
				const { telegramUserId, encryptedSession, sessionKekEncrypted } =
					(await response.json()) as {
						telegramUserId: string;
						encryptedSession: string;
						sessionKekEncrypted: string;
					};

				// 3. Check if a telegram account already exists for this telegramUserId
				const existingAccounts = await db
					.select()
					.from(accounts)
					.where(and(eq(accounts.providerId, 'telegram'), eq(accounts.accountId, telegramUserId)))
					.limit(1);

				if (existingAccounts.length > 0) {
					const existing = existingAccounts[0];

					// Store encrypted session + KEK blob via raw SQL (bypass Drizzle custom type)
					await db.execute(
						sql`UPDATE accounts SET access_token = ${encryptedSession}, session_kek_encrypted = decode(${sessionKekEncrypted}, 'base64'), updated_at = now() WHERE id = ${existing.id}`,
					);

					// P2: Notify user via Telegram that a new session was linked
					fetch(`${workerUrl}/telegram/notify-session`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'X-Internal-Secret': internalSecret,
						},
						body: JSON.stringify({ telegramUserId }),
					}).catch((err) => {
						console.warn('[auth-telegram] notify-session failed:', (err as Error).message);
					});

					await ensureWorkspace(existing.userId);
					const session = await ctx.context.internalAdapter.createSession(existing.userId);
					const existingWsId = await getUserWorkspaceId(existing.userId);

					if (existingWsId) {
						track(existingWsId, existing.userId, 'onboarding.verification_success', {
							had_2fa: !!ctx.body.password,
						});
					}

					return ctx.json({ session, user: { id: existing.userId }, workspaceId: existingWsId });
				}

				const user = { id: userId };

				// 4. Create Telegram account (without accessToken — Better Auth adapter doesn't
				//    know about sessionKekEncrypted, so we set both columns via raw SQL below)
				await ctx.context.internalAdapter.createAccount({
					userId: user.id,
					providerId: 'telegram',
					accountId: telegramUserId,
				});

				// 5. Store encrypted session + KEK blob via raw SQL
				await db.execute(
					sql`UPDATE accounts SET access_token = ${encryptedSession}, session_kek_encrypted = decode(${sessionKekEncrypted}, 'base64'), updated_at = now() WHERE user_id = ${user.id} AND provider_id = 'telegram' AND account_id = ${telegramUserId}`,
				);

				// 6. Auto-create workspace if user doesn't have one
				await ensureWorkspace(user.id);

				// 7. Return workspace ID so client can advance through onboarding
				const wsId = await getUserWorkspaceId(user.id);

				if (wsId) {
					track(wsId, user.id, 'onboarding.verification_success', {
						had_2fa: !!ctx.body.password,
					});
				}

				return ctx.json({ user, workspaceId: wsId });
			},
		),
	},
} satisfies BetterAuthPlugin;
