import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DB_SRC = join(__dirname, '..');

function read(relativePath: string) {
	return readFileSync(join(DB_SRC, relativePath), 'utf-8');
}

describe('encrypted search regression contracts', () => {
	it('does not double-hash blind index query values before Drizzle comparisons', () => {
		const contactsDal = read('dal/contacts.ts');
		const searchDal = read('dal/search.ts');

		expect(contactsDal).not.toContain('computeBlindIndex');
		expect(contactsDal).not.toContain('getCurrentKeys');
		expect(searchDal).not.toContain('computeBlindIndex');
		expect(searchDal).not.toContain('keyStore');

		expect(contactsDal).toContain('eq(contacts.firstNameBidx, searchName)');
		expect(contactsDal).toContain('eq(contacts.phoneBidx, phone)');
		expect(contactsDal).toContain('eq(contacts.emailBidx, email)');
		expect(contactsDal).toContain('eq(contacts.usernameBidx, username)');
		expect(searchDal).toContain('eq(deals.titleBlindIndex, query)');
	});

	it('keeps fallback text matching inside workspace key context', () => {
		const contactsDal = read('dal/contacts.ts');
		const searchDal = read('dal/search.ts');

		expect(contactsDal).toContain('[first, last].filter(Boolean).join');
		expect(contactsDal).toContain('normalizeContactSearchText(c.email)');
		expect(contactsDal).toContain('normalizeContactSearchText(c.phone)');

		expect(searchDal).toContain('async function searchDealsByText');
		expect(searchDal).toContain('return withKeys(envelope, async () => {');
		expect(searchDal).not.toContain('sql.raw');
		expect(searchDal).not.toContain('db.execute');
	});
});
