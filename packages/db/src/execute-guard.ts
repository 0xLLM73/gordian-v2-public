/**
 * Runtime guard for db.execute() — detects raw SQL referencing encrypted columns.
 *
 * db.execute(sql`...`) bypasses Drizzle's customType encryption layer.
 * This guard intercepts execute calls and checks the SQL for encrypted column
 * references. Dev/test: throws. Production: logs error (non-blocking).
 *
 * The encrypted column inventory is built lazily from schema by probing each
 * column's mapToDriverValue — encrypted columns throw "No encryption context".
 */

import { getTableConfig } from 'drizzle-orm/pg-core';
import type { PgTable } from 'drizzle-orm/pg-core';
import * as schema from './schema/index';

// ── Encrypted column discovery ──────────────────────────────────────────────

interface EncryptedColumnInfo {
	table: string;
	column: string;
}

let _inventory: EncryptedColumnInfo[] | null = null;
let _columnNames: Set<string> | null = null;

function isPgTable(value: unknown): boolean {
	try {
		getTableConfig(value as PgTable);
		return true;
	} catch {
		return false;
	}
}

function isEncryptedColumn(column: { mapToDriverValue?: (v: unknown) => unknown }): boolean {
	if (typeof column.mapToDriverValue !== 'function') return false;
	try {
		column.mapToDriverValue('test');
		return false;
	} catch (e) {
		return e instanceof Error && e.message.includes('No encryption context');
	}
}

function buildInventory(): EncryptedColumnInfo[] {
	const inventory: EncryptedColumnInfo[] = [];

	for (const value of Object.values(schema)) {
		if (!isPgTable(value)) continue;
		const config = getTableConfig(value as PgTable);
		for (const col of config.columns) {
			if (isEncryptedColumn(col as { mapToDriverValue?: (v: unknown) => unknown })) {
				inventory.push({ table: config.name, column: col.name });
			}
		}
	}

	return inventory;
}

export function getEncryptedInventory(): EncryptedColumnInfo[] {
	if (!_inventory) _inventory = buildInventory();
	return _inventory;
}

function getEncryptedColumnNames(): Set<string> {
	if (!_columnNames) _columnNames = new Set(getEncryptedInventory().map((c) => c.column));
	return _columnNames;
}

// ── SQL text extraction from Drizzle SQL objects ────────────────────────────

export function extractSqlText(sqlObj: unknown): string | null {
	if (!sqlObj || typeof sqlObj !== 'object') return null;

	const obj = sqlObj as { queryChunks?: unknown[] };
	if (!Array.isArray(obj.queryChunks)) return null;

	const parts: string[] = [];

	function walk(chunks: unknown[]) {
		for (const chunk of chunks) {
			if (typeof chunk === 'string') {
				parts.push(chunk);
			} else if (chunk && typeof chunk === 'object') {
				const c = chunk as { value?: unknown[]; queryChunks?: unknown[] };
				if (Array.isArray(c.value)) {
					for (const v of c.value) {
						if (typeof v === 'string') parts.push(v);
					}
				}
				if (Array.isArray(c.queryChunks)) {
					walk(c.queryChunks);
				}
			}
		}
	}

	walk(obj.queryChunks);
	return parts.length > 0 ? parts.join(' ').toLowerCase() : null;
}

// ── Guard logic ─────────────────────────────────────────────────────────────

const SAFE_PATTERNS = [/^\s*set\s+local\b/i, /^\s*select\s+1\b/i, /^\s*show\b/i];

function isRealColumnRef(sqlText: string, colName: string): boolean {
	const pattern = new RegExp(`\\b${colName}\\b`, 'gi');

	for (let match = pattern.exec(sqlText); match !== null; match = pattern.exec(sqlText)) {
		const before = sqlText.slice(Math.max(0, match.index - 5), match.index);
		const after = sqlText.slice(match.index + colName.length, match.index + colName.length + 5);

		if (before.endsWith('::')) continue;
		if (/\bas\s*$/i.test(before)) continue;
		if (before.endsWith('_')) continue;
		if (after.startsWith('_')) continue;

		return true;
	}

	return false;
}

export function guardExecute(sqlText: string): void {
	const trimmed = sqlText.trim();
	if (SAFE_PATTERNS.some((p) => p.test(trimmed))) return;

	const encryptedCols = getEncryptedColumnNames();
	const violations: string[] = [];

	for (const colName of encryptedCols) {
		if (isRealColumnRef(trimmed, colName)) {
			violations.push(colName);
		}
	}

	if (violations.length === 0) return;

	const isWrite = /\b(update\s|insert\s|delete\s)/i.test(trimmed);
	const severity = isWrite ? 'CRITICAL' : 'WARNING';
	const msg = `[execute-guard] ${severity}: db.execute() references encrypted column(s): ${violations.join(', ')}. Use Drizzle ORM with withKeys() instead.`;

	if (process.env.NODE_ENV === 'production') {
		console.error(msg);
	} else {
		throw new Error(msg);
	}
}
