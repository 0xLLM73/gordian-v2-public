import { accounts, db, sessions, users, verifications } from '@repo/db';
import { APIError, betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAuthMiddleware } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { telegramAuthPlugin } from './auth-telegram';
import {
	DEMO_LOGIN_LOCAL_TELEGRAM_DATA_MESSAGE,
	shouldBlockDemoCredentialSignInForRequest,
} from './local-data-safety';

export const PUBLIC_EMAIL_SIGNUP_ENABLED = false;

function getTrustedOrigins(): string[] {
	const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
	const origins = new Set([configuredOrigin]);

	try {
		const url = new URL(configuredOrigin);
		const port = url.port ? `:${url.port}` : '';
		if (url.hostname === 'localhost') {
			origins.add(`${url.protocol}//127.0.0.1${port}`);
		}
		if (url.hostname === '127.0.0.1') {
			origins.add(`${url.protocol}//localhost${port}`);
		}
	} catch {
		// Better Auth will reject malformed origins later; keep the configured value visible.
	}

	return [...origins];
}

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: 'pg',
		schema: {
			user: users,
			session: sessions,
			account: accounts,
			verification: verifications,
		},
	}),
	emailAndPassword: {
		enabled: true,
		disableSignUp: !PUBLIC_EMAIL_SIGNUP_ENABLED,
	},
	hooks: {
		before: createAuthMiddleware(async (ctx) => {
			if (ctx.path !== '/sign-in/email') return;

			const email = (ctx.body as { email?: unknown } | undefined)?.email;
			if (await shouldBlockDemoCredentialSignInForRequest(email)) {
				throw new APIError('FORBIDDEN', {
					message: DEMO_LOGIN_LOCAL_TELEGRAM_DATA_MESSAGE,
				});
			}
		}),
	},
	plugins: [
		nextCookies(), // REQUIRED for App Router cookie handling
		telegramAuthPlugin,
	],
	rateLimit: {
		// SEC-057: Limit auth endpoints to 10 requests per IP per 60s (SEC-057)
		window: 60,
		max: 10,
	},
	trustedOrigins: getTrustedOrigins(),
	session: {
		expiresIn: 60 * 60 * 24 * 7, // 7 days
		updateAge: 60 * 60 * 24, // refresh daily
		cookieCache: {
			enabled: true,
			maxAge: 5 * 60, // 5 min session cookie cache
		},
	},
	advanced: {
		database: {
			generateId: 'uuid',
		},
	},
});
