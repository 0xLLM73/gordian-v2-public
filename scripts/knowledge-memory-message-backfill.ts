#!/usr/bin/env tsx
import { pathToFileURL } from 'node:url';
import {
	type MemoryMessageBackfillReport,
	backfillMemoryMessageMetadata,
} from '../packages/db/src/dal/memories';
import { loadRootEnv } from './lib/load-root-env.mjs';

loadRootEnv();

interface CliOptions {
	write: boolean;
	workspaceId?: string;
	limit?: number;
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
		if (arg === '--limit') {
			const value = argv[i + 1];
			if (!value) throw new Error('--limit requires a value');
			const limit = Number(value);
			if (!Number.isInteger(limit) || limit <= 0)
				throw new Error('--limit must be a positive integer');
			options.limit = limit;
			i += 1;
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}
	return options;
}

function section(title: string): string {
	return `\n${title}\n${'-'.repeat(title.length)}`;
}

export function renderMemoryMessageBackfillReport(report: MemoryMessageBackfillReport): string {
	const lines = [
		`Knowledge Memory Message Metadata Backfill Report (${report.mode})`,
		'============================================================',
		report.mode === 'write' ? 'Write mode executed.' : 'No data was written.',
		report.workspaceId ? `Workspace filter: ${report.workspaceId}` : 'Workspace filter: all',
		'',
		`Total memories: ${report.totalMemories}`,
		`Memories missing metadata.messageId: ${report.memoriesMissingMessageId}`,
		`Eligible for deterministic backfill: ${report.eligibleForBackfill}`,
		`Skipped already has metadata.messageId: ${report.skippedAlreadyHasMessageId}`,
		`Skipped ambiguous: ${report.skippedAmbiguous}`,
		`Skipped no deterministic source: ${report.skippedNoDeterministicSource}`,
		`Skipped no matching message: ${report.skippedNoMatchingMessage}`,
		`Rows updated: ${report.updated}`,
		`Estimated unlocked knowledge_evidence rows: ${report.estimatedUnlockedEvidenceRows}`,
		`Estimated unlocked knowledge nodes: ${report.estimatedUnlockedKnowledgeNodes}`,
	];

	lines.push(section('By Workspace'));
	if (report.byWorkspace.length === 0) {
		lines.push('No memory rows found.');
	} else {
		for (const row of report.byWorkspace) {
			lines.push(
				`${row.workspaceId}: eligible=${row.eligibleForBackfill}, missing=${row.memoriesMissingMessageId}, ` +
					`ambiguous=${row.skippedAmbiguous}, no_source=${row.skippedNoDeterministicSource}, ` +
					`no_message=${row.skippedNoMatchingMessage}, updated=${row.updated}, ` +
					`unlock_evidence=${row.estimatedUnlockedEvidenceRows}, unlock_nodes=${row.estimatedUnlockedKnowledgeNodes}`,
			);
		}
	}

	lines.push(section('By Contact'));
	if (report.byContact.length === 0) {
		lines.push('No contact-linked memory rows found.');
	} else {
		for (const row of report.byContact.slice(0, 25)) {
			lines.push(
				`${row.contactId ?? 'none'} (workspace=${row.workspaceId}): eligible=${row.eligibleForBackfill}, ` +
					`missing=${row.memoriesMissingMessageId}, ambiguous=${row.skippedAmbiguous}, ` +
					`no_source=${row.skippedNoDeterministicSource}, no_message=${row.skippedNoMatchingMessage}, ` +
					`updated=${row.updated}`,
			);
		}
		if (report.byContact.length > 25) {
			lines.push(`... ${report.byContact.length - 25} more contact rows omitted`);
		}
	}

	lines.push(section('Sample Candidates'));
	if (report.candidates.length === 0) {
		lines.push('No deterministic candidates found.');
	} else {
		for (const candidate of report.candidates.slice(0, 20)) {
			lines.push(
				`${candidate.memoryId} -> ${candidate.messageId} (${candidate.sourceKey}, workspace=${candidate.workspaceId}, ` +
					`contact=${candidate.contactId ?? 'none'}, evidence=${candidate.estimatedUnlockedEvidenceRows}, ` +
					`nodes=${candidate.estimatedUnlockedKnowledgeNodes})`,
			);
		}
		if (report.candidates.length > 20) {
			lines.push(`... ${report.candidates.length - 20} more candidates omitted`);
		}
	}

	lines.push(section('Recommended Next Action'));
	lines.push(report.recommendedNextAction);

	return lines.join('\n');
}

export async function main() {
	const options = parseArgs(process.argv.slice(2));
	const report = await backfillMemoryMessageMetadata(options);
	console.log(renderMemoryMessageBackfillReport(report));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error('[knowledge-memory-message-backfill] Failed:', (error as Error).message);
		process.exit(1);
	});
}
