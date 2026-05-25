import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PRIVATE_ENV_FILE_MODE, writePrivateEnvFile } from './env-file.mjs';

let tmpDir;

afterEach(() => {
	if (tmpDir) fs.rmSync(tmpDir, { force: true, recursive: true });
	tmpDir = undefined;
});

function tempEnvPath() {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gordian-env-file-'));
	return path.join(tmpDir, '.env.local');
}

describe('writePrivateEnvFile', () => {
	it('creates new env files with owner-only read/write permissions', () => {
		const envPath = tempEnvPath();

		writePrivateEnvFile(envPath, 'SECRET=value\n');

		expect(fs.readFileSync(envPath, 'utf8')).toBe('SECRET=value\n');
		expect(fs.statSync(envPath).mode & 0o777).toBe(PRIVATE_ENV_FILE_MODE);
	});

	it('tightens permissions when updating an existing env file', () => {
		const envPath = tempEnvPath();
		fs.writeFileSync(envPath, 'OLD=value\n', { mode: 0o644 });

		writePrivateEnvFile(envPath, 'SECRET=value\n');

		expect(fs.readFileSync(envPath, 'utf8')).toBe('SECRET=value\n');
		expect(fs.statSync(envPath).mode & 0o777).toBe(PRIVATE_ENV_FILE_MODE);
	});
});
