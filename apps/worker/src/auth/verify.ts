import * as jose from 'jose';

let jwksCache: jose.JSONWebKeySet | null = null;
let jwksCacheTime = 0;
const JWKS_CACHE_TTL = 15 * 60 * 1000; // 15 minutes (ASA-011)

/**
 * Verify JWT from web tier using Better Auth's JWKS endpoint.
 * Worker never needs direct DB access for auth — just verifies signatures.
 */
export async function verifyWorkerJwt(token: string): Promise<jose.JWTPayload> {
	const webUrl = process.env.WEB_URL;
	if (!webUrl) throw new Error('WEB_URL is not set');

	const now = Date.now();
	if (!jwksCache || now - jwksCacheTime > JWKS_CACHE_TTL) {
		const response = await fetch(`${webUrl}/.well-known/jwks.json`);
		if (!response.ok) throw new Error(`JWKS fetch failed: ${response.status}`);
		jwksCache = (await response.json()) as jose.JSONWebKeySet;
		jwksCacheTime = now;
	}

	const JWKS = jose.createLocalJWKSet(jwksCache);
	const { payload } = await jose.jwtVerify(token, JWKS, {
		issuer: webUrl,
	});
	return payload;
}
