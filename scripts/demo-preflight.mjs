#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import net from 'node:net';

const ports = [
	{ label: 'Postgres', port: 5432, service: 'postgres' },
	{ label: 'Redis', port: 6379, service: 'redis' },
];

function run(command, args) {
	return spawnSync(command, args, {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});
}

function commandOutput(command, args) {
	const result = run(command, args);
	if (result.status !== 0) return '';
	return result.stdout.trim();
}

function runningComposeServices() {
	const output = commandOutput('docker', ['compose', 'ps', '--services', '--status', 'running']);
	return new Set(output.split(/\r?\n/).filter(Boolean));
}

function dockerOwners(port) {
	const output = commandOutput('docker', [
		'ps',
		'--filter',
		`publish=${port}`,
		'--format',
		'{{.Names}} ({{.Image}})',
	]);
	return output.split(/\r?\n/).filter(Boolean);
}

function lsofOwners(port) {
	const output = commandOutput('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN']);
	return output.split(/\r?\n/).filter(Boolean);
}

function checkPort(port) {
	return new Promise((resolve) => {
		const server = net.createServer();

		server.once('error', (error) => {
			resolve({ free: false, error });
		});

		server.once('listening', () => {
			server.close(() => resolve({ free: true }));
		});

		server.listen({ host: '0.0.0.0', port, exclusive: true });
	});
}

function printOwners(port) {
	const docker = dockerOwners(port);
	const lsof = lsofOwners(port);

	if (docker.length > 0) {
		console.error('  Docker containers publishing this port:');
		for (const owner of docker) console.error(`    - ${owner}`);
	}

	if (lsof.length > 0) {
		console.error('  Local listeners:');
		for (const owner of lsof) console.error(`    ${owner}`);
	}

	if (docker.length === 0 && lsof.length === 0) {
		console.error(`  No owner details found. Try: lsof -nP -iTCP:${port} -sTCP:LISTEN`);
	}
}

const runningServices = runningComposeServices();
const conflicts = [];

for (const target of ports) {
	const result = await checkPort(target.port);
	if (result.free) continue;

	if (runningServices.has(target.service)) {
		console.log(
			`[demo:preflight] ${target.label} already appears to be running for this Compose project on localhost:${target.port}; continuing.`,
		);
		continue;
	}

	conflicts.push({ ...target, error: result.error });
}

if (conflicts.length > 0) {
	console.error('[demo:preflight] Demo setup needs these local ports before Docker starts:');
	console.error('');

	for (const conflict of conflicts) {
		console.error(`- ${conflict.label}: localhost:${conflict.port}`);
		if (conflict.error?.code) console.error(`  Bind check failed with ${conflict.error.code}.`);
		printOwners(conflict.port);
		console.error('');
	}

	console.error("Stop the conflicting service, or stop this repo's demo stack with:");
	console.error('  docker compose down');
	console.error('');
	console.error('Then retry:');
	console.error('  pnpm demo:setup');
	process.exit(1);
}

console.log('[demo:preflight] Local demo port preflight passed.');
