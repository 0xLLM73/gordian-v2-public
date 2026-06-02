// Load local env before importing modules that read process.env at module scope.
if (process.env.NODE_ENV !== 'production') {
	const path = await import('node:path');
	const { config } = await import('dotenv');
	config({ path: path.resolve(import.meta.dirname, '../../../.env.local') });
}

await import('./server');
