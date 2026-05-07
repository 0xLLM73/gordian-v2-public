import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function parseEnvLine(line) {
	const trimmed = line.trim();
	if (!trimmed || trimmed.startsWith('#')) return null;

	const index = trimmed.indexOf('=');
	if (index <= 0) return null;

	const key = trimmed.slice(0, index).trim();
	let value = trimmed.slice(index + 1).trim();

	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		value = value.slice(1, -1);
	}

	return [key, value.replace(/\\n/g, '\n')];
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export function loadRootEnv(rootDir = path.resolve(currentDir, '../..')) {
	for (const filename of ['.env.local', '.env']) {
		const envPath = path.join(rootDir, filename);
		if (!existsSync(envPath)) continue;

		for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
			const parsed = parseEnvLine(line);
			if (!parsed) continue;

			const [key, value] = parsed;
			if (process.env[key] === undefined) {
				process.env[key] = value;
			}
		}
	}
}
