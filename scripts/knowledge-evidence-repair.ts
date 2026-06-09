#!/usr/bin/env tsx
import { pathToFileURL } from 'node:url';
import {
	type RepairKnowledgeEvidenceCountsResult,
	repairKnowledgeEvidenceCounts,
} from '../packages/db/src/dal/knowledge';
import { loadRootEnv } from './lib/load-root-env.mjs';

loadRootEnv();

interface CliOptions {
	write: boolean;
	workspaceId?: string;
}

function parseArgs(argv: string[]): CliOptions {
	const options: CliOptions = { write: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--write') {
			options.write = true;
			continue;
		}
		if (arg === '--workspace-id') {
			const value = argv[i + 1];
			if (!value) throw new Error('--workspace-id requires a value');
			options.workspaceId = value;
			i += 1;
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}
	return options;
}

export function renderKnowledgeEvidenceRepairResult(
	result: RepairKnowledgeEvidenceCountsResult,
): string {
	return [
		'Knowledge Evidence Repair',
		'=========================',
		'Write mode executed.',
		`Workspace: ${result.workspaceId}`,
		'',
		`Duplicate message-backed evidence rows deleted: ${result.duplicateEvidenceRowsDeleted}`,
		`Contact links recomputed: ${result.contactLinksRecomputed}`,
		`Knowledge nodes recomputed: ${result.nodesRecomputed}`,
	].join('\n');
}

export async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (!options.workspaceId) {
		throw new Error('--workspace-id is required');
	}
	if (!options.write) {
		throw new Error('Refusing to repair without --write');
	}

	const result = await repairKnowledgeEvidenceCounts(options.workspaceId);
	console.log(renderKnowledgeEvidenceRepairResult(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error('[knowledge-evidence-repair] Failed:', (error as Error).message);
		process.exit(1);
	});
}
