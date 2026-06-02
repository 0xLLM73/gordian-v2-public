import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KEYCHAIN_SET_SECRET_SWIFT = `import Foundation
import Security

func fail(_ message: String, code: Int32 = 1) -> Never {
\tFileHandle.standardError.write(Data((message + "\\n").utf8))
\texit(code)
}

guard CommandLine.arguments.count == 3 else {
\tfail("usage: keychain-set-secret <service> <account>")
}

let service = CommandLine.arguments[1]
let account = CommandLine.arguments[2]
let input = FileHandle.standardInput.readDataToEndOfFile()

guard !input.isEmpty else {
\tfail("refusing to store empty keychain secret")
}

let baseQuery: [String: Any] = [
\tkSecClass as String: kSecClassGenericPassword,
\tkSecAttrService as String: service,
\tkSecAttrAccount as String: account,
]

let attributes: [String: Any] = [
\tkSecValueData as String: input,
\tkSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
]

var addQuery = baseQuery
for (key, value) in attributes {
\taddQuery[key] = value
}

let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
if addStatus == errSecSuccess {
\texit(0)
}

if addStatus == errSecDuplicateItem {
\tlet updateStatus = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
\tif updateStatus == errSecSuccess {
\t\texit(0)
\t}
\tfail("SecItemUpdate failed with status \\(updateStatus)")
}

fail("SecItemAdd failed with status \\(addStatus)")
`;

export async function writeKeychainSecret({ account, secret, service }) {
	if (!account || !service) {
		throw new Error('Keychain account and service are required');
	}
	if (!secret) {
		throw new Error('Refusing to store empty keychain secret');
	}

	const helperDir = mkdtempSync(join(tmpdir(), 'gordian-keychain-helper-'));
	const helperPath = join(helperDir, 'keychain-set-secret.swift');
	const moduleCachePath = join(tmpdir(), 'gordian-swift-module-cache');
	mkdirSync(moduleCachePath, { recursive: true });
	writeFileSync(helperPath, KEYCHAIN_SET_SECRET_SWIFT, { mode: 0o600 });

	await new Promise((resolve, reject) => {
		const child = spawn(
			'swift',
			['-module-cache-path', moduleCachePath, helperPath, service, account],
			{
				stdio: ['pipe', 'pipe', 'pipe'],
			},
		);

		let stdout = '';
		let stderr = '';
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		child.once('error', (error) => {
			reject(
				new Error(
					`macOS Keychain helper failed to start. Install Xcode Command Line Tools. Cause: ${error.message}`,
				),
			);
		});
		child.once('close', (code, signal) => {
			if (code === 0) {
				resolve();
				return;
			}
			const detail = stderr.trim() || stdout.trim() || `exit code ${code ?? `signal ${signal}`}`;
			reject(new Error(`macOS Keychain helper failed: ${detail}`));
		});
		child.stdin.end(secret);
	}).finally(() => {
		rmSync(helperDir, { recursive: true, force: true });
	});
}
