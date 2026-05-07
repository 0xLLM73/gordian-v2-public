import { describe, expect, it } from 'vitest';
import { splitSqlStatements } from '../sql-splitter';

describe('splitSqlStatements', () => {
	it('splits ordinary statements and ignores comment-only fragments', () => {
		const statements = splitSqlStatements(`
			-- first table
			CREATE TABLE one (id uuid);
			--> statement-breakpoint
			CREATE TABLE two (id uuid);
			-- trailing comment
		`);

		expect(statements).toHaveLength(2);
		expect(statements[0]).toContain('CREATE TABLE one');
		expect(statements[1]).toContain('CREATE TABLE two');
	});

	it('keeps function bodies and DO blocks intact', () => {
		const statements = splitSqlStatements(`
			DO $$
			BEGIN
				EXECUTE 'SELECT 1; SELECT 2';
			END $$;

			CREATE OR REPLACE FUNCTION demo_fn()
			RETURNS void AS $body$
			BEGIN
				PERFORM set_config('demo.value', 'a;b', true);
			END;
			$body$ LANGUAGE plpgsql;
		`);

		expect(statements).toHaveLength(2);
		expect(statements[0]).toContain("EXECUTE 'SELECT 1; SELECT 2'");
		expect(statements[1]).toContain("set_config('demo.value', 'a;b', true)");
	});

	it('does not split semicolons inside quoted strings or identifiers', () => {
		const statements = splitSqlStatements(`
			INSERT INTO logs ("semi;column", message) VALUES ('hello; world', 'it''s fine');
			ALTER TYPE status ADD VALUE IF NOT EXISTS 'done';
		`);

		expect(statements).toHaveLength(2);
		expect(statements[0]).toContain("'hello; world'");
		expect(statements[1]).toBe("ALTER TYPE status ADD VALUE IF NOT EXISTS 'done'");
	});
});
