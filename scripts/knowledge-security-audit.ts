#!/usr/bin/env tsx
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { loadRootEnv } from './lib/load-root-env.mjs';

loadRootEnv();

const DEFAULT_MIN_CIPHERTEXT_LENGTH = 40;
const BASE64_CIPHERTEXT_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const FORBIDDEN_METADATA_KEYS = new Set([
	'evidenceQuote',
	'matchedTerm',
	'mentionSpan',
	'messageText',
	'normalizedName',
	'quote',
	'rawText',
	'snippet',
	'sourceMention',
	'text',
]);

interface AuditOptions {
	workspaceId?: string;
	terms: string[];
	json: boolean;
}

interface AuditViolation {
	table: string;
	id: string;
	workspaceId: string;
	field: string;
	reason: string;
}

interface EncryptedColumnRow {
	tableName: string;
	id: string;
	workspaceId: string;
	columnName: string;
	value: string | null;
}

interface MetadataRow {
	tableName: string;
	id: string;
	workspaceId: string;
	metadata: Record<string, unknown> | null;
}

function parseArgs(argv: string[]): AuditOptions {
	let workspaceId: string | undefined;
	let json = false;
	const terms = new Set<string>();
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--json') {
			json = true;
			continue;
		}
		if (arg === '--workspace') {
			workspaceId = argv[++i];
			continue;
		}
		if (arg === '--term') {
			const value = argv[++i];
			if (value) terms.add(value.toLowerCase());
			continue;
		}
		if (arg === '--terms') {
			const value = argv[++i];
			for (const term of value?.split(',') ?? []) {
				const normalized = term.trim().toLowerCase();
				if (normalized) terms.add(normalized);
			}
		}
	}

	for (const term of process.env.KG_SECURITY_AUDIT_TERMS?.split(',') ?? []) {
		const normalized = term.trim().toLowerCase();
		if (normalized) terms.add(normalized);
	}

	return { workspaceId, terms: [...terms], json };
}

function isCiphertextShaped(value: string): boolean {
	return value.length >= DEFAULT_MIN_CIPHERTEXT_LENGTH && BASE64_CIPHERTEXT_RE.test(value);
}

function findForbiddenMetadataKeys(
	value: unknown,
	path: string[] = [],
): Array<{ path: string; key: string }> {
	if (!value || typeof value !== 'object') return [];
	if (Array.isArray(value)) {
		return value.flatMap((item, index) =>
			findForbiddenMetadataKeys(item, [...path, String(index)]),
		);
	}

	const findings: Array<{ path: string; key: string }> = [];
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		const childPath = [...path, key];
		if (FORBIDDEN_METADATA_KEYS.has(key)) {
			findings.push({ path: childPath.join('.'), key });
		}
		findings.push(...findForbiddenMetadataKeys(child, childPath));
	}
	return findings;
}

function containsAnyTerm(value: string, terms: string[]): string | undefined {
	const normalized = value.toLowerCase();
	return terms.find((term) => normalized.includes(term));
}

async function collectEncryptedColumnRows(
	sql: postgres.Sql,
	workspaceId?: string,
): Promise<EncryptedColumnRow[]> {
	return sql.unsafe(
		`
			SELECT *
			FROM (
				SELECT
					'knowledge_nodes' AS "tableName",
					id::text AS id,
					workspace_id::text AS "workspaceId",
					'name' AS "columnName",
					name AS value
				FROM knowledge_nodes
				WHERE ($1::uuid IS NULL OR workspace_id = $1::uuid)
				UNION ALL
				SELECT
					'knowledge_nodes' AS "tableName",
					id::text AS id,
					workspace_id::text AS "workspaceId",
					'display_name' AS "columnName",
					display_name AS value
				FROM knowledge_nodes
				WHERE ($1::uuid IS NULL OR workspace_id = $1::uuid)
				UNION ALL
				SELECT
					'knowledge_nodes' AS "tableName",
					id::text AS id,
					workspace_id::text AS "workspaceId",
					'description' AS "columnName",
					description AS value
				FROM knowledge_nodes
				WHERE ($1::uuid IS NULL OR workspace_id = $1::uuid)
				UNION ALL
				SELECT
					'knowledge_evidence' AS "tableName",
					id::text AS id,
					workspace_id::text AS "workspaceId",
					'snippet' AS "columnName",
					snippet AS value
				FROM knowledge_evidence
				WHERE ($1::uuid IS NULL OR workspace_id = $1::uuid)
			) encrypted_columns
			WHERE value IS NOT NULL
		`,
		[workspaceId ?? null],
	);
}

async function collectMetadataRows(
	sql: postgres.Sql,
	workspaceId?: string,
): Promise<MetadataRow[]> {
	return sql.unsafe(
		`
			SELECT
				'knowledge_nodes' AS "tableName",
				id::text AS id,
				workspace_id::text AS "workspaceId",
				metadata
			FROM knowledge_nodes
			WHERE metadata IS NOT NULL
				AND ($1::uuid IS NULL OR workspace_id = $1::uuid)
			UNION ALL
			SELECT
				'knowledge_evidence' AS "tableName",
				id::text AS id,
				workspace_id::text AS "workspaceId",
				metadata
			FROM knowledge_evidence
			WHERE metadata IS NOT NULL
				AND ($1::uuid IS NULL OR workspace_id = $1::uuid)
		`,
		[workspaceId ?? null],
	);
}

export async function auditKnowledgeSecurity(options: AuditOptions) {
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) throw new Error('DATABASE_URL is not set');
	const sql = postgres(databaseUrl, { prepare: false, max: 1 });
	try {
		const encryptedRows = await collectEncryptedColumnRows(sql, options.workspaceId);
		const metadataRows = await collectMetadataRows(sql, options.workspaceId);
		const violations: AuditViolation[] = [];

		for (const row of encryptedRows) {
			if (!row.value) continue;
			if (!isCiphertextShaped(row.value)) {
				violations.push({
					table: row.tableName,
					id: row.id,
					workspaceId: row.workspaceId,
					field: row.columnName,
					reason: 'encrypted column is not ciphertext-shaped',
				});
			}
			const term = containsAnyTerm(row.value, options.terms);
			if (term) {
				violations.push({
					table: row.tableName,
					id: row.id,
					workspaceId: row.workspaceId,
					field: row.columnName,
					reason: `encrypted column contains audit term "${term}"`,
				});
			}
		}

		for (const row of metadataRows) {
			const metadataText = JSON.stringify(row.metadata ?? {});
			for (const finding of findForbiddenMetadataKeys(row.metadata)) {
				violations.push({
					table: row.tableName,
					id: row.id,
					workspaceId: row.workspaceId,
					field: `metadata.${finding.path}`,
					reason: `forbidden metadata key "${finding.key}"`,
				});
			}
			const term = containsAnyTerm(metadataText, options.terms);
			if (term) {
				violations.push({
					table: row.tableName,
					id: row.id,
					workspaceId: row.workspaceId,
					field: 'metadata',
					reason: `metadata contains audit term "${term}"`,
				});
			}
		}

		return {
			encryptedColumnsChecked: encryptedRows.length,
			metadataRowsChecked: metadataRows.length,
			violations,
		};
	} finally {
		await sql.end();
	}
}

function renderReport(result: Awaited<ReturnType<typeof auditKnowledgeSecurity>>): string {
	const lines = [
		'Knowledge Security Audit',
		'========================',
		`Encrypted column values checked: ${result.encryptedColumnsChecked}`,
		`Metadata rows checked: ${result.metadataRowsChecked}`,
		`Violations: ${result.violations.length}`,
	];
	if (result.violations.length > 0) {
		lines.push('', 'Violations');
		for (const violation of result.violations.slice(0, 50)) {
			lines.push(
				`- ${violation.table}.${violation.field} id=${violation.id} workspace=${violation.workspaceId}: ${violation.reason}`,
			);
		}
		if (result.violations.length > 50) {
			lines.push(`... ${result.violations.length - 50} more`);
		}
	} else {
		lines.push('', 'No plaintext-shaped knowledge leaks detected.');
	}
	return lines.join('\n');
}

export async function main() {
	const options = parseArgs(process.argv.slice(2));
	const result = await auditKnowledgeSecurity(options);
	if (options.json) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		console.log(renderReport(result));
	}
	if (result.violations.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error('[knowledge-security-audit] Failed:', (error as Error).message);
		process.exit(1);
	});
}
