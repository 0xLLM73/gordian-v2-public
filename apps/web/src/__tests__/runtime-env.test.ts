import { afterEach, describe, expect, it } from 'vitest';
import {
	getOptionalWorkerInternalSecret,
	getWorkerInternalSecret,
	isRuntimeEnvEnabled,
} from '../lib/runtime-env';

describe('runtime env helpers', () => {
	afterEach(() => {
		Reflect.deleteProperty(process.env, 'WORKER_INTERNAL_SECRET');
		Reflect.deleteProperty(process.env, 'INTERNAL_AUTH_SECRET');
		Reflect.deleteProperty(process.env, 'TEST_FLAG');
	});

	it('treats only lowercase true as enabled', () => {
		process.env.TEST_FLAG = 'true';
		expect(isRuntimeEnvEnabled('TEST_FLAG')).toBe(true);

		process.env.TEST_FLAG = 'false';
		expect(isRuntimeEnvEnabled('TEST_FLAG')).toBe(false);
	});

	it('prefers WORKER_INTERNAL_SECRET for worker calls', () => {
		process.env.WORKER_INTERNAL_SECRET = 'worker-secret';
		process.env.INTERNAL_AUTH_SECRET = 'legacy-secret';

		expect(getWorkerInternalSecret()).toBe('worker-secret');
	});

	it('falls back to INTERNAL_AUTH_SECRET for fresh local clones', () => {
		process.env.INTERNAL_AUTH_SECRET = 'legacy-secret';

		expect(getWorkerInternalSecret()).toBe('legacy-secret');
	});

	it('returns null for optional background hooks when no internal secret is configured', () => {
		expect(getOptionalWorkerInternalSecret()).toBeNull();
	});

	it('fails closed when no internal secret is configured', () => {
		expect(() => getWorkerInternalSecret()).toThrow('WORKER_INTERNAL_SECRET not configured');
	});
});
