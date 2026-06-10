const INITIAL_CHARACTER_RE = /[\p{L}\p{N}]/u;

export function getContactInitial(...parts: unknown[]): string {
	for (const part of parts) {
		if (typeof part !== 'string') continue;
		const normalized = part.trim().normalize('NFC');
		for (const character of normalized) {
			if (character === '\uFFFD') continue;
			if (!INITIAL_CHARACTER_RE.test(character)) continue;
			return character.toLocaleUpperCase('en-US');
		}
	}

	return '?';
}
