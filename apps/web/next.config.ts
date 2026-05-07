import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV === 'development';

function loadRootEnv(): void {
	if (process.env.NODE_ENV === 'production') return;

	const rootEnvPath = path.join(import.meta.dirname, '../../.env.local');
	if (!existsSync(rootEnvPath)) return;

	for (const line of readFileSync(rootEnvPath, 'utf8').split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;

		const index = trimmed.indexOf('=');
		if (index <= 0) continue;

		const key = trimmed.slice(0, index).trim();
		let value = trimmed.slice(index + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}

		if (process.env[key] === undefined) {
			process.env[key] = value;
		}
	}
}

loadRootEnv();

const nextConfig: NextConfig = {
	output: 'standalone',
	outputFileTracingRoot: path.join(import.meta.dirname, '../../'),
	transpilePackages: ['@repo/db', '@repo/crypto', '@repo/shared'],
	async redirects() {
		return [
			{
				source: '/cadences',
				destination: '/follow-up-plans',
				permanent: true,
			},
			{
				source: '/cadences/:path*',
				destination: '/follow-up-plans/:path*',
				permanent: true,
			},
		];
	},
	async headers() {
		return [
			{
				source: '/(.*)',
				headers: [
					{ key: 'X-Frame-Options', value: 'DENY' },
					{ key: 'X-Content-Type-Options', value: 'nosniff' },
					{ key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
					{ key: 'X-DNS-Prefetch-Control', value: 'on' },
					{
						key: 'Strict-Transport-Security',
						value: 'max-age=63072000; includeSubDomains; preload',
					},
					{
						key: 'Permissions-Policy',
						value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
					},
					{
						key: 'Content-Security-Policy',
						value: [
							"default-src 'self'",
							// 'unsafe-eval' required in dev for Next.js HMR + source maps (not needed in prod)
							isDev
								? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
								: "script-src 'self' 'unsafe-inline'",
							"style-src 'self' 'unsafe-inline'",
							"img-src 'self' data: blob:",
							"font-src 'self'",
							"connect-src 'self' wss://*.supabase.co https://*.supabase.co",
							"frame-ancestors 'none'",
							"base-uri 'self'",
							"form-action 'self'",
						].join('; '),
					},
				],
			},
		];
	},
};

export default nextConfig;
