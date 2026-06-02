#!/usr/bin/env tsx
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { loadRootEnv } from './lib/load-root-env.mjs';

loadRootEnv();

type PlainFieldKind = 'text' | 'text_array' | 'jsonb';

interface PlainFieldSpec {
	table: string;
	column: string;
	kind: PlainFieldKind;
	workspaceColumn?: string;
	description: string;
}

interface VectorFieldSpec {
	table: string;
	column: string;
	workspaceColumn?: string;
	description: string;
}

interface AuditOptions {
	workspaceId?: string;
	terms: string[];
	json: boolean;
}

interface PlainFieldRow {
	tableName: string;
	columnName: string;
	id: string;
	workspaceId: string | null;
	value: unknown;
}

interface AuditViolation {
	table: string;
	column: string;
	id: string;
	workspaceId: string | null;
	reason: string;
}

interface ColumnInfo {
	tableName: string;
	columnName: string;
	dataType: string;
	udtName: string;
}

interface VectorFieldSummary {
	table: string;
	column: string;
	description: string;
	columnType: string;
	populatedRows: number;
}

const FORBIDDEN_JSON_KEYS = new Set([
	'contactName',
	'content',
	'email',
	'evidenceQuote',
	'handle',
	'inputContext',
	'matchedTerm',
	'mentionSpan',
	'messageText',
	'normalizedName',
	'phone',
	'quote',
	'rawContent',
	'rawText',
	'snippet',
	'sourceMention',
	'telegramHandle',
	'telegramUsername',
	'text',
	'username',
]);

const SENSITIVE_TEXT_PATTERNS = [
	{
		name: 'email-shaped text',
		pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
	},
	{
		name: 'phone-shaped text',
		pattern: /\b(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})\b|\+\d{7,15}\b/,
	},
	{
		name: 'Telegram-handle-shaped text',
		pattern: /(?<![\w.])@[A-Za-z][A-Za-z0-9_]{4,31}\b(?![/.-])/,
	},
	{
		name: 'wallet-address-shaped text',
		pattern: /\b0x[a-fA-F0-9]{40}\b|\b(?:bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}\b/i,
	},
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_LIKE_RE = /^\d{4}-\d{2}-\d{2}(?:T[\d:.+-Z]+)?$/;

const PLAIN_FIELD_SPECS: PlainFieldSpec[] = [
	{
		table: 'memories',
		column: 'content_sanitized',
		kind: 'text',
		workspaceColumn: 'workspace_id',
		description: 'masked memory text used for embeddings and recall',
	},
	{
		table: 'memories',
		column: 'metadata',
		kind: 'jsonb',
		workspaceColumn: 'workspace_id',
		description: 'memory metadata',
	},
	{
		table: 'semantic_cache',
		column: 'masked_query',
		kind: 'text',
		workspaceColumn: 'workspace_id',
		description: 'masked semantic-cache query',
	},
	{
		table: 'semantic_cache',
		column: 'tools_used',
		kind: 'text_array',
		workspaceColumn: 'workspace_id',
		description: 'semantic-cache tool labels',
	},
	{
		table: 'knowledge_nodes',
		column: 'aliases',
		kind: 'text_array',
		workspaceColumn: 'workspace_id',
		description: 'knowledge node aliases',
	},
	{
		table: 'knowledge_nodes',
		column: 'metadata',
		kind: 'jsonb',
		workspaceColumn: 'workspace_id',
		description: 'knowledge node metadata',
	},
	{
		table: 'knowledge_evidence',
		column: 'metadata',
		kind: 'jsonb',
		workspaceColumn: 'workspace_id',
		description: 'knowledge evidence metadata',
	},
	{
		table: 'outcomes',
		column: 'context_labels',
		kind: 'text_array',
		workspaceColumn: 'workspace_id',
		description: 'PII-free labels used for outcome embeddings',
	},
	{
		table: 'user_decisions',
		column: 'interaction_metadata',
		kind: 'jsonb',
		workspaceColumn: 'workspace_id',
		description: 'decision graph metadata',
	},
	{
		table: 'golden_dataset',
		column: 'input_context',
		kind: 'text',
		workspaceColumn: 'workspace_id',
		description: 'learning example input context',
	},
	{
		table: 'golden_dataset',
		column: 'model_prediction',
		kind: 'jsonb',
		workspaceColumn: 'workspace_id',
		description: 'learning example model output',
	},
	{
		table: 'golden_dataset',
		column: 'prediction_metadata',
		kind: 'jsonb',
		workspaceColumn: 'workspace_id',
		description: 'learning example metadata',
	},
	{
		table: 'golden_dataset',
		column: 'corrected_output',
		kind: 'jsonb',
		workspaceColumn: 'workspace_id',
		description: 'learning example corrected output',
	},
	{
		table: 'golden_dataset',
		column: 'correction_reasoning',
		kind: 'text',
		workspaceColumn: 'workspace_id',
		description: 'learning example correction notes',
	},
	{
		table: 'golden_dataset',
		column: 'tags',
		kind: 'text_array',
		workspaceColumn: 'workspace_id',
		description: 'learning example tags',
	},
	{
		table: 'correction_diffs',
		column: 'description',
		kind: 'text',
		workspaceColumn: 'workspace_id',
		description: 'sanitized correction-diff description',
	},
	{
		table: 'semantic_patterns',
		column: 'pattern_text',
		kind: 'text',
		description: 'clustered correction pattern text',
	},
];

const VECTOR_FIELD_SPECS: VectorFieldSpec[] = [
	{
		table: 'memories',
		column: 'embedding',
		workspaceColumn: 'workspace_id',
		description: 'masked memory embedding',
	},
	{
		table: 'semantic_cache',
		column: 'query_embedding',
		workspaceColumn: 'workspace_id',
		description: 'masked query embedding',
	},
	{
		table: 'knowledge_nodes',
		column: 'embedding',
		workspaceColumn: 'workspace_id',
		description: 'knowledge node embedding',
	},
	{
		table: 'commitments',
		column: 'embedding',
		workspaceColumn: 'workspace_id',
		description: 'masked commitment embedding',
	},
	{
		table: 'outcomes',
		column: 'embedding',
		workspaceColumn: 'workspace_id',
		description: 'context-label embedding',
	},
	{
		table: 'user_decisions',
		column: 'embedding',
		workspaceColumn: 'workspace_id',
		description: 'decision graph embedding',
	},
	{
		table: 'golden_dataset',
		column: 'input_embedding',
		workspaceColumn: 'workspace_id',
		description: 'learning example input embedding',
	},
	{
		table: 'correction_diffs',
		column: 'mistake_embedding',
		workspaceColumn: 'workspace_id',
		description: 'correction-diff embedding',
	},
	{
		table: 'semantic_patterns',
		column: 'embedding',
		description: 'semantic pattern embedding',
	},
];

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
			for (const term of argv[++i]?.split(',') ?? []) {
				const normalized = term.trim().toLowerCase();
				if (normalized) terms.add(normalized);
			}
		}
	}

	for (const envName of ['DERIVED_DATA_SECURITY_AUDIT_TERMS', 'KG_SECURITY_AUDIT_TERMS']) {
		for (const term of process.env[envName]?.split(',') ?? []) {
			const normalized = term.trim().toLowerCase();
			if (normalized) terms.add(normalized);
		}
	}

	return { workspaceId, terms: [...terms], json };
}

function quoteIdent(identifier: string): string {
	return `"${identifier.replace(/"/g, '""')}"`;
}

function columnKey(table: string, column: string): string {
	return `${table}.${column}`;
}

function collectScalarTexts(value: unknown): string[] {
	if (value === null || value === undefined) return [];
	if (Array.isArray(value)) return value.flatMap((item) => collectScalarTexts(item));
	if (typeof value === 'object') {
		return Object.values(value as Record<string, unknown>).flatMap((child) =>
			collectScalarTexts(child),
		);
	}
	return [String(value)];
}

function findForbiddenJsonKeys(
	value: unknown,
	path: string[] = [],
): Array<{ path: string; key: string }> {
	if (!value || typeof value !== 'object') return [];
	if (Array.isArray(value)) {
		return value.flatMap((item, index) => findForbiddenJsonKeys(item, [...path, String(index)]));
	}

	const findings: Array<{ path: string; key: string }> = [];
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		const childPath = [...path, key];
		if (FORBIDDEN_JSON_KEYS.has(key)) {
			findings.push({ path: childPath.join('.'), key });
		}
		findings.push(...findForbiddenJsonKeys(child, childPath));
	}
	return findings;
}

function containsAnyTerm(value: string, terms: string[]): boolean {
	if (terms.length === 0) return false;
	const normalized = value.toLowerCase();
	return terms.some((term) => normalized.includes(term));
}

function shouldIgnorePatternMatch(patternName: string, value: string): boolean {
	if (patternName !== 'phone-shaped text') return false;
	return UUID_RE.test(value) || ISO_DATE_LIKE_RE.test(value);
}

async function listColumns(sql: postgres.Sql): Promise<Map<string, ColumnInfo>> {
	const rows = await sql<ColumnInfo[]>`
		SELECT
			table_name AS "tableName",
			column_name AS "columnName",
			data_type AS "dataType",
			udt_name AS "udtName"
		FROM information_schema.columns
		WHERE table_schema = 'public'
	`;

	return new Map(rows.map((row) => [columnKey(row.tableName, row.columnName), row]));
}

async function collectPlainFieldRows(
	sql: postgres.Sql,
	spec: PlainFieldSpec,
	columns: Map<string, ColumnInfo>,
	workspaceId?: string,
): Promise<PlainFieldRow[]> {
	const idColumn = columns.has(columnKey(spec.table, 'id')) ? 'id' : undefined;
	if (!idColumn) return [];

	const hasWorkspaceColumn = Boolean(
		spec.workspaceColumn && columns.has(columnKey(spec.table, spec.workspaceColumn)),
	);
	const workspaceSelect = hasWorkspaceColumn
		? `${quoteIdent(spec.workspaceColumn ?? '')}::text`
		: 'NULL::text';
	const workspaceFilter =
		workspaceId && hasWorkspaceColumn
			? `AND ${quoteIdent(spec.workspaceColumn ?? '')} = $1::uuid`
			: '';
	const params = workspaceId && hasWorkspaceColumn ? [workspaceId] : [];

	return sql.unsafe(
		`
			SELECT
				'${spec.table}' AS "tableName",
				'${spec.column}' AS "columnName",
				${quoteIdent(idColumn)}::text AS id,
				${workspaceSelect} AS "workspaceId",
				${quoteIdent(spec.column)} AS value
			FROM ${quoteIdent(spec.table)}
			WHERE ${quoteIdent(spec.column)} IS NOT NULL
			${workspaceFilter}
		`,
		params,
	);
}

async function summarizeVectorField(
	sql: postgres.Sql,
	spec: VectorFieldSpec,
	columns: Map<string, ColumnInfo>,
	workspaceId?: string,
): Promise<VectorFieldSummary | null> {
	const column = columns.get(columnKey(spec.table, spec.column));
	if (!column) return null;

	const hasWorkspaceColumn = Boolean(
		spec.workspaceColumn && columns.has(columnKey(spec.table, spec.workspaceColumn)),
	);
	const workspaceFilter =
		workspaceId && hasWorkspaceColumn
			? `AND ${quoteIdent(spec.workspaceColumn ?? '')} = $1::uuid`
			: '';
	const params = workspaceId && hasWorkspaceColumn ? [workspaceId] : [];

	const rows = await sql.unsafe<{ count: number | string }[]>(
		`
			SELECT count(*)::int AS count
			FROM ${quoteIdent(spec.table)}
			WHERE ${quoteIdent(spec.column)} IS NOT NULL
			${workspaceFilter}
		`,
		params,
	);

	return {
		table: spec.table,
		column: spec.column,
		description: spec.description,
		columnType: column.udtName || column.dataType,
		populatedRows: Number(rows[0]?.count ?? 0),
	};
}

function scanPlainFieldRow(
	row: PlainFieldRow,
	spec: PlainFieldSpec,
	terms: string[],
): AuditViolation[] {
	const violations: AuditViolation[] = [];
	const valueTexts = collectScalarTexts(row.value);

	for (const pattern of SENSITIVE_TEXT_PATTERNS) {
		for (const valueText of valueTexts) {
			if (!pattern.pattern.test(valueText) || shouldIgnorePatternMatch(pattern.name, valueText)) {
				continue;
			}
			violations.push({
				table: row.tableName,
				column: row.columnName,
				id: row.id,
				workspaceId: row.workspaceId,
				reason: `${spec.description} contains ${pattern.name}`,
			});
			break;
		}
	}

	if (valueTexts.some((valueText) => containsAnyTerm(valueText, terms))) {
		violations.push({
			table: row.tableName,
			column: row.columnName,
			id: row.id,
			workspaceId: row.workspaceId,
			reason: `${spec.description} contains an audit term`,
		});
	}

	if (spec.kind === 'jsonb') {
		for (const finding of findForbiddenJsonKeys(row.value)) {
			violations.push({
				table: row.tableName,
				column: row.columnName,
				id: row.id,
				workspaceId: row.workspaceId,
				reason: `${spec.description} contains forbidden JSON key "${finding.key}" at ${finding.path}`,
			});
		}
	}

	return violations;
}

export async function auditDerivedDataSecurity(options: AuditOptions) {
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) throw new Error('DATABASE_URL is not set');

	const sql = postgres(databaseUrl, { prepare: false, max: 1 });
	try {
		const columns = await listColumns(sql);
		const presentPlainSpecs = PLAIN_FIELD_SPECS.filter((spec) =>
			columns.has(columnKey(spec.table, spec.column)),
		);
		const presentVectorSpecs = VECTOR_FIELD_SPECS.filter((spec) =>
			columns.has(columnKey(spec.table, spec.column)),
		);

		let plainRowsChecked = 0;
		const violations: AuditViolation[] = [];
		for (const spec of presentPlainSpecs) {
			const rows = await collectPlainFieldRows(sql, spec, columns, options.workspaceId);
			plainRowsChecked += rows.length;
			for (const row of rows) {
				violations.push(...scanPlainFieldRow(row, spec, options.terms));
			}
		}

		const vectorFields: VectorFieldSummary[] = [];
		for (const spec of presentVectorSpecs) {
			const summary = await summarizeVectorField(sql, spec, columns, options.workspaceId);
			if (summary) vectorFields.push(summary);
		}

		return {
			plainColumnsChecked: presentPlainSpecs.length,
			plainRowsChecked,
			vectorColumnsChecked: vectorFields.length,
			vectorFields,
			violations,
		};
	} finally {
		await sql.end();
	}
}

function renderReport(result: Awaited<ReturnType<typeof auditDerivedDataSecurity>>): string {
	const vectorRows = result.vectorFields.reduce((sum, field) => sum + field.populatedRows, 0);
	const lines = [
		'Derived Data Security Audit',
		'===========================',
		`Plain derived columns checked: ${result.plainColumnsChecked}`,
		`Plain derived rows checked: ${result.plainRowsChecked}`,
		`Vector columns checked: ${result.vectorColumnsChecked}`,
		`Populated vector rows counted: ${vectorRows}`,
		`Violations: ${result.violations.length}`,
	];

	if (result.vectorFields.length > 0) {
		lines.push('', 'Vector surfaces');
		for (const field of result.vectorFields) {
			lines.push(
				`- ${field.table}.${field.column}: ${field.populatedRows} rows (${field.columnType})`,
			);
		}
	}

	if (result.violations.length > 0) {
		lines.push('', 'Violations');
		for (const violation of result.violations.slice(0, 50)) {
			lines.push(
				`- ${violation.table}.${violation.column} id=${violation.id} workspace=${violation.workspaceId ?? 'n/a'}: ${violation.reason}`,
			);
		}
		if (result.violations.length > 50) {
			lines.push(`... ${result.violations.length - 50} more`);
		}
	} else {
		lines.push('', 'No raw PII-shaped derived-data leaks detected.');
	}

	return lines.join('\n');
}

export async function main() {
	const options = parseArgs(process.argv.slice(2));
	const result = await auditDerivedDataSecurity(options);
	if (options.json) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		console.log(renderReport(result));
	}
	if (result.violations.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error('[derived-data-security-audit] Failed:', (error as Error).message);
		process.exit(1);
	});
}
