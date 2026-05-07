function isDollarQuoteStart(sql: string, index: number): string | null {
	const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u.exec(sql.slice(index));
	return match?.[0] ?? null;
}

function hasExecutableSql(statement: string): boolean {
	return (
		statement
			.replace(/--.*$/gm, '')
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.trim().length > 0
	);
}

export function splitSqlStatements(sql: string): string[] {
	const statements: string[] = [];
	let current = '';
	let singleQuote = false;
	let doubleQuote = false;
	let lineComment = false;
	let blockComment = false;
	let dollarQuote: string | null = null;

	for (let i = 0; i < sql.length; i += 1) {
		const char = sql[i];
		const next = sql[i + 1];

		if (lineComment) {
			current += char;
			if (char === '\n') {
				lineComment = false;
			}
			continue;
		}

		if (blockComment) {
			current += char;
			if (char === '*' && next === '/') {
				current += next;
				i += 1;
				blockComment = false;
			}
			continue;
		}

		if (dollarQuote) {
			if (sql.startsWith(dollarQuote, i)) {
				current += dollarQuote;
				i += dollarQuote.length - 1;
				dollarQuote = null;
			} else {
				current += char;
			}
			continue;
		}

		if (singleQuote) {
			current += char;
			if (char === "'" && next === "'") {
				current += next;
				i += 1;
			} else if (char === "'") {
				singleQuote = false;
			}
			continue;
		}

		if (doubleQuote) {
			current += char;
			if (char === '"' && next === '"') {
				current += next;
				i += 1;
			} else if (char === '"') {
				doubleQuote = false;
			}
			continue;
		}

		if (char === '-' && next === '-') {
			current += char + next;
			i += 1;
			lineComment = true;
			continue;
		}

		if (char === '/' && next === '*') {
			current += char + next;
			i += 1;
			blockComment = true;
			continue;
		}

		if (char === "'") {
			current += char;
			singleQuote = true;
			continue;
		}

		if (char === '"') {
			current += char;
			doubleQuote = true;
			continue;
		}

		if (char === '$') {
			const tag = isDollarQuoteStart(sql, i);
			if (tag) {
				current += tag;
				i += tag.length - 1;
				dollarQuote = tag;
				continue;
			}
		}

		if (char === ';') {
			if (hasExecutableSql(current)) {
				statements.push(current.trim());
			}
			current = '';
			continue;
		}

		current += char;
	}

	if (hasExecutableSql(current)) {
		statements.push(current.trim());
	}

	return statements;
}
