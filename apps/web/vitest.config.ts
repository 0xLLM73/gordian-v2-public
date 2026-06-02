import path from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'jsdom',
		passWithNoTests: true,
		exclude: [...configDefaults.exclude, '**/dist/**', '**/.next/**', '**/e2e/**'],
	},
	resolve: {
		alias: {
			'@': path.resolve(import.meta.dirname, 'src'),
		},
	},
});
