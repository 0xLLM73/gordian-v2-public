/** Next.js server startup hook (runs once on server init). */
export function register() {
	// SEC-KMS-001: Fail fast if DEV_KMS_BYPASS is set in production
	if (
		process.env.DEV_KMS_BYPASS === 'true' &&
		(process.env.NODE_ENV === 'production' || process.env.COOLIFY_URL)
	) {
		throw new Error('FATAL: DEV_KMS_BYPASS=true is forbidden in production');
	}
}
