import fs from 'node:fs';

export const PRIVATE_ENV_FILE_MODE = 0o600;

export function writePrivateEnvFile(envPath, text) {
	fs.writeFileSync(envPath, text, { mode: PRIVATE_ENV_FILE_MODE });
	fs.chmodSync(envPath, PRIVATE_ENV_FILE_MODE);
}
