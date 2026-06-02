import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		exclude: [...configDefaults.exclude, '**/dist/**', '**/.next/**', '**/e2e/**'],
		globals: true,
		passWithNoTests: true,
	},
});
