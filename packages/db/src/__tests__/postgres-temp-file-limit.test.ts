import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConfiguredPostgresTempFileLimit } from '../client';

describe('Postgres temp-file limit config', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('defaults to a bounded local temp-file limit', () => {
		vi.stubEnv('POSTGRES_TEMP_FILE_LIMIT', '');
		expect(getConfiguredPostgresTempFileLimit()).toBeNull();

		vi.unstubAllEnvs();
		expect(getConfiguredPostgresTempFileLimit()).toBe('256MB');
	});

	it('allows explicit supported size values', () => {
		vi.stubEnv('POSTGRES_TEMP_FILE_LIMIT', '1GB');
		expect(getConfiguredPostgresTempFileLimit()).toBe('1GB');

		vi.stubEnv('POSTGRES_TEMP_FILE_LIMIT', '-1');
		expect(getConfiguredPostgresTempFileLimit()).toBe('-1');
	});

	it('allows disabling the transaction-scoped guard', () => {
		vi.stubEnv('POSTGRES_TEMP_FILE_LIMIT', '0');
		expect(getConfiguredPostgresTempFileLimit()).toBeNull();

		vi.stubEnv('POSTGRES_TEMP_FILE_LIMIT', 'off');
		expect(getConfiguredPostgresTempFileLimit()).toBeNull();
	});

	it('rejects unexpected values before reaching SQL', () => {
		vi.stubEnv('POSTGRES_TEMP_FILE_LIMIT', '256 megabytes; drop table messages');
		expect(() => getConfiguredPostgresTempFileLimit()).toThrow(/Invalid POSTGRES_TEMP_FILE_LIMIT/);
	});
});
