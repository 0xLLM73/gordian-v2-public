export function isRuntimeEnvEnabled(name: string): boolean {
	return process.env[name] === 'true';
}

export function getOptionalWorkerInternalSecret(): string | null {
	return process.env.WORKER_INTERNAL_SECRET || process.env.INTERNAL_AUTH_SECRET || null;
}

export function getWorkerInternalSecret(): string {
	const secret = getOptionalWorkerInternalSecret();
	if (!secret) throw new Error('WORKER_INTERNAL_SECRET not configured');
	return secret;
}
