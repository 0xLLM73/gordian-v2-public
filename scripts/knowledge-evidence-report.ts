#!/usr/bin/env tsx
import { pathToFileURL } from 'node:url';
import { getLegacyKnowledgeEvidenceReport } from '../packages/db/src/dal/knowledge';
import type { LegacyKnowledgeEvidenceReport } from '../packages/db/src/dal/knowledge';
import { loadRootEnv } from './lib/load-root-env.mjs';

loadRootEnv();

function formatDate(value: Date | null): string {
	return value ? value.toISOString() : 'n/a';
}

function section(title: string): string {
	return `\n${title}\n${'-'.repeat(title.length)}`;
}

export function renderLegacyKnowledgeEvidenceReport(report: LegacyKnowledgeEvidenceReport): string {
	const lines: string[] = [
		'Knowledge Evidence Legacy Backfill Report (dry run)',
		'===================================================',
		'No data was written.',
		'',
		`Total knowledge_contacts rows: ${report.totalKnowledgeContactRows}`,
		`Rows without matching knowledge_evidence: ${report.rowsWithoutEvidence}`,
	];

	lines.push(section('By Workspace'));
	if (report.byWorkspace.length === 0) {
		lines.push('No knowledge contact rows found.');
	} else {
		for (const row of report.byWorkspace) {
			lines.push(
				`${row.workspaceId}: ${row.rowsWithoutEvidence}/${row.totalKnowledgeContactRows} missing evidence`,
			);
		}
	}

	lines.push(section('By Node Type'));
	if (report.byNodeType.length === 0) {
		lines.push('No node type gaps found.');
	} else {
		for (const row of report.byNodeType) {
			lines.push(
				`${row.nodeType}: ${row.rowsWithoutEvidence}/${row.totalKnowledgeContactRows} missing evidence`,
			);
		}
	}

	lines.push(section('Top Nodes Missing Evidence'));
	if (report.topNodesMissingEvidence.length === 0) {
		lines.push('No nodes missing evidence.');
	} else {
		for (const row of report.topNodesMissingEvidence) {
			lines.push(
				`${row.nodeId} (${row.nodeType}, workspace=${row.workspaceId}): ` +
					`${row.rowsWithoutEvidence} links, aggregate evidence=${row.aggregateEvidenceCount}, ` +
					`latest=${formatDate(row.latestLegacyEvidenceAt)}`,
			);
		}
	}

	lines.push(section('Top Contacts Missing Evidence'));
	if (report.topContactsMissingEvidence.length === 0) {
		lines.push('No contacts missing evidence.');
	} else {
		for (const row of report.topContactsMissingEvidence) {
			lines.push(
				`${row.contactId} (workspace=${row.workspaceId}): ` +
					`${row.rowsWithoutEvidence} links, aggregate evidence=${row.aggregateEvidenceCount}, ` +
					`latest=${formatDate(row.latestLegacyEvidenceAt)}`,
			);
		}
	}

	lines.push(section('Recommended Next Action'));
	lines.push(report.recommendedNextAction);

	return lines.join('\n');
}

export async function main() {
	const report = await getLegacyKnowledgeEvidenceReport();
	console.log(renderLegacyKnowledgeEvidenceReport(report));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error('[knowledge-evidence-report] Failed:', (error as Error).message);
		process.exit(1);
	});
}
