'use server';

import { workspaceAction } from '@/lib/safe-action';
import { SignJWT } from 'jose';
import { z } from 'zod';

/**
 * Mint a Supabase-compatible JWT for Realtime channel authorization.
 * Uses the project's JWT secret to sign a token with workspace_id claim,
 * bridging Better Auth sessions → Supabase RLS policies.
 */
export const getRealtimeTokenAction = workspaceAction
	.schema(z.object({}))
	.action(async ({ ctx }) => {
		const jwtSecret = process.env.SUPABASE_JWT_SECRET;
		if (!jwtSecret) {
			return { token: null };
		}

		const secret = new TextEncoder().encode(jwtSecret);
		const token = await new SignJWT({
			sub: ctx.session.user.id,
			role: 'authenticated',
			workspace_id: ctx.workspaceId,
		})
			.setProtectedHeader({ alg: 'HS256' })
			.setIssuedAt()
			.setExpirationTime('1h')
			.sign(secret);

		return { token };
	});
