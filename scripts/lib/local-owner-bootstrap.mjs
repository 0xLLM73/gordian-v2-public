import { randomBytes } from 'node:crypto';

const DEFAULT_EMAIL = 'owner@gordian.local';
const DEFAULT_NAME = 'Local Owner';
const DEFAULT_WORKSPACE = 'Local Workspace';

export function generateLocalOwnerPassword() {
	return randomBytes(18).toString('base64url');
}

export function parseLocalOwnerBootstrapArgs(argv, env = process.env) {
	const config = {
		email: env.LOCAL_OWNER_EMAIL || DEFAULT_EMAIL,
		name: env.LOCAL_OWNER_NAME || DEFAULT_NAME,
		workspace: env.LOCAL_OWNER_WORKSPACE || DEFAULT_WORKSPACE,
		password: env.LOCAL_OWNER_PASSWORD || '',
		allowExistingUsers: env.LOCAL_OWNER_ALLOW_EXISTING_USERS === 'true',
		dryRun: false,
		help: false,
		generatedPassword: false,
	};

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		switch (arg) {
			case '--':
				break;
			case '--email':
				config.email = readValue(argv, ++i, arg);
				break;
			case '--name':
				config.name = readValue(argv, ++i, arg);
				break;
			case '--workspace':
				config.workspace = readValue(argv, ++i, arg);
				break;
			case '--password':
				config.password = readValue(argv, ++i, arg);
				break;
			case '--allow-existing-users':
				config.allowExistingUsers = true;
				break;
			case '--dry-run':
				config.dryRun = true;
				break;
			case '--help':
			case '-h':
				config.help = true;
				break;
			default:
				throw new Error(`Unknown option: ${arg}`);
		}
	}

	config.email = config.email.trim().toLowerCase();
	config.name = config.name.trim();
	config.workspace = config.workspace.trim();
	config.password = config.password.trim();

	if (!config.password && !config.help && !config.dryRun) {
		config.password = generateLocalOwnerPassword();
		config.generatedPassword = true;
	}

	return config;
}

export function validateLocalOwnerBootstrapConfig(config) {
	if (config.help) return;
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.email)) {
		throw new Error('Local owner email must be a valid email address');
	}
	if (config.name.length < 1 || config.name.length > 200) {
		throw new Error('Local owner name must be 1-200 characters');
	}
	if (config.workspace.length < 1 || config.workspace.length > 200) {
		throw new Error('Local workspace name must be 1-200 characters');
	}
	if (!config.dryRun && config.password.length < 12) {
		throw new Error('Local owner password must be at least 12 characters');
	}
}

export function shouldRefuseForExistingUsers(userCount, allowExistingUsers) {
	return Number(userCount) > 0 && !allowExistingUsers;
}

function readValue(argv, index, option) {
	const value = argv[index];
	if (!value || value.startsWith('--')) {
		throw new Error(`${option} requires a value`);
	}
	return value;
}
