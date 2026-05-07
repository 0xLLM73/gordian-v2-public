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
	'Telegram sending is disabled on this deployment',
	'Telegram sync is disabled on this deployment',
]);

export const actionClient = createSafeActionClient({
	handleServerError(e) {
		console.error('Action error:', e.message);
		// Only return known-safe messages to the client; generic fallback for everything else
		if (SAFE_ERROR_MESSAGES.has(e.message)) return e.message;
		if (e.message.startsWith('Rate limit exceeded')) return e.message;
		return 'An unexpected error occurred. Please try again.';
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
