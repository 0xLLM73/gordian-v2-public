import { accounts, db, sessions, users, verifications } from '@repo/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { telegramAuthPlugin } from './auth-telegram';

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
		signUpEnabled: true,
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
	trustedOrigins: [
		// SEC-062: Reject CSRF requests from untrusted or absent origins.
		// Use NEXT_PUBLIC_APP_URL so prod/staging/dev all work without code changes.
		process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
	],
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
