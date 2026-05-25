/**
 * encrypted-column-guard.test.ts
 *
 * Static analysis guard that detects `db.execute()` and `sql.raw()` call sites
 * referencing encrypted columns. Raw SQL bypasses Drizzle's customType
 * encryption layer — reads return ciphertext, writes store plaintext.
 *
 * How it works:
 * 1. Scans schema files to build the encrypted column inventory
 * 2. Finds all db.execute()/sql.raw() call sites in production code
 * 3. Checks if the surrounding SQL references encrypted column names
 * 4. Reports violations (with allowlist for intentional bypasses)
 *
 * To add a new allowlist entry, add to ALLOWLIST below with a comment
 * explaining why the bypass is safe.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// ── Configuration ──────────────────────────────────────────────────────────

const DB_PKG_ROOT = join(__dirname, '..', '..'); // packages/db
const REPO_ROOT = join(DB_PKG_ROOT, '..', '..'); // repo root
const SCHEMA_DIR = join(DB_PKG_ROOT, 'src', 'schema');

/** Directories to scan for db.execute()/sql.raw() usage */
const SCAN_DIRS = [
	join(REPO_ROOT, 'packages', 'db', 'src', 'dal'),
	join(REPO_ROOT, 'apps', 'worker', 'src'),
	join(REPO_ROOT, 'apps', 'web', 'src'),
];

/** Paths to EXCLUDE from scanning (scripts, tests, migrations) */
const EXCLUDE_PATTERNS = [
	'__tests__',
	'__mocks__',
	'.test.',
	'.spec.',
	'/scripts/',
	'/drizzle/',
	'/node_modules/',
];

/**
 * Allowlist for intentional db.execute() usage on encrypted columns.
 * Key: relative file path from repo root
 * Value: { columns: string[], reason: string }
 */
const ALLOWLIST: Record<string, { columns: string[]; reason: string }[]> = {
	// Session write — pre-encrypted with KMS KEK before raw SQL INSERT
	'apps/web/src/lib/auth-telegram.ts': [
		{
			columns: ['access_token'],
			reason:
				'Pre-encrypted with per-user KMS KEK before write. Intentional bypass of Drizzle encryptedSessionText toDriver().',
		},
	],
	// Rotation queue reads encrypted columns to re-encrypt with new keys
	'apps/worker/src/queues/rotation.ts': [
		{
			columns: ['access_token'],
			reason: 'Key rotation reads ciphertext to re-encrypt with new KEK. Intentional bypass.',
		},
	],
};

// ── Step 1: Extract encrypted columns from schema ──────────────────────────

interface EncryptedColumn {
	table: string; // SQL table name from pgTable('name') declaration
	column: string; // DB column name (e.g., "first_name")
	type: 'encryptedText' | 'encryptedSessionText';
}

/**
 * Extract encrypted columns by parsing pgTable declarations and associating
 * each encrypted column with its nearest preceding table. Handles multi-table
 * schema files (e.g., follow-up-plans.ts has both `cadences` and `cadence_steps`).
 */
function extractEncryptedColumns(): EncryptedColumn[] {
	const columns: EncryptedColumn[] = [];
	const schemaFiles = readdirSync(SCHEMA_DIR).filter(
		(f) => f.endsWith('.ts') && f !== 'index.ts' && f !== 'custom-types.ts',
	);

	for (const file of schemaFiles) {
		const content = readFileSync(join(SCHEMA_DIR, file), 'utf-8');

		// Find all pgTable declarations with their positions
		// Handles both inline pgTable('name', ...) and multi-line pgTable(\n\t'name', ...)
		const tableDecls: { name: string; pos: number }[] = [];
		const tableRegex = /pgTable\(\s*['"](\w+)['"]/g;
		let tableMatch = tableRegex.exec(content);
		while (tableMatch !== null) {
			tableDecls.push({ name: tableMatch[1], pos: tableMatch.index });
			tableMatch = tableRegex.exec(content);
		}

		if (tableDecls.length === 0) continue;

		// Find all encrypted column declarations with their positions
		const colRegex = /(encryptedText|encryptedSessionText)\(['"](\w+)['"]\)/g;
		let colMatch = colRegex.exec(content);
		while (colMatch !== null) {
			// Associate with the nearest preceding pgTable declaration
			let tableName = tableDecls[0].name;
			for (const decl of tableDecls) {
				if (decl.pos <= colMatch.index) {
					tableName = decl.name;
				} else {
					break;
				}
			}

			columns.push({
				table: tableName,
				column: colMatch[2],
				type: colMatch[1] as EncryptedColumn['type'],
			});
			colMatch = colRegex.exec(content);
		}
	}

	return columns;
}

// ── Step 2: Find db.execute()/sql.raw() call sites ────────────────────────

interface CallSite {
	file: string; // absolute path
	relFile: string; // relative to repo root
	line: number;
	sqlContext: string; // surrounding SQL content (for column matching)
	isWrite: boolean; // UPDATE/INSERT/DELETE detected
}

function walkDir(dir: string): string[] {
	const files: string[] = [];
	try {
		for (const entry of readdirSync(dir)) {
			const full = join(dir, entry);
			const stat = statSync(full);
			if (stat.isDirectory()) {
				files.push(...walkDir(full));
			} else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
				files.push(full);
			}
		}
	} catch {
		// Directory doesn't exist — skip
	}
	return files;
}

/**
 * Extract the SQL template content from a db.execute(sql`...`) call.
 * Walks forward from the opening backtick to find the matching close.
 * Returns only the SQL content, not surrounding JavaScript code.
 */
function extractSqlTemplate(content: string, startIdx: number): string | null {
	// Find the opening backtick after sql` or sql.raw(`
	const pos = startIdx;
	const backtickIdx = content.indexOf('`', pos);
	const singleQuoteIdx = content.indexOf("'", pos);

	// Use whichever delimiter comes first after the call site
	let closeChar: string;
	let openIdx: number;

	if (backtickIdx >= 0 && (singleQuoteIdx < 0 || backtickIdx < singleQuoteIdx)) {
		closeChar = '`';
		openIdx = backtickIdx;
	} else if (singleQuoteIdx >= 0) {
		closeChar = "'";
		openIdx = singleQuoteIdx;
	} else {
		return null;
	}

	// Find matching close (skip template expressions ${...})
	let depth = 0;
	for (let i = openIdx + 1; i < content.length; i++) {
		const ch = content[i];
		if (ch === '$' && content[i + 1] === '{' && closeChar === '`') {
			depth++;
			i++; // skip {
		} else if (ch === '}' && depth > 0) {
			depth--;
		} else if (ch === closeChar && depth === 0) {
			return content.slice(openIdx + 1, i);
		}
	}

	return null;
}

function findCallSites(): CallSite[] {
	const sites: CallSite[] = [];

	for (const dir of SCAN_DIRS) {
		const files = walkDir(dir);

		for (const file of files) {
			const relFile = relative(REPO_ROOT, file);

			// Skip excluded paths
			if (EXCLUDE_PATTERNS.some((p) => relFile.includes(p))) continue;

			const content = readFileSync(file, 'utf-8');

			// Find all db.execute( and sql.raw( call sites
			const callRegex = /db\.execute\s*\(|sql\.raw\s*\(/g;
			let match = callRegex.exec(content);

			while (match !== null) {
				const lineNum = content.slice(0, match.index).split('\n').length;
				const sqlTemplate = extractSqlTemplate(content, match.index + match[0].length);

				if (!sqlTemplate) {
					match = callRegex.exec(content);
					continue;
				}

				const sqlLower = sqlTemplate.toLowerCase();
				const isWrite = /\b(update\s|insert\s|delete\s)/i.test(sqlLower);

				sites.push({
					file,
					relFile,
					line: lineNum,
					sqlContext: sqlLower,
					isWrite,
				});
				match = callRegex.exec(content);
			}
		}
	}

	return sites;
}

// ── Step 3: Check for violations ───────────────────────────────────────────

interface Violation {
	file: string;
	line: number;
	column: string;
	table: string;
	type: EncryptedColumn['type'];
	isWrite: boolean;
	severity: 'CRITICAL' | 'MEDIUM';
}

function isAllowlisted(relFile: string, column: string): boolean {
	const entries = ALLOWLIST[relFile];
	if (!entries) return false;
	return entries.some((e) => e.columns.includes(column));
}

/**
 * Check if a column name reference in SQL is a real column reference (not a cast, alias, or type).
 * Filters out patterns like `::text`, `_text`, `text_`, AS alias matches, etc.
 */
function isRealColumnRef(sqlContext: string, colName: string): boolean {
	// Find all matches and check each one
	const pattern = new RegExp(`\\b${colName}\\b`, 'gi');
	let match = pattern.exec(sqlContext);
	let hasRealRef = false;

	while (match !== null) {
		const before = sqlContext.slice(Math.max(0, match.index - 5), match.index);
		const after = sqlContext.slice(match.index + colName.length, match.index + colName.length + 5);

		// Skip ::text type casts
		if (before.endsWith('::')) {
			match = pattern.exec(sqlContext);
			continue;
		}
		// Skip AS <colName> aliases (these are output aliases, not column reads)
		if (/\bas\s*$/i.test(before)) {
			match = pattern.exec(sqlContext);
			continue;
		}
		// Skip if preceded by underscore (part of a longer identifier like content_sanitized)
		if (before.endsWith('_')) {
			match = pattern.exec(sqlContext);
			continue;
		}
		// Skip if followed by underscore (part of content_sanitized)
		if (after.startsWith('_')) {
			match = pattern.exec(sqlContext);
			continue;
		}

		hasRealRef = true;
		break;
	}

	return hasRealRef;
}

function findViolations(columns: EncryptedColumn[], sites: CallSite[]): Violation[] {
	const violations: Violation[] = [];

	// Group columns by their SQL table name (already resolved from pgTable declarations)
	const columnsByTable = new Map<string, EncryptedColumn[]>();
	for (const col of columns) {
		const existing = columnsByTable.get(col.table) ?? [];
		existing.push(col);
		columnsByTable.set(col.table, existing);
	}

	for (const site of sites) {
		// For each table that has encrypted columns, check if the SQL references it
		for (const [tableName, cols] of columnsByTable) {
			const tablePattern = new RegExp(`\\b${tableName}\\b`, 'i');
			if (!tablePattern.test(site.sqlContext)) continue;

			// Check for SELECT * — selects ALL columns including encrypted ones
			const hasSelectStar = /select\s+\*\s+from/i.test(site.sqlContext);
			if (hasSelectStar) {
				for (const col of cols) {
					if (isAllowlisted(site.relFile, col.column)) continue;
					violations.push({
						file: site.relFile,
						line: site.line,
						column: `* (includes ${col.column})`,
						table: col.table,
						type: col.type,
						isWrite: false,
						severity: 'MEDIUM',
					});
				}
				continue; // Already flagged all columns via SELECT *
			}

			// Table is referenced — check if any encrypted column is individually referenced
			for (const col of cols) {
				if (!isRealColumnRef(site.sqlContext, col.column)) continue;

				// Check allowlist
				if (isAllowlisted(site.relFile, col.column)) continue;

				violations.push({
					file: site.relFile,
					line: site.line,
					column: col.column,
					table: col.table,
					type: col.type,
					isWrite: site.isWrite,
					severity: site.isWrite ? 'CRITICAL' : 'MEDIUM',
				});
			}
		}
	}

	return violations;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('encrypted column guard', () => {
	const encryptedColumns = extractEncryptedColumns();
	const callSites = findCallSites();
	const violations = findViolations(encryptedColumns, callSites);

	it('should discover encrypted columns from schema with correct SQL table names', () => {
		const columnNames = encryptedColumns.map((c) => `${c.table}.${c.column}`);
		// Verify table names come from pgTable() declarations, not filenames
		expect(columnNames).toContain('contacts.first_name');
		expect(columnNames).toContain('contacts.phone');
		expect(columnNames).toContain('accounts.access_token');
		expect(columnNames).toContain('memories.content');
		// GUARD-001: Verify tables that differ from filenames are correctly resolved
		expect(columnNames).toContain('user_decisions.raw_content');
		expect(columnNames).toContain('draft_logs.generated_text');
		expect(columnNames).toContain('contact_summaries.summary');
		expect(columnNames).toContain('user_calibrations.role_description');
		expect(columnNames).toContain('contact_relationships.notes');
		// Multi-table schema files
		expect(columnNames).toContain('cadence_steps.prompt');
		expect(encryptedColumns.length).toBeGreaterThan(40);
	});

	it('should find db.execute()/sql.raw() call sites', () => {
		expect(callSites.length).toBeGreaterThan(0);
	});

	it('should have no CRITICAL violations (writes to encrypted columns via raw SQL)', () => {
		const critical = violations.filter((v) => v.severity === 'CRITICAL');
		if (critical.length > 0) {
			const msg = critical
				.map((v) => `  ${v.file}:${v.line} — WRITE to ${v.table}.${v.column} (${v.type})`)
				.join('\n');
			expect.fail(
				`Found ${critical.length} CRITICAL violation(s) — raw SQL writes to encrypted columns:\n${msg}\n\nFix: Use Drizzle ORM with withKeys() for encrypted column writes.\nIf intentional (e.g., pre-encrypted data), add to ALLOWLIST in this test.`,
			);
		}
	});

	it('should report MEDIUM violations (reads of encrypted columns via raw SQL)', () => {
		const medium = violations.filter((v) => v.severity === 'MEDIUM');

		// Log for visibility — these are tracked, not necessarily failing
		if (medium.length > 0) {
			const msg = medium
				.map((v) => `  ${v.file}:${v.line} — READ ${v.table}.${v.column} (${v.type})`)
				.join('\n');
			console.warn(
				`\n⚠️  ${medium.length} MEDIUM violation(s) — raw SQL reads encrypted columns (returns ciphertext):\n${msg}\nThese return ciphertext. Use the two-step pattern: raw SQL for IDs → Drizzle ORM for encrypted fields.`,
			);
		}

		// Fail if there are any MEDIUM violations — forces fix or explicit allowlist
		expect(medium.length).toBe(0);
	});

	it('should detect synthetic violations (guard self-test)', () => {
		// Verify the guard logic catches known-bad patterns
		const testColumns: EncryptedColumn[] = [
			{ table: 'contacts', column: 'first_name', type: 'encryptedText' },
			{ table: 'memories', column: 'content', type: 'encryptedText' },
		];

		// Simulate a bad SELECT reading encrypted column
		const badRead: CallSite = {
			file: '/test/bad.ts',
			relFile: 'test/bad.ts',
			line: 10,
			sqlContext: 'select first_name, last_name from contacts where id = $1',
			isWrite: false,
		};

		// Simulate a bad UPDATE writing to encrypted column
		const badWrite: CallSite = {
			file: '/test/bad.ts',
			relFile: 'test/bad.ts',
			line: 20,
			sqlContext: "update contacts set first_name = 'plaintext' where id = $1",
			isWrite: true,
		};

		// Simulate a safe pattern — only selects id
		const safeIdOnly: CallSite = {
			file: '/test/safe.ts',
			relFile: 'test/safe.ts',
			line: 30,
			sqlContext: 'select id from contacts where workspace_id = $1',
			isWrite: false,
		};

		// Simulate safe pattern — content_sanitized not content
		const safeSanitized: CallSite = {
			file: '/test/safe.ts',
			relFile: 'test/safe.ts',
			line: 40,
			sqlContext: 'select m.content_sanitized as content from memories m',
			isWrite: false,
		};

		const badViolations = findViolations(testColumns, [badRead, badWrite]);
		const safeViolations = findViolations(testColumns, [safeIdOnly, safeSanitized]);

		expect(badViolations).toHaveLength(2);
		expect(badViolations[0].severity).toBe('MEDIUM'); // read
		expect(badViolations[1].severity).toBe('CRITICAL'); // write
		expect(safeViolations).toHaveLength(0);
	});

	it('should list all encrypted columns for reference', () => {
		// This test always passes — it prints the inventory for documentation
		const grouped = new Map<string, string[]>();
		for (const col of encryptedColumns) {
			const existing = grouped.get(col.table) ?? [];
			existing.push(`${col.column} (${col.type})`);
			grouped.set(col.table, existing);
		}

		const inventory = Array.from(grouped.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([table, cols]) => `  ${table}: ${cols.join(', ')}`)
			.join('\n');

		console.log(
			`\n📋 Encrypted column inventory (${encryptedColumns.length} columns):\n${inventory}`,
		);
	});
});

// ── Runtime guard tests ─────────────────────────────────────────────────────

describe('runtime execute guard', () => {
	it('should discover encrypted columns from schema via probing', async () => {
		const { getEncryptedInventory } = await import('../execute-guard');
		const runtimeInventory = getEncryptedInventory();

		expect(runtimeInventory.length).toBeGreaterThan(40);

		const names = runtimeInventory.map((c) => `${c.table}.${c.column}`);
		expect(names).toContain('contacts.first_name');
		expect(names).toContain('accounts.access_token');
		expect(names).toContain('memories.content');
		expect(names).toContain('knowledge_nodes.name');
	});

	it('should match static scanner inventory', async () => {
		const { getEncryptedInventory } = await import('../execute-guard');
		const runtimeInventory = getEncryptedInventory();

		const staticColumns = extractEncryptedColumns();

		const runtimeSet = new Set(runtimeInventory.map((c) => `${c.table}.${c.column}`));
		for (const col of staticColumns) {
			expect(runtimeSet).toContain(`${col.table}.${col.column}`);
		}
	});

	it('should throw on SQL referencing encrypted columns', async () => {
		const { guardExecute } = await import('../execute-guard');

		expect(() => guardExecute('select first_name from contacts where id = $1')).toThrow(
			/encrypted column/i,
		);

		expect(() => guardExecute("update contacts set first_name = 'x' where id = $1")).toThrow(
			/CRITICAL/,
		);
	});

	it('should allow safe SQL patterns', async () => {
		const { guardExecute } = await import('../execute-guard');

		expect(() => guardExecute('select 1 as ok')).not.toThrow();
		expect(() => guardExecute("set local app.workspace_id = 'ws-1'")).not.toThrow();
		expect(() => guardExecute('select id, workspace_id from contacts where id = $1')).not.toThrow();
		expect(() =>
			guardExecute('select content_sanitized from memories where workspace_id = $1'),
		).not.toThrow();
	});

	it('should allow only tagged pre-encrypted Telegram session writes', async () => {
		const { guardExecute } = await import('../execute-guard');

		expect(() =>
			guardExecute(`
				/* gordian:pre-encrypted-telegram-session:v1 */
				update accounts
				set access_token = $1,
					session_kek_encrypted = $2,
					updated_at = now()
				where id = $3
					and provider_id = 'telegram'
					and account_id = $4
			`),
		).not.toThrow();

		expect(() =>
			guardExecute(`
				/* gordian:pre-encrypted-telegram-session:v1 */
				update accounts
				set access_token = $1,
					updated_at = now()
				where id = $3
			`),
		).toThrow(/CRITICAL/);
	});

	it('should extract SQL text from Drizzle SQL objects', async () => {
		const { sql } = await import('drizzle-orm');
		const { extractSqlText } = await import('../execute-guard');

		const query = sql`SELECT first_name FROM contacts WHERE id = ${'abc'}`;
		const text = extractSqlText(query);

		expect(text).toContain('select first_name from contacts');
	});

	it('should warn instead of throw in production mode', async () => {
		const { guardExecute } = await import('../execute-guard');
		const originalEnv = process.env.NODE_ENV;

		try {
			process.env.NODE_ENV = 'production';
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			guardExecute('select first_name from contacts where id = $1');

			expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('encrypted column'));
			consoleSpy.mockRestore();
		} finally {
			process.env.NODE_ENV = originalEnv;
		}
	});
});
