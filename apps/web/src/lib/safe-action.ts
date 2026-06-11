import { auth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { getUserWorkspaceId, getWorkspaceEnvelope } from '@/lib/workspace';
import { withWorkspaceRLS } from '@repo/db';
import { createSafeActionClient } from 'next-safe-action';
import { headers } from 'next/headers';

const SAFE_ERROR_MESSAGES = new Set([
	'Unauthorized',
	'No workspace found',
	'Workspace encryption key not found',
	'Not found',
	'Invalid input',
	'Invite not found or already used',
	'Invite has expired',
	'Invite email does not match',
	'Email already has an account',
	'No linked Telegram account',
	'Select one Telegram account before starting a large import',
	'Telegram import consent is required',
	'AI analysis consent is required.',
	'Telegram import is disabled on this deployment',
	'Select one Telegram account before starting a sync',
	'Failed to start Telegram import',
	'Failed to pause Telegram import',
	'Failed to resume Telegram import',
	'Failed to cancel Telegram import',
	'Workspace owners must delete the workspace explicitly before deleting their user account',
	'Telegram sending is disabled on this deployment',
	'Telegram sync is disabled on this deployment',
	'Failed to find commitments',
	'Failed to find introductions',
	'Failed to find connections',
	'Snooze must be in the future',
]);

export const LOCAL_WORKER_UNAVAILABLE_MESSAGE =
	'Could not reach the local worker. Start it with pnpm --filter worker dev or update WORKER_URL, then retry.';

export function isLocalWorkerConnectionError(message: string) {
	const normalized = message.toLowerCase();
	return (
		normalized === 'fetch failed' ||
		normalized.includes('econnrefused') ||
		normalized.includes('connection refused') ||
		normalized.includes('worker_url is not configured')
	);
}

export function publicServerActionErrorMessage(error: Error) {
	if (SAFE_ERROR_MESSAGES.has(error.message)) return error.message;
	if (error.message.startsWith('Rate limit exceeded')) return error.message;
	if (isLocalWorkerConnectionError(error.message)) return LOCAL_WORKER_UNAVAILABLE_MESSAGE;
	return 'An unexpected error occurred. Please try again.';
}

export const actionClient = createSafeActionClient({
	handleServerError(e) {
		console.error('Action error:', e.message);
		// Only return known-safe messages to the client; generic fallback for everything else
		return publicServerActionErrorMessage(e);
	},
});

export const authAction = actionClient.use(async ({ next }) => {
	const session = await auth.api.getSession({
		headers: await headers(),
	});

	if (!session?.user) {
		throw new Error('Unauthorized');
	}

	return next({ ctx: { session } });
});

// Default: 10 requests per second per user
const rateLimitedAction = authAction.use(async ({ next, ctx }) => {
	const result = checkRateLimit(ctx.session.user.id, 10, 1_000);
	if (!result.allowed) {
		throw new Error(`Rate limit exceeded. Retry after ${Math.ceil(result.retryAfterMs / 1000)}s`);
	}
	return next({ ctx });
});

/**
 * Workspace-scoped action: derives workspaceId from the authenticated session,
 * preventing IDOR by never accepting workspaceId from client input.
 * Wraps handler in withWorkspaceRLS so all DB calls within the action
 * automatically run with SET LOCAL app.workspace_id for RLS enforcement.
 */
export const workspaceAction = rateLimitedAction.use(async ({ next, ctx }) => {
	const workspaceId = await getUserWorkspaceId(ctx.session.user.id);
	if (!workspaceId) throw new Error('No workspace found');

	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) throw new Error('Workspace encryption key not found');

	return withWorkspaceRLS(workspaceId, async () => {
		return next({ ctx: { ...ctx, workspaceId, envelope } });
	});
});

/** Get the internal secret for worker service-to-service calls. Fails fast if missing. */
export function getInternalSecret(): string {
	const secret = process.env.WORKER_INTERNAL_SECRET || process.env.INTERNAL_AUTH_SECRET;
	if (!secret) throw new Error('WORKER_INTERNAL_SECRET not configured');
	return secret;
}
