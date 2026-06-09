#!/usr/bin/env tsx
import { pathToFileURL } from 'node:url';
import type { SealedEnvelope } from '@repo/crypto';
import {
	and,
	db,
	eq,
	inArray,
	knowledgeEvidence,
	listEvidenceForKnowledgeNodes,
	listKnowledgeNodes,
	workspaces,
} from '@repo/db';
import { classifyKnowledgeEvidenceQuality } from '@repo/shared';
import { loadRootEnv } from './lib/load-root-env.mjs';

loadRootEnv();

interface CliOptions {
	write: boolean;
	demoteWeak: boolean;
	workspaceId?: string;
}

interface EvidenceQualityAuditResult {
	workspaceId: string;
	nodeCount: number;
	evidenceRowsScanned: number;
	directEvidenceRows: number;
	possibleEvidenceRows: number;
	weakEvidenceRows: number;
	weakRowsDemoted: number;
	writeMode: boolean;
}

function parseArgs(argv: string[]): CliOptions {
	const options: CliOptions = { write: false, demoteWeak: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--write') {
			options.write = true;
			continue;
		}
		if (arg === '--demote-weak') {
			options.demoteWeak = true;
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

function parseKmsContext(value: unknown): Record<string, string> {
	if (typeof value === 'string') return JSON.parse(value) as Record<string, string>;
	return value as Record<string, string>;
}

async function getWorkspaceEnvelope(workspaceId: string): Promise<SealedEnvelope> {
	const rows = await db
		.select({
			encryptedWrk: workspaces.encryptedWrk,
			kmsContext: workspaces.kmsContext,
			wrkVersion: workspaces.wrkVersion,
		})
		.from(workspaces)
		.where(eq(workspaces.id, workspaceId))
		.limit(1);

	const row = rows[0];
	if (!row) throw new Error(`Workspace not found: ${workspaceId}`);
	return {
		encryptedWrk: Buffer.from(row.encryptedWrk, 'base64'),
		kmsContext: parseKmsContext(row.kmsContext),
		wrkVersion: row.wrkVersion,
	};
}

function topicTerms(node: { name: string; displayName: string }): string[] {
	return [node.name, node.displayName].map((term) => term.trim()).filter(Boolean);
}

async function demoteWeakEvidenceRows(workspaceId: string, evidenceIds: string[]): Promise<number> {
	let demoted = 0;
	for (let i = 0; i < evidenceIds.length; i += 100) {
		const batch = evidenceIds.slice(i, i + 100);
		await db
			.update(knowledgeEvidence)
			.set({
				evidenceKind: 'inferred_weak',
				messageId: null,
				snippet: null,
				occurredAt: null,
			})
			.where(
				and(inArray(knowledgeEvidence.id, batch), eq(knowledgeEvidence.workspaceId, workspaceId)),
			);
		demoted += batch.length;
	}
	return demoted;
}

export function renderEvidenceQualityAuditResult(result: EvidenceQualityAuditResult): string {
	return [
		'Knowledge Evidence Quality Audit',
		'================================',
		`Workspace: ${result.workspaceId}`,
		`Mode: ${result.writeMode ? 'write' : 'dry-run'}`,
		'',
		`Nodes scanned: ${result.nodeCount}`,
		`Evidence rows scanned: ${result.evidenceRowsScanned}`,
		`Direct source rows: ${result.directEvidenceRows}`,
		`Possible connection rows: ${result.possibleEvidenceRows}`,
		`Weak/stale rows: ${result.weakEvidenceRows}`,
		`Weak rows demoted: ${result.weakRowsDemoted}`,
		'',
		'No snippets, node names, contact names, or message text were printed.',
	].join('\n');
}

export async function runEvidenceQualityAudit(
	workspaceId: string,
	options: Pick<CliOptions, 'write' | 'demoteWeak'>,
): Promise<EvidenceQualityAuditResult> {
	const envelope = await getWorkspaceEnvelope(workspaceId);
	const nodes = await listKnowledgeNodes(workspaceId, { limit: 10_000 }, envelope);
	const termsByNode = new Map(nodes.map((node) => [node.id, topicTerms(node)]));
	const evidenceRows = await listEvidenceForKnowledgeNodes(
		workspaceId,
		nodes.map((node) => node.id),
		envelope,
	);

	const weakEvidenceIds: string[] = [];
	const result: EvidenceQualityAuditResult = {
		workspaceId,
		nodeCount: nodes.length,
		evidenceRowsScanned: evidenceRows.length,
		directEvidenceRows: 0,
		possibleEvidenceRows: 0,
		weakEvidenceRows: 0,
		weakRowsDemoted: 0,
		writeMode: options.write,
	};

	for (const evidence of evidenceRows) {
		const quality = classifyKnowledgeEvidenceQuality(
			evidence,
			termsByNode.get(evidence.knowledgeNodeId) ?? [],
		).quality;
		if (quality === 'direct_source') {
			result.directEvidenceRows++;
		} else if (quality === 'possible_connection') {
			result.possibleEvidenceRows++;
		} else {
			result.weakEvidenceRows++;
			weakEvidenceIds.push(evidence.id);
		}
	}

	if (options.write && options.demoteWeak && weakEvidenceIds.length > 0) {
		result.weakRowsDemoted = await demoteWeakEvidenceRows(workspaceId, weakEvidenceIds);
	}

	return result;
}

export async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (!options.workspaceId) throw new Error('--workspace-id is required');
	if (options.demoteWeak && !options.write) {
		throw new Error('--demote-weak requires --write');
	}

	const result = await runEvidenceQualityAudit(options.workspaceId, options);
	console.log(renderEvidenceQualityAuditResult(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error('[knowledge-evidence-quality-audit] Failed:', (error as Error).message);
		process.exit(1);
	});
}
