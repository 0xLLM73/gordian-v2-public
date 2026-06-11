import { describe, expect, it } from 'vitest';
import {
	parseLocalOwnerBootstrapArgs,
	shouldRefuseForExistingUsers,
	validateLocalOwnerBootstrapConfig,
} from './local-owner-bootstrap.mjs';

describe('local owner bootstrap config', () => {
	it('uses safe local defaults and generates a password for real runs', () => {
		const config = parseLocalOwnerBootstrapArgs([], {});

		expect(config.email).toBe('owner@gordian.local');
		expect(config.name).toBe('Local Owner');
		expect(config.workspace).toBe('Local Workspace');
		expect(config.password.length).toBeGreaterThanOrEqual(12);
		expect(config.generatedPassword).toBe(true);
		expect(() => validateLocalOwnerBootstrapConfig(config)).not.toThrow();
	});

	it('supports env and CLI overrides without generating a password', () => {
		const config = parseLocalOwnerBootstrapArgs(
			[
				'--',
				'--email',
				'CLI@Example.Local',
				'--name',
				'CLI Owner',
				'--workspace',
				'CLI Workspace',
				'--password',
				'long-local-password',
			],
			{
				LOCAL_OWNER_EMAIL: 'env@example.local',
				LOCAL_OWNER_NAME: 'Env Owner',
				LOCAL_OWNER_WORKSPACE: 'Env Workspace',
				LOCAL_OWNER_PASSWORD: 'env-password',
			},
		);

		expect(config.email).toBe('cli@example.local');
		expect(config.name).toBe('CLI Owner');
		expect(config.workspace).toBe('CLI Workspace');
		expect(config.password).toBe('long-local-password');
		expect(config.generatedPassword).toBe(false);
		expect(() => validateLocalOwnerBootstrapConfig(config)).not.toThrow();
	});

	it('allows dry runs without a password', () => {
		const config = parseLocalOwnerBootstrapArgs(['--dry-run'], {});

		expect(config.dryRun).toBe(true);
		expect(config.password).toBe('');
		expect(config.generatedPassword).toBe(false);
		expect(() => validateLocalOwnerBootstrapConfig(config)).not.toThrow();
	});

	it('refuses weak or malformed account inputs', () => {
		const badEmail = parseLocalOwnerBootstrapArgs(
			['--email', 'not-an-email', '--password', 'long-local-password'],
			{},
		);
		expect(() => validateLocalOwnerBootstrapConfig(badEmail)).toThrow(/valid email/);

		const weakPassword = parseLocalOwnerBootstrapArgs(
			['--email', 'owner@example.local', '--password', 'short'],
			{},
		);
		expect(() => validateLocalOwnerBootstrapConfig(weakPassword)).toThrow(/at least 12/);
	});

	it('refuses existing users unless explicitly allowed', () => {
		expect(shouldRefuseForExistingUsers(1, false)).toBe(true);
		expect(shouldRefuseForExistingUsers(1, true)).toBe(false);
		expect(shouldRefuseForExistingUsers(0, false)).toBe(false);
	});
});
